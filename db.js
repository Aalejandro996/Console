const { Pool } = require('pg');

// Conectamos a PostgreSQL usando la variable de entorno DATABASE_URL configurada en Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para conectarse a Neon, Supabase, Render DBs, etc.
  }
});

// Función para inicializar las tablas con sintaxis de PostgreSQL
const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id SERIAL PRIMARY KEY,
      console_name TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      generated_at TEXT,
      records_analyzed INTEGER,
      busiest_slot TEXT,
      tournament_suggestion TEXT,
      loyalty_idea TEXT
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      ip TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      success INTEGER NOT NULL
    );
  `);
};

// Exportamos el cliente para hacer consultas asíncronas
module.exports = {
  query: (text, params) => pool.query(text, params),
  initDb
};