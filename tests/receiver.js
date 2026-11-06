#!/usr/bin/env node
// Test receiver for crb-watch: records every POST as one JSON line
// {headers, events} in OUT. While OUT + ".pause" exists it answers 503.
// Usage: node tests/receiver.js PORT OUT [TOKEN]
'use strict';
const http = require('http');
const fs = require('fs');

const port = parseInt(process.argv[2] || '8080', 10);
const out = process.argv[3] || '/tmp/receiver.jsonl';
const token = process.argv[4] || '';

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (out !== '-' && fs.existsSync(out + '.pause')) { res.writeHead(503); res.end(); return; }
    if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
    let events;
    try { events = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    const line = JSON.stringify({ headers: req.headers, events }) + '\n';
    if (out === '-') process.stdout.write(line); else fs.appendFileSync(out, line);
    res.writeHead(204); res.end();
  });
}).listen(port, '0.0.0.0', () => { process.stderr.write(`receiver on ${port} -> ${out}\n`); });
