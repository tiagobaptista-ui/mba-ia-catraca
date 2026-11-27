import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');

// Carrega todo src/modules/<nome>/index.js. Cada módulo exporta por padrão:
//   { name: string, order?: number, register(app): void, start?(): (() => Promise<void>) | void }
// Ordem de montagem: `order` crescente (padrão 100), depois nome. Feature nova não edita arquivo central.
export async function loadModules() {
  const entries = await readdir(MODULES_DIR, { withFileTypes: true });
  const modules = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(MODULES_DIR, entry.name, 'index.js');
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)).default;
    if (!mod || typeof mod.register !== 'function') {
      throw new Error(`Módulo ${entry.name} não exporta { register }`);
    }
    modules.push({ order: 100, ...mod, name: mod.name || entry.name });
  }
  return modules.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// Inicia o trabalho em segundo plano dos módulos (ex.: worker do gateway). Retorna uma função que para tudo.
export async function startModules(modules) {
  const stops = [];
  for (const mod of modules) {
    if (typeof mod.start === 'function') {
      const stop = await mod.start();
      if (typeof stop === 'function') stops.push(stop);
    }
  }
  return async () => {
    for (const stop of stops.reverse()) await stop();
  };
}
