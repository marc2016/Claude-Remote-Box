import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitActions, gitStale, validBranchName } from '../shared/model.js';

const w = (extra) => ({ path: '/workspace/.wt/x', branch: 'calm-clock', ahead: 0, dirty: 0, remote: 'ok', upstream: 'origin/calm-clock', unpushed: 0, behind: 0, ...extra });
const offered = (x, def = 'main') => Object.entries(gitActions(x, def)).filter(([, v]) => v).map(([k]) => k).join(' ');

test('actions a checkout offers, by its reported state', () => {
  assert.equal(offered(w()), '', 'equal to origin, nothing of its own');
  assert.equal(offered(w({ unpushed: 2, ahead: 2 })), 'push merge');
  assert.equal(offered(w({ behind: 3 })), 'pull');
  assert.equal(offered(w({ unpushed: 1, behind: 1, ahead: 1 })), 'diverged', 'diverged: no action at all');
  assert.equal(offered(w({ remote: 'none', upstream: null, unpushed: null, behind: null, ahead: 1 })), 'push merge', 'not on origin, with commits');
  assert.equal(offered(w({ remote: 'none', upstream: null, unpushed: null, behind: null })), '', 'not on origin, empty');
  assert.equal(offered(w({ remote: 'gone', upstream: null, unpushed: null, behind: null, ahead: 2 })), 'merge', 'deleted on origin: no push');
  assert.equal(offered(w({ ahead: 3 })), 'merge', 'pushed, but main lacks it');
});

test('the default branch is never merged into itself, and unknown states offer nothing', () => {
  assert.equal(offered(w({ branch: 'main', unpushed: 2, ahead: 2 })), 'push');
  assert.equal(offered(w({ unpushed: 2, ahead: 2 }), null), 'push', 'no default branch known: no merge');
  assert.equal(offered({ path: '/workspace', branch: 'main', ahead: 2, dirty: 0 }), '', 'a box from before the remote state');
  assert.equal(offered(w({ branch: null, unpushed: 2 })), '', 'detached');
  assert.equal(offered(null), '');
});

test('warning for a branch behind the default branch', () => {
  assert.equal(gitStale(w({ behind_default: 12 }), 'main'), '12 hinter main');
  assert.equal(gitStale(w({ behind_default: 0 }), 'main'), null);
  assert.equal(gitStale(w({ branch: 'main', behind_default: 3 }), 'main'), null, 'the default branch itself');
  assert.equal(gitStale(w({}), 'main'), null, 'a box that does not report the distance');
  assert.equal(gitStale(w({ behind_default: null }), 'main'), null);
  assert.equal(gitStale(w({ behind_default: 5 }), null), null);
  assert.equal(gitStale(null, 'main'), null);
});

test('branch names the dashboard accepts', () => {
  for (const ok of ['feature/nav', 'calm-clock', 'v1.2_x', 'a']) assert.equal(validBranchName(ok), true, ok);
  for (const bad of ['', '-x', 'a b', 'x; rm -rf /', 'a\tb', 'x'.repeat(101), 'ä', null, 5]) assert.equal(validBranchName(bad), false, String(bad));
});

test('queuing asks for the passkey once when the server wants a confirmation', async () => {
  const { queueWithConfirm } = await import('../shared/model.js');
  const run = async (answers, confirmed = true) => {
    let posts = 0; let confirms = 0;
    const out = await queueWithConfirm(async () => answers[posts++], async () => { confirms++; return confirmed; });
    return [out, posts, confirms];
  };
  assert.deepEqual(await run([{ status: 202 }]), ['queued', 1, 0]);
  assert.deepEqual(await run([{ status: 403, error: 'confirm' }, { status: 202 }]), ['queued', 2, 1], 'one confirmation, then queued without asking the user again');
  assert.deepEqual(await run([{ status: 403, error: 'confirm' }], false), ['unconfirmed', 1, 1], 'dismissed: nothing is queued');
  assert.deepEqual(await run([{ status: 403, error: 'confirm' }, { status: 403, error: 'confirm' }]), ['unconfirmed', 2, 1], 'no loop');
  assert.deepEqual(await run([{ status: 403, error: 'wrong origin' }]), ['error', 1, 0]);
  assert.deepEqual(await run([{ status: 503 }]), ['absent', 1, 0]);
  assert.deepEqual(await run([{ status: 429 }]), ['limited', 1, 0]);
  assert.deepEqual(await run([{ status: 401 }]), ['signed-out', 1, 0]);
});

test('after an action the shown state counts as settling until the box reports a newer fetch', async () => {
  const { gitSettling } = await import('../shared/model.js');
  const t = (s) => new Date(Date.parse('2026-11-13T10:00:00Z') + s * 1000).toISOString();
  const at = (s) => Date.parse(t(s));
  const last = { started: t(10), finished: t(12) };
  assert.equal(gitSettling(last, t(0), at(13)), true, 'the report is from before the action');
  assert.equal(gitSettling(last, t(11), at(13)), false, 'the report carries the fetch of the action');
  assert.equal(gitSettling(last, null, at(13)), true);
  assert.equal(gitSettling(last, t(0), at(80)), false, 'gives up after a minute');
  assert.equal(gitSettling({ started: null, finished: t(12) }, t(0), at(13)), false, 'expired: never started');
  assert.equal(gitSettling(null, t(0), at(13)), false);
});
