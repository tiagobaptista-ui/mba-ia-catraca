import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';
import { config } from './config.js';
import { html } from './html.js';
import { sendPage } from './layout.js';

const scrypt = promisify(scryptCb);
export const SESSION_COOKIE = 'catraca_sid';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    new Date(Date.now() + ttlMs),
  ]);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: ttlMs });
}

export async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Middleware: popula req.user ({ id, name, email, role }) a partir do cookie de sessão, ou null.
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    req.user = rows[0] || null;
  }
  next();
}

// Exige papel. Sem sessão → login (com retorno); papel errado → 403 sem nenhum dado.
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (req.user.role !== role) {
      return sendPage(res, {
        status: 403,
        title: 'Acesso restrito',
        user: req.user,
        body: html`<h1>Acesso restrito</h1>
          <p>Esta área é exclusiva para ${role === 'organizer' ? 'organizadores' : 'participantes'}.</p>`,
      });
    }
    return next();
  };
}
