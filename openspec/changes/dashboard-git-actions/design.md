# Design

## Context

See proposal.md for the motivation. What shapes the approach:

- The dashboard container mounts only its data volume, holds no Git credential, and has been reachable from the internet through a reverse proxy since the login was added. The spec `status-dashboard` requires exactly one mount.
- Git with credentials runs on the host only, in `crb git` (bash 3.2, one file). `git_scan` reads a project into rows (`GS_ROWS`), `git_row` splits one row, `git_apply` carries out the one action a row allows (`ff`, `push`, `pushnew`). Worktrees created inside a container are addressed by their administrative directory (`--git-dir=<admin> --work-tree=<host path>`), which leaves their records with container paths untouched.
- The boxes report Git state through the watcher (`crb-watch.js`, `gitEvent`): one entry per checkout with `remote`, `unpushed`, `behind`, `ahead` (commits ahead of the default branch), `dirty`, and `fetched_at` for the repository. The watcher never fetches. A box's name is its service name (`CRB_NAME`), which is also the project name `crb git` uses.
- The dashboard server is `node:http` without a framework; `POST /api/ingest` is authenticated with `CRB_STATUS_TOKEN`, which every box holds. Sessions are rows in `auth_sessions` with `created` and `last_used`. State-changing auth routes already require `Origin` equal to the public address and `Content-Type: application/json`.
- The archived change `host-git-sync` excluded a host agent, a timer, and dashboard controls. This change reverses that on the user's decision.
- Two facts are unverified on the Mini-PC: from which commit Claude Code starts a new session's worktree (archived `host-git-sync` task 1.1), and the installed Git version.
- The user does not want anything installed on the host besides the installation directory: no service of the host user, no system package. Everything that runs permanently runs as a Compose service.

## Goals / Non-Goals

**Goals:**
- No credential, no workspace, and no Git binary in the dashboard container.
- A fixed vocabulary of actions; nothing the dashboard sends is ever executed as text.
- Every action is either carried out completely or leaves refs and working trees as they were, with one named exception (merge with a dirty default-branch checkout, see D6).
- One implementation of each Git rule, used by the command line, the agent, and the tests.

**Non-Goals:**
- A general job runner, actions other than the six kinds, actions across projects.
- Running the agent on another machine than the installation, or for several installations as one service.
- A service of the host user (systemd, launchd). `./crb agent` still runs in the foreground on any host, for development and the tests.
- Live output of a running action; the dashboard shows the result when it is finished.

## Decisions

### D1: A pulling host agent instead of Git in the dashboard

`crb agent` asks the dashboard for work; the dashboard never calls the host. Alternatives: mounting the workspaces and a key into the dashboard (a flaw in an internet-facing service would then give write access to every repository and break the one-mount rule); a listening agent on the host that the dashboard calls (a new open port, and the container would need a route to the host). Pulling needs neither and keeps the direction of trust: the side that holds the credential decides what it runs. Where the agent runs is D12: in its own container, not in the dashboard's.

### D2: The agent is a loop in `crb`, talking plain text over curl

The agent is `cmd_agent` in `crb`: no new runtime, and it calls the same functions as `crb git`. Bash 3.2 has no JSON parser, so the two agent routes speak tab-separated text instead of JSON:

- `POST /api/agent/next` (long poll, up to 25 s, `curl --max-time 35`): `204` when nothing is queued, else `200 text/plain` with one line `id<TAB>kind<TAB>project<TAB>branch<TAB>name<TAB>carry`. The dashboard only stores values from the character set of the spec, so the line cannot contain a tab or a newline. An empty branch or name is sent as `-`: a tab is whitespace for `read`, which would swallow an empty field, and no accepted name starts with `-`.
- `POST /api/agent/actions/<id>` with a `text/plain` body: first line `done`, `refused`, or `failed`, the rest the output.

The agent reads the line with `IFS=$'\t' read -r`, checks `kind` against a `case` list, the project against the services of the installation, and branch and name with `git check-ref-format --branch`, and passes them as separate arguments. Nothing is passed through `eval` or an unquoted expansion. The request to `next` is the heartbeat; no separate one.

