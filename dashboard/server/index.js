#!/usr/bin/env node
// Dashboard server: ingest, read API, SSE, static web app. No framework.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { buildCards } from './cards.js';
import { TIMELINE_TYPES } from '../shared/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = {
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  token: process.env.CRB_STATUS_TOKEN || '',
  dataDir: process.env.DATA_DIR || '/data',
  webDir: process.env.WEB_DIR || path.join(here, '..', 'web', 'dist'),
};

const MAX_BODY = 5 * 1024 * 1024;
const SSE_DEBOUNCE_MS = 500;
const PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

export function createServer(store, options = {}) {
  const token = options.token ?? cfg.token;
  const webDir = options.webDir ?? cfg.webDir;
  const clients = new Set();
  let pending = new Set();
  let timer = null;

  function notify(boxes) {
    for (const b of boxes) pending.add(b);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const payload = `event: changed\ndata: ${JSON.stringify({ boxes: [...pending], at: new Date().toISOString() })}\n\n`;
      pending = new Set();
      for (const res of clients) res.write(payload);
    }, SSE_DEBOUNCE_MS);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'POST' && p === '/api/ingest') return ingest(req, res);
      if (req.method === 'GET' && p === '/api/boxes') return json(res, 200, buildCards(store));
      if (req.method === 'GET' && p === '/api/events') return sse(req, res);
      const m = req.method === 'GET' && /^\/api\/sessions\/([^/]+)\/events$/.exec(p);
      if (m) {
        const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
        const beforeRaw = url.searchParams.get('before');
        const before = beforeRaw != null && /^\d+$/.test(beforeRaw) ? parseInt(beforeRaw, 10) : null;
        return json(res, 200, { session: decodeURIComponent(m[1]), events: store.sessionEvents(decodeURIComponent(m[1]), limit, TIMELINE_TYPES, before) });
      }
      if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(p, res);
      res.writeHead(405); res.end();
    } catch (e) {
      console.error('request failed', e);
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      else res.end();
    }
  });

  function ingest(req, res) {
    const auth = req.headers.authorization || '';
    if (!token || auth !== `Bearer ${token}`) return json(res, 401, { error: 'unauthorized' });
    let body = '';
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); return; } body += c; });
    req.on('end', () => {
      let events;
      try { events = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid json' }); }
      if (!Array.isArray(events)) return json(res, 400, { error: 'expected an array' });
      try {
        const changed = store.ingest(events);
        if (changed.length) notify(changed);
        res.writeHead(204); res.end();
      } catch (e) {
        console.error('ingest failed', e);
        json(res, 500, { error: 'internal' });
      }
    });
  }

  function sse(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  }

  function serveStatic(p, res) {
    const root = path.resolve(webDir);
    let file = path.resolve(root, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html'); // SPA fallback
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('web app not built'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    fs.createReadStream(file).pipe(res);
  }

  server.clients = clients;
  return server;
}

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
  res.end(s);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!cfg.token) console.error('warning: CRB_STATUS_TOKEN is empty, ingest will reject every request');
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const store = openDb(path.join(cfg.dataDir, 'dashboard.sqlite'));
  const pruned = store.prune();
  if (pruned.events || pruned.sessions) console.log(`pruned ${pruned.events} events, ${pruned.sessions} sessions`);
  setInterval(() => store.prune(), PRUNE_EVERY_MS).unref();
  const server = createServer(store);
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') console.error(`port ${cfg.port} is in use; pick another one with PORT=<n>`);
    else console.error('server failed', e);
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => console.log(`dashboard on http://${cfg.host}:${cfg.port}`));
  const stop = () => { for (const c of server.clients) c.end(); server.closeAllConnections(); server.close(); store.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
