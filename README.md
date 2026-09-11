# Argame Paseo Mirandino — Control de alquiler con backend, base de datos y asistente de IA

Backend en Node.js/Express con base de datos SQLite, un usuario maestro y un
asistente de IA que analiza el uso de los últimos 7 días para sugerir:
1. El día y franja horaria de mayor actividad.
2. Un horario específico para un torneo.
3. Una idea simple de fidelización (puntos o membresía).

## 1. Instalación local

```bash
npm install
cp .env.example .env
```

Edita `.env` y completa (ver sección de variables más abajo). Luego:

```bash
npm start
```

Abre `http://localhost:3000` e inicia sesión con el usuario maestro.

## 2. Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (Render lo define automáticamente). |
| `JWT_SECRET` | Cadena aleatoria larga para firmar las sesiones. **Genera una propia**, no reutilices la de otro proyecto: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `MASTER_USERNAME` | Usuario del único administrador. |
| `MASTER_PASSWORD_HASH` | Hash (scrypt) de la contraseña maestra. Se genera con `node seed.js <usuario> <contraseña>`. **Nunca pongas la contraseña en texto plano aquí.** |
| `DB_PATH` | Ruta del archivo SQLite (por defecto `./data/app.db`). |
| `AI_PROVIDER` | `anthropic` o `gemini`. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Si usas Anthropic (Claude). |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Si usas Gemini. |

Las claves de IA son **tuyas**: debes generarlas en tu propia cuenta de
[console.anthropic.com](https://console.anthropic.com) o
[aistudio.google.com](https://aistudio.google.com). Nunca se envían al
navegador; solo el servidor las usa.

## 3. Credenciales del usuario maestro

Se generaron y se te entregaron por chat (usuario, contraseña en texto plano
y su hash). Pon el usuario y el hash en `MASTER_USERNAME` /
`MASTER_PASSWORD_HASH`. La contraseña en texto plano es la que usas para
iniciar sesión en la app — **cámbiala** desde la app (usa el endpoint
`/api/change-password` o agrega un botón en Configuración) apenas tengas
acceso, y guárdala en un gestor de contraseñas.

Para generar un usuario/contraseña nuevos en cualquier momento:

```bash
node seed.js "mi_usuario" "mi_contraseña_larga"
```

Esto imprime `MASTER_USERNAME` y `MASTER_PASSWORD_HASH` listos para pegar en
las variables de entorno. **Esto solo funciona en el primer arranque**
(cuando la tabla de usuarios está vacía); después, la contraseña vive en la
base de datos y se cambia con `/api/change-password`.

## 4. Desplegar en Render

Este proyecto ahora necesita un **Web Service** (no un sitio estático), porque
corre un servidor Node con base de datos y guarda una clave de API en secreto.

1. Sube esta carpeta a un repositorio de GitHub.
2. En https://dashboard.render.com → **New** → **Web Service** → conecta el
   repositorio.
3. Configuración:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. En la pestaña **Environment**, agrega todas las variables de la tabla
   anterior (con tus propios valores).
5. Crea el servicio. Render te dará una URL `https://tu-app.onrender.com`.

### Persistencia de datos en Render — importante

El plan **gratuito** de Render no incluye disco persistente: el archivo
SQLite se reinicia cada vez que el servicio se redepliega o se reinicia tras
inactividad. Para producción real, elige una de estas opciones:

- **Recomendado:** actualiza a un plan pago con **Persistent Disk**, móntalo
  en `/var/data` y define `DB_PATH=/var/data/app.db`.
- Alternativa: migra a una base de datos administrada (por ejemplo, el
  PostgreSQL gratuito de Render, que expira a los 90 días en el plan free).

Mientras uses el plan gratuito sin disco, trata la app como un ambiente de
prueba: los datos pueden perderse en un redeploy o reinicio del servicio.

## 5. Seguridad implementada

- Contraseña del usuario maestro con **scrypt** (salt aleatorio por usuario,
  comparación en tiempo constante) — no se guarda en texto plano en ningún
  lado.
- Sesión mediante **JWT firmado**, en cookie `httpOnly`, `secure` (en
  producción) y `sameSite=lax`, con expiración de 12 horas.
- **Rate limiting** en `/api/login` (10 intentos / 15 min por IP) y en la
  generación de análisis de IA (6 / 5 min) para evitar fuerza bruta y abuso
  de la API de IA.
- Cabeceras de seguridad con **Helmet** (incluye Content-Security-Policy).
- Todas las consultas a la base de datos usan **sentencias preparadas**
  (better-sqlite3), sin concatenar texto del usuario — protegido contra
  inyección SQL.
- Validación de tipos y tamaños en cada endpoint antes de tocar la base de
  datos.
- Las claves de IA (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) solo existen en
  el servidor; nunca se exponen al navegador.
- `.env` está en `.gitignore`: nunca subas tus claves reales a GitHub.

### Recomendaciones adicionales para producción

- Cambia la contraseña maestra generada apenas tengas acceso.
- Si expones la API a más de un cliente/sucursal, considera agregar más
  usuarios y roles (hoy es un solo usuario maestro, como se pidió).
- Revisa periódicamente los intentos de login fallidos (tabla
  `login_attempts`).
- Considera un servicio de backups periódicos del archivo SQLite (o migrar a
  Postgres) para no depender de un solo archivo.

## 6. Asistente de IA — cómo funciona

Cada vez que finalizas una sesión o cambias la consola de una estación, la
app guarda un registro (`consola, fecha, hora de inicio, hora de fin`) en la
tabla `usage_log`. Desde la pestaña **Asistente IA**, el botón
"Generar/Actualizar análisis":

1. Toma los registros de los últimos 7 días (mínimo 5 sesiones).
2. Calcula localmente un histograma de ocupación simultánea por
   día-de-semana + hora (para dar contexto numérico confiable al modelo).
3. Envía ese resumen + los registros al modelo de IA configurado
   (Anthropic Claude o Gemini, según `AI_PROVIDER`).
4. Guarda el resultado en caché (`ai_cache`) para no llamar a la API en cada
   carga de página — solo cuando pulsas el botón.
