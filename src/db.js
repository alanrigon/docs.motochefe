import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || path.resolve('data', 'rotas.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'entregador',
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'eletrico',
  model_key TEXT,
  plate TEXT,
  battery_v REAL,
  battery_ah REAL,
  range_km REAL,
  km_per_l REAL,
  avg_speed REAL NOT NULL DEFAULT 25,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  route_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  vehicle_name TEXT,
  vehicle_type TEXT,
  status TEXT NOT NULL DEFAULT 'planejada',
  origin TEXT NOT NULL,
  end_point TEXT NOT NULL,
  stops TEXT NOT NULL,
  deliveries INTEGER NOT NULL,
  total_km REAL NOT NULL,
  total_min REAL NOT NULL,
  energy_kwh REAL,
  fuel_l REAL,
  unit_price REAL,
  cost REAL NOT NULL,
  battery_pct REAL,
  saved_km REAL,
  maps_link TEXT NOT NULL,
  notes TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS routes_date ON routes(route_date);
CREATE TABLE IF NOT EXISTS geocache (
  q TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);
`);

// colunas novas (bancos criados antes da versão com pedágio)
for (const col of ['toll_cost REAL NOT NULL DEFAULT 0', 'toll_status TEXT', 'manual_order INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE routes ADD COLUMN ${col}`); } catch { /* já existe */ }
}

const DEFAULTS = {
  company: 'Moto Chefe Maringá',
  base_address: '',
  city_hint: 'Maringá - PR',
  kwh_price: '0.95',
  fuel_price: '6.29',
  charge_eff: '0.85',
  stop_minutes: '5',
  return_default: '1',
  maps_mode: 'driving',
};
const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
export function setSetting(k, v) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v ?? ''));
}

// Data/hora local (o servidor roda com TZ=America/Sao_Paulo)
export function nowLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
