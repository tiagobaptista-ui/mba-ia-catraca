import { config } from './core/config.js';
import { migrate } from './core/migrate.js';
import { loadModules, startModules } from './core/modules.js';
import { closePool } from './core/db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

async function main() {
  await migrate();
  await seed();
  const modules = await loadModules();
  const app = createApp(modules);
  const server = app.listen(config.port, () => {
    console.log(`[server] Catraca em http://localhost:${config.port} (módulos: ${modules.map((m) => m.name).join(', ')})`);
  });
  const stopModules = await startModules(modules);

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} recebido, encerrando`);
    server.close();
    await stopModules();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] falha na subida', err);
  process.exit(1);
});
