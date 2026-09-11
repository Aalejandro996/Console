require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');
const { generateInsights } = require('./ai');

const app = express();
app.set('trust proxy', 1); // necesario en Render para cookies "secure" detrás del proxy

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'argame_session';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ERROR: define JWT_SECRET (cadena aleatoria de al menos 32 caracteres) en las variables de entorno.');
  process.exit(1);
}

/* ================= Inicialización de DB y Seed ================= */
(async function initialize() {
  try {
    // 1. Crear tablas si no existen
    await db.initDb();
    
    // 2. Crear usuario maestro si no existe
    const existing = await db.query('SELECT * FROM users WHERE id = 1');
    if (existing.rows.length > 0) return;
    
    const username = process.env.MASTER_USERNAME;
    const passwordHash = process.env.MASTER_PASSWORD_HASH;
    if (!username || !passwordHash) {
      console.error('ERROR: define MASTER_USERNAME y MASTER_PASSWORD_HASH en las variables de entorno para crear el usuario maestro.');
      process.exit(1);
    }
    
    await db.query('INSERT INTO users (id, username, password_hash, updated_at) VALUES (1, $1, $2, $3)',
      [username, passwordHash, new Date().toISOString()]);
    console.log(`Usuario maestro "${username}" creado.`);
  } catch (err) {
    console.error('Error inicializando base de datos PostgreSQL:', err);
  }
})();

/* ================= Seguridad general ================= */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // AÑADIDO: "'unsafe-inline'" para permitir la ejecución del script integrado en el index.html
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      // AÑADIDO: URL externa para permitir consultar la tasa del dólar
      connectSrc: ["'self'", "https://ve.dolarapi.com"]
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ================= Auth helpers ================= */
function signSession(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '12h' });
}
function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autenticado.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}
function setCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
}

/* ================= Rate limiting (fuerza bruta en login) ================= */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
});
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Espera unos minutos antes de generar otro análisis de IA.' }
});

/* ================= Auth routes ================= */
app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
  }
  
  try {
    const result = await db.query('SELECT * FROM users WHERE id = 1');
    const user = result.rows[0];
    
    const ok = user && user.username === username && verifyPassword(password, user.password_hash);
    await db.query('INSERT INTO login_attempts (ip, attempted_at, success) VALUES ($1, $2, $3)',
      [req.ip, new Date().toISOString(), ok ? 1 : 0]);
      
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    
    setCookie(res, signSession(user.username));
    res.json({ ok: true, username: user.username });
  } catch (e) {
    console.error('Error en login:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.sub });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 10) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres.' });
  }
  
  try {
    const result = await db.query('SELECT * FROM users WHERE id = 1');
    const user = result.rows[0];
    
    if (!verifyPassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
    }
    
    const newHash = hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = 1',
      [newHash, new Date().toISOString()]);
      
    res.json({ ok: true });
  } catch (e) {
    console.error('Error cambiando contraseña:', e);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* ================= Estado de la aplicación ================= */
app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT data FROM app_state WHERE id = 1');
    const row = result.rows[0];
    res.json(row ? JSON.parse(row.data) : null);
  } catch (e) {
    console.error('Error obteniendo estado:', e);
    res.status(500).json({ error: 'Error obteniendo estado.' });
  }
});

app.put('/api/state', requireAuth, async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Estado inválido.' });
  
  const json = JSON.stringify(body);
  if (json.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'El estado excede el tamaño permitido.' });
  
  try {
    await db.query(`
      INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
    `, [json, new Date().toISOString()]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando estado:', e);
    res.status(500).json({ error: 'Error guardando estado.' });
  }
});

/* ================= Registro de uso ================= */
app.post('/api/usage-log', requireAuth, async (req, res) => {
  const { consoleName, date, startTime, endTime } = req.body || {};
  if (![consoleName, date, startTime, endTime].every(v => typeof v === 'string' && v.length > 0 && v.length < 80)) {
    return res.status(400).json({ error: 'Datos de uso inválidos.' });
  }
  
  try {
    await db.query(`
      INSERT INTO usage_log (console_name, date, start_time, end_time, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [consoleName, date, startTime, endTime, new Date().toISOString()]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error registrando uso:', e);
    res.status(500).json({ error: 'Error registrando uso.' });
  }
});

/* ================= Asistente de IA ================= */
app.get('/api/ai/insights', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM ai_cache WHERE id = 1');
    res.json(result.rows[0] || null);
  } catch (e) {
    console.error('Error obteniendo insights:', e);
    res.status(500).json({ error: 'Error obteniendo insights.' });
  }
});

app.post('/api/ai/insights/generate', requireAuth, aiLimiter, async (req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await db.query('SELECT * FROM usage_log WHERE end_time >= $1 ORDER BY start_time ASC', [sevenDaysAgo]);
    const records = result.rows;
    
    const MIN_RECORDS = 5;
    if (records.length < MIN_RECORDS) {
      return res.status(422).json({ error: `Se necesitan al menos ${MIN_RECORDS} sesiones registradas en los últimos 7 días (hay ${records.length}).` });
    }
    
    const insights = await generateInsights(records);
    const generatedAt = new Date().toISOString();
    
    await db.query(`
      INSERT INTO ai_cache (id, generated_at, records_analyzed, busiest_slot, tournament_suggestion, loyalty_idea)
      VALUES (1, $1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET generated_at=EXCLUDED.generated_at, records_analyzed=EXCLUDED.records_analyzed,
        busiest_slot=EXCLUDED.busiest_slot, tournament_suggestion=EXCLUDED.tournament_suggestion, loyalty_idea=EXCLUDED.loyalty_idea
    `, [generatedAt, records.length, insights.busiest_slot, insights.tournament_suggestion, insights.loyalty_idea]);
    
    res.json({ generated_at: generatedAt, records_analyzed: records.length, ...insights });
  } catch (e) {
    console.error('Error generando insights de IA:', e.message);
    res.status(502).json({ error: 'No se pudo generar el análisis de IA: ' + e.message });
  }
});

/* ================= Salud (para Render) ================= */
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Argame server escuchando en puerto ${PORT}`));