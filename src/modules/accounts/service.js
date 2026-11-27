import { query } from '../../core/db.js';
import { newId } from '../../core/ids.js';
import { hashPassword, verifyPassword } from '../../core/auth.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Valida o cadastro de participante. Retorna { values, errors }.
export function validateSignup(input) {
  const values = {
    name: String(input.name || '').trim(),
    email: normalizeEmail(input.email),
    password: String(input.password || ''),
  };
  const errors = [];
  if (!values.name) errors.push('Informe o nome.');
  if (values.name.length > 100) errors.push('Nome muito longo (máximo 100 caracteres).');
  if (!EMAIL_RE.test(values.email)) errors.push('E-mail inválido.');
  if (values.password.length < 6) errors.push('A senha precisa ter pelo menos 6 caracteres.');
  return { values, errors };
}

// O cadastro pelo produto sempre cria participante (organizadores vêm só da seed).
export async function createParticipant({ name, email, password }) {
  const id = newId('usr');
  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, 'participant')
     ON CONFLICT (email) DO NOTHING
     RETURNING id, name, email, role`,
    [id, name, normalizeEmail(email), passwordHash],
  );
  return rows[0] || null; // null = e-mail já cadastrado
}

export async function authenticate(email, password) {
  const { rows } = await query('SELECT id, name, email, role, password_hash FROM users WHERE email = $1', [
    normalizeEmail(email),
  ]);
  const user = rows[0];
  if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// Upsert usado pela seed: garante a conta com o papel e a senha informados.
export async function upsertUser({ name, email, password, role }) {
  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
     RETURNING id, name, email, role`,
    [newId('usr'), name, normalizeEmail(email), passwordHash, role],
  );
  return rows[0];
}
