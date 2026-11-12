#!/usr/bin/env node
// Host commands of the login, run inside the dashboard container by
// `crb dashboard login|logout|reset`:  node server/admin.js <command>
// Works on the database file directly, so it needs nothing from the network;
// the running server reads the same rows on every use. Prints one line of JSON.
import fs from 'node:fs';
import path from 'node:path';
import { ENROLL_MINUTES, openDb } from './db.js';
import { authSettings } from './auth.js';

const command = process.argv[2];
const file = path.join(process.env.DATA_DIR || '/data', 'dashboard.sqlite');
if (!['enroll', 'logout', 'reset', 'status'].includes(command)) {
  console.error('usage: node server/admin.js enroll|logout|reset|status');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`no database at ${file}; is the dashboard running with this data directory?`);
  process.exit(1);
}

const store = openDb(file);
const settings = authSettings();
const sessions = () => store.db.prepare('SELECT COUNT(*) AS c FROM auth_sessions').get().c;
let out;
try {
  if (command === 'enroll') {
    // The count is taken before the link is used: it says how many passkeys exist already.
    out = { passkeys: store.passkeyCount(), secret: store.issueEnroll(), minutes: ENROLL_MINUTES, url: settings.url, auth: settings.on ? 'on' : 'off' };
  } else if (command === 'logout') {
    out = { sessions: store.endAllSessions() };
  } else if (command === 'reset') {
    out = store.resetAuth();
  } else {
    out = { passkeys: store.passkeyCount(), sessions: sessions(), url: settings.url, auth: settings.on ? 'on' : 'off' };
  }
} finally {
  store.close();
}
console.log(JSON.stringify(out));
