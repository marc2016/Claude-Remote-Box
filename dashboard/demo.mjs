#!/usr/bin/env node
// Demo mode: starts the server with a throwaway database, builds the web app
// if needed, and feeds it the seed, so the dashboard can be seen without any
// box. Usage: npm run demo   (then open http://127.0.0.1:8080, Ctrl-C to stop)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || '8080';
const token = 'demo';
const base = `http://127.0.0.1:${port}`;

if (!existsSync(path.join(here, 'web', 'dist', 'index.html'))) {
  console.log('web app not built yet, running vite build …');
  const r = spawnSync('npm', ['run', 'build'], { cwd: here, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const data = mkdtempSync(path.join(os.tmpdir(), 'crb-demo-'));
const server = spawn(process.execPath, [path.join(here, 'server', 'index.js')], {
  // The demo has no user to sign in: the login is off.
  env: { ...process.env, PORT: port, HOST: '127.0.0.1', CRB_STATUS_TOKEN: token, CRB_DASHBOARD_AUTH: 'off', DATA_DIR: data, WEB_DIR: path.join(here, 'web', 'dist') },
  stdio: ['ignore', 'ignore', 'inherit'],
});

let seed = null;
const stop = () => { seed?.kill(); server.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => {
  console.error(`server exited (${code}). Node ${process.version}; node:sqlite needs 22.13+. Port busy? Try PORT=8091 npm run demo`);
  seed?.kill(); process.exit(code ?? 1);
});

for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not yet */ }
  await new Promise((r) => setTimeout(r, 100));
}

seed = spawn(process.execPath, [path.join(here, 'seed.mjs'), base], {
  env: { ...process.env, CRB_STATUS_TOKEN: token },
  stdio: ['ignore', 'ignore', 'inherit'],
});

console.log(`Demo läuft: ${base}   (Dummy-Daten, Datenbank in ${data}; Ctrl-C beendet)`);
