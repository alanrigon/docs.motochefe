import crypto from 'node:crypto';
import { db, nowLocal } from './db.js';

const SESSION_DAYS = 30;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, exp);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return { token, maxAge: SESSION_DAYS * 86400 };
}
export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.name, u.role, u.active, u.must_change, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role, must_change: !!row.must_change };
}

// Cria o primeiro administrador se o banco estiver vazio
export function ensureAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (n > 0) return;
  const user = process.env.ADMIN_USUARIO || 'admin';
  const envPass = process.env.ADMIN_SENHA;
  const pass = envPass || crypto.randomBytes(5).toString('hex');
  db.prepare('INSERT INTO users(username, name, pass, role, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user, 'Administrador', hashPassword(pass), 'admin', envPass ? 0 : 1, nowLocal());
  console.log('==============================================');
  console.log(` Usuário administrador criado: ${user}`);
  if (!envPass) console.log(` Senha temporária: ${pass}  (troque no primeiro acesso)`);
  console.log('==============================================');
}

// Limite de tentativas de login (por IP + usuário)
const attempts = new Map();
export function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60e3) { attempts.delete(key); return false; }
  return a.count >= 8;
}
export function loginFailed(key) {
  const a = attempts.get(key) || { count: 0, first: Date.now() };
  a.count++; attempts.set(key, a);
}
export function loginOk(key) { attempts.delete(key); }