The base address is `CRB_AGENT_DASHBOARD` when set (the agent's container sets `http://crb-dashboard:8080`, the Compose network), else `http://` plus `CRB_DASHBOARD_BIND` from `.env` (default `127.0.0.1:8080`) with `0.0.0.0` replaced by `127.0.0.1`, for an agent in the foreground on the host. It never goes through the reverse proxy.

### D3: A separate token, and agent routes that refuse forwarded requests

`CRB_STATUS_TOKEN` is in every box. A box that could use it on the agent routes could take actions out of the queue or report invented results. So the agent gets its own `CRB_AGENT_TOKEN`, which only `.env`, the dashboard service, and the host agent see. The two routes also refuse any request with `X-Forwarded-For` or `Forwarded`, as ingest does, without a switch to allow it: the agent is always on the same machine, on the Compose network or on the host. Tokens are compared in constant time.

A box can still reach the dashboard over the Compose network, but without the agent token it gets `401`, and queuing needs a passkey session, which a box cannot have.

### D4: Actions are single commands of `crb git`

`crb git push|pull|merge|branch <project> ...` are added next to `sync`. The agent runs an action by calling the same function in a subshell, capturing output and exit code: 0 → `done`, 3 → `refused`, anything else → `failed`. `fetch` maps to the overview for one project (`--list`), `sync` to `crb git sync <project>`. This gives one implementation, makes every rule testable in `tests/crb.test.sh` without a dashboard, and lets a phone shortcut use the same actions.

`push` and `pull` are `git_scan` for the project, the row of the branch, and `git_apply` when its kind is `push`/`pushnew` or `ff`; every other kind is a refusal with the text `git_row` already has. The words `push`, `pull`, `merge`, `branch` become reserved first arguments of `crb git`, like `sync`; a project with one of these names has to be handled through the menu.

### D5: Queue in SQLite, with short lifetimes

A table `git_actions(id, box, kind, branch, name, carry, state, queued, started, finished, text)`, plus one row of agent state (`seen`). States and timeouts are in the spec. Expiry and the ten-minute failure are applied lazily, whenever the table is read or `next` is called, and by the existing prune timer; no new timer. The two-minute expiry is the important one: an action tapped while the agent is down must not run hours later against a different state. Queuing while the agent is absent is refused outright (`503`) for the same reason.

`next` holds the request open by keeping the response in a list of waiters that `POST /api/git/actions` resolves; a waiter is released with `204` after 25 s. A state change calls the existing `notify()` with the box's name, so open pages refetch through the stream they already have. `GET /api/git` returns `{ enabled, agent: { seen, present, at }, actions: [...] }`; the shape of `GET /api/boxes` does not change. Expiry and the ten-minute failure are also applied by a one-second timer in the server, so that they reach open pages through the stream.

### D6: Merge without a working tree, push before any local change

`git merge-tree --write-tree` (Git 2.38) computes a merge in the object database:

1. Fetch. `base` = `origin/<default>`, `src` = the branch.
2. Refuse when `src` has nothing that `base` lacks, or when the local default branch has commits that `base` lacks. The second rule keeps the action from publishing commits the user did not select; the dialog's count stays true.
3. If `base` is an ancestor of `src`: `result` = `src`. Else `git merge-tree --write-tree --name-only base src`; exit 1 means conflict, the file names are in the output; otherwise `git commit-tree <tree> -p base -p src -m "Merge branch '<src>'"` with the host user's identity.
4. `git push origin <result>:refs/heads/<default>`, not forced. A rejection ends the action; the merge commit is an unreferenced object and nothing else exists.
5. Move the local default branch to `result`: checked out, reachable, no modified tracked files → `merge --ff-only` in that checkout (as `git_apply` does for `ff`); not checked out → `update-ref` guarded by the old value; otherwise leave it and say so. The fetch that follows the push lets `origin/<default>` show the result in every case.

Alternatives: the menu's merge in a checkout (needs the default branch checked out and clean, which is no longer the normal case once branches are created in the workspace, and needs an abort path on conflict); a temporary worktree (adds and removes a worktree record in a repository whose records must stay untouched, and leaves debris when interrupted). Pushing first means the only state after a failure is the one before, which the exploration had sketched less strictly ("main stays 1 ahead").

When the host's Git is older than 2.38, `merge` refuses and names the version. Task 1.2 checks the Mini-PC before anything is built; if it is older, this decision is revisited before implementation.

### D7: Branch creation in the workspace's own checkout

Both forms run in the workspace (`GS_WS`), never in a session's worktree:

- Without `--carry`: `git checkout -b <name> --no-track origin/<default>`, refused beforehand when tracked files are modified. Git refuses on its own when an untracked file would be overwritten; that is reported as failed and nothing changed.
- With `--carry`: `git checkout -b <name>` at the current commit, which touches no file, then `update-ref refs/heads/<default> origin/<default> <old value>`. The commits stay reachable through the new branch. This is the only place where a branch is moved backwards, and it is safe because the new branch is created first and the move is guarded by the old value.

Name validation is `git check-ref-format --branch` plus the dashboard's character set, a check against local branches and `origin/<name>`.

Whether a new session then starts on the checked-out branch depends on the finding of task 1.1. If Claude Code always starts worktrees from `origin`'s default branch, the fresh form has no effect on sessions and is dropped from the dashboard before implementation; the `--carry` form keeps its value either way.

### D8: Recent confirmation through the existing sign-in

`auth_sessions.created` is the time of the passkey assertion that created the session. Queuing requires `now - created <= 10 min`; otherwise `403 { error: "confirm" }`. The page then runs the existing `signIn()`; `login/verify`, when the request already carries a valid session, ends that session and issues a new one. No new route, no new column, and the old cookie is not left valid. Alternatives: a separate confirmation route and timestamp (more surface for the same effect); no confirmation (a phone left unlocked on the dashboard could publish commits for thirty days).

The sign-in attempt limit does not count requests that carry a valid session (already so in `auth.js`), so confirming often is not throttled.

### D9: Read-only with the login off

With `CRB_DASHBOARD_AUTH=off` anyone who reaches the port could queue a push. Actions are therefore tied to the login: queuing answers `403`, `GET /api/git` reports `enabled: false`, and the page offers nothing. The demo keeps working unchanged. A switch to allow actions without the login is not added until somebody needs it.

### D10: Watcher fields

`worktreeState` already has the default ref. `behind_default` is `rev-list --count HEAD..<default ref>`, only when the default ref is a remote ref of `origin` (the existing fallback to a local `main` would measure the wrong thing); `default_branch` is that ref's short name without `origin/`. One more Git call per checkout per scan.

### D11: Page

- `lib/git.ts`: `fetchGit()`, `queueAction()` (handles `403 confirm` by calling `signIn()` and retrying once), types.
- `GitOverview` gets the action row per checkout and the box actions; a `Sheet` for the list below 768 px, opened from the compact line, closed through the URL hash (`#<box>/git`) so the back navigation works as for the detail view.
- Dialogs and the sheet are one small `Modal` in `GitPanel.tsx` (overlay, Escape for the top one only, tap outside, close control) instead of a new dialog dependency: the runtime image builds without network access to anything but the lock file, and the two uses do not need more.
- Which actions a checkout offers is derived in `shared/model.js` from the reported state (`gitActions(w, defaultBranch)`), so it is unit-tested without a browser. The dashboard offers; the agent decides. A stale offer ends as a refusal with a reason, never as a wrong action.
- The warning is its own function `gitStale(w, defaultBranch)` next to `gitStateParts`, because it is rendered apart from the other parts: first, with `TriangleAlert` and the warning color.
- After an action the box keeps showing the state from before it until its next report (see Risks). `gitSettling(last, fetched_at, now)` detects this: every action starts with a fetch, so a report from after the action carries a fetch time later than the action's start. While it holds, at most one minute, the list offers no action and says that the new state is on its way.

### D12: The agent runs in its own container

`crb agent install` writes `services/crb-agent.yaml` (first line `# Created by crb.`), lists it under `include:` in `compose.yaml`, and starts it with `docker compose up -d crb-agent`. Nothing is installed on the host. Alternatives: a systemd service of the host user (the first implementation; rejected by the user: it installs something on the host, needs lingering, and differs per host); running the agent inside the dashboard container (rejected in D1); inside a box (a box is where Claude runs, it must not hold push credentials).

The service:

- Image `ghcr.io/marc2016/claude-remote-box-agent`, built and released with the other two from `agent/Dockerfile`: Debian slim with `bash`, `git`, `curl`, `openssh-client`, `ca-certificates`, and `libnss-wrapper`. It holds no copy of `crb`: the container runs the `crb` of the mounted installation directory, so an update of the script reaches the agent through the existing re-exec without a new image.
- `user: "${UID:-1000}:${GID:-1000}"` as the boxes, so every file Git writes belongs to the host user. OpenSSH refuses a UID without a passwd entry; the entrypoint therefore writes a passwd and a group line to `/tmp` and preloads `libnss_wrapper` when `getent passwd` finds none.
- `cap_drop: [ALL]`, `no-new-privileges`, `read_only: true` with a `tmpfs` for `/tmp`, `init: true` (signals reach the agent, which is not PID 1), `hostname: crb-agent`, `restart: unless-stopped`, `stop_grace_period: 120s` (a running push or merge finishes). No port.
- Mounts: the installation directory at its own absolute path, so every path `crb git` derives (workspaces, worktrees) is the same inside and outside; every workspace outside it at its own path too; `./crb-agent` at `/agent`, the agent's home (`HOME=/agent`) with its SSH key and `known_hosts`. `~/` workspace paths resolve against `CRB_HOST_HOME`, the host user's home written into the file.
- Environment: `CRB_AGENT_DASHBOARD`; no token (the agent reads `CRB_AGENT_TOKEN` from the mounted `.env` as before, so `docker compose config` shows it for the dashboard only); `GIT_AUTHOR_*`/`GIT_COMMITTER_*` from the host's `git config --global` at install time (asked when empty; a merge commit needs them), `GIT_SSH_COMMAND` with `BatchMode=yes` and `StrictHostKeyChecking=accept-new` (the first contact records the host key), and `GIT_CONFIG_COUNT` entries that rewrite `https://<host>/` to `git@<host>:` for every host whose `origin` is an HTTPS URL, so one key serves every project without changing a repository's configuration.

Credentials (the user's choice): the agent has its own Ed25519 key without passphrase in `./crb-agent/.ssh/`, generated inside the container by `install` when missing (`docker compose run --rm --no-deps crb-agent ssh-keygen ...`), so the host needs no `ssh-keygen`. `install` and `crb agent key` print the public key and where to register it: as an SSH key of the GitHub account (or of a machine user), because a GitHub deploy key is accepted by one repository only. Revoking it there cuts the agent off without touching the user's own access. After the user confirms the registration, `install` checks it by running `./crb git --list` in the container.

`install` is repeatable: it rewrites a service file created by `crb` (new projects outside the installation directory get their mount), keeps the key, and never touches a hand-written one. `crb add` prints the hint to repeat it when an agent service exists and the new workspace is outside the installation directory. A project whose workspace the container cannot see is logged once per round as not mounted, with that hint. `uninstall` stops and removes the service, removes its `include:` line and the file, and keeps `.env` and `./crb-agent` (the key). `status` reads the container state from `docker compose ps` and the state file.

A single instance is enforced with a lock directory `.crb-agent.lock` holding the PID and the host name (`uname -n`). The lock is taken over when it was written on this host name and its PID is gone or is the agent's own; the fixed `hostname: crb-agent` makes a recreated container recognize its predecessor's lock. A lock from another host name (an agent in the foreground on the host while the container runs, or the reverse) is refused with both names. The agent writes `.crb-agent.state` (time of the last fetch round, result of the last request) for `crb agent status`. Both are in the installation directory and in `.gitignore`.

Picking up a new script: the loop compares the checksum of the script file with the one at start (`cksum`, which is the same on GNU and BSD, unlike `stat`) and, between two actions and only when `bash -n` accepts the new file, runs `exec` on it. `exec` keeps the PID, so the lock, which holds the PID, stays valid without a handover. The directory is mounted, not the file, so a replaced file is visible in the container.

Two environment variables exist for the tests only: `CRB_AGENT_FETCH_SECONDS` (the interval in seconds) and `CRB_AGENT_PAUSE_MAX` (caps every pause).

`GIT_TERMINAL_PROMPT=0` and `BatchMode=yes` are set, so a missing or unregistered key is a failed fetch in the log, not a hanging agent.

## Risks / Trade-offs

- [A signed-in browser can now publish to GitHub without review] → recent passkey confirmation, `Origin` check, `SameSite=Strict`, a fixed action vocabulary, no force-push, README security model rewritten to say so.
- [The agent token leaks] → an attacker on the Compose network could take actions out of the queue or report false results, but not queue any; the token is not in any box and the routes are closed to the proxy.
- [Agent and a manual `crb git sync` at the same time] → Git's ref locks make one of them fail with a message; nothing is lost. Not serialized beyond that.
- [The dashboard's offer is older than the repository's state] → the agent fetches and rescans before every action and refuses with the reason.
- [The page shows the old state after a successful action until the box's next report] → the watcher sends the `git` event with its heartbeat, every 30 s; in the local run of task 4.6 the new state arrived 21 s after the outcome. The result line is shown at once and stays until dismissed, and the controls are withheld until the report is in (D11, `gitSettling`), so a second tap on a stale "pushen" cannot happen.
- [The agent is not running and nobody notices] → the notice above the cards after 90 s.
- [Git older than 2.38] → the agent image brings its own Git (2.47); only `crb git merge` typed on the host depends on the host's Git, and refuses with the version.
- [Fresh branches may not influence where sessions start] → checked first (task 1.1), see D7.
- [The agent's key can push to every repository of the account] → it lives only in `./crb-agent/.ssh` (mode 700, not in any box, not in the dashboard), and is revoked on GitHub on its own. A machine user with access to the projects limits it further; the README says how.
- [`accept-new` trusts the first host key it sees] → the same as a first `git clone` by hand; a changed key later fails the fetch.
- [A workspace outside the installation directory added after `install` is not mounted] → logged per round with the hint, and `crb add` prints it.

## Migration Plan

1. Release the three images and `crb` together; the dashboard without an agent token behaves as before plus the warning.
2. `./crb update` adds `CRB_AGENT_TOKEN` to the dashboard service; `./crb agent install` creates the token, the key, and the agent's service.
3. Rollback: `./crb agent uninstall` (the key stays in `./crb-agent`); the dashboard then shows no actions once the agent has been absent, and `crb git` works as before. The table `git_actions` is ignored by an older dashboard.

## Open Questions

- The exact wording of the German texts in dialogs and results is settled during implementation against the screenshots.
