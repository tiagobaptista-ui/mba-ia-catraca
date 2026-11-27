import pg from 'pg';
import { config } from './config.js';

// timestamptz e bigint chegam como tipos JS úteis: Date e number.
pg.types.setTypeParser(20, (value) => Number(value)); // int8 (count(*), sum)

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

pool.on('error', (err) => {
  console.error('[db] erro em conexão ociosa', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Executa fn(client) dentro de uma transação. Faz ROLLBACK em qualquer erro e repassa o erro.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // conexão já quebrada; o erro original é o que importa
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
