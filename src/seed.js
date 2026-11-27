import { upsertUser } from './modules/accounts/service.js';

// Contas da seed (documentadas no README e no AGENTS.md). Idempotente: pode rodar a cada subida.
export const SEED_PASSWORD = 'catraca123';
export const SEED_USERS = [
  { key: 'organizerA', name: 'Organizador A', email: 'organizador.a@catraca.dev', role: 'organizer' },
  { key: 'organizerB', name: 'Organizador B', email: 'organizador.b@catraca.dev', role: 'organizer' },
  { key: 'participant', name: 'Participante Seed', email: 'participante@catraca.dev', role: 'participant' },
];

export async function seed({ log = console.log } = {}) {
  const users = {};
  for (const u of SEED_USERS) {
    users[u.key] = await upsertUser({ name: u.name, email: u.email, password: SEED_PASSWORD, role: u.role });
  }
  log(`[seed] ${SEED_USERS.length} contas garantidas (${SEED_USERS.map((u) => u.email).join(', ')})`);
  return users;
}
