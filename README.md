# claude-remote-box

Run [Claude Code](https://code.claude.com) on your own headless machine in a small Docker Compose service, and drive it from your phone through Remote Control. Permission prompts appear on your phone, and your code never leaves your machine.

> **Unofficial project.** claude-remote-box is not affiliated with, endorsed by, or supported by Anthropic.

## Why this one

- **A lean Compose service.** One prebuilt image, plus one service per project. No SSH, no tmux, no open ports, no Docker socket.
- **Controlled from the phone.** Each project shows up as its own environment in the Claude app under **Code**.
- **You choose how much Claude asks.** When you add a project you pick the permission mode: `default` asks on your phone before most actions, `acceptEdits` lets file edits through, `auto` lets Claude decide and asks only for risky actions. Prompts, when they happen, appear on your phone and block until you answer.
- **Made for a phone.** An optional phone mode tells Claude to keep replies short and to offer the next steps as tappable choices instead of asking you to type.
- **Hardened by default.** The container runs as non-root, with `cap_drop: ALL` and `no-new-privileges`, and sees only the one project directory you mount.

```text
 iPhone (Claude app, "Code")
        |
        v
 Anthropic Remote Control  <---- outbound HTTPS only ----+
                                                         |
 your machine                                            |
   +-- service my-project ------------------------------+
   |   claude remote-control --name my-project          |
   |   /workspace          <- ./my-project/workspace    |
   |   /home/node/.claude  <- ./my-project/config (bind)|
   +----------------------------------------------------+
```

## Requirements

- A Claude subscription that includes Remote Control (Pro, Max, Ultra, Team, or Enterprise). **API keys and `claude setup-token` tokens do not work** for Remote Control.
- Docker with Compose v2. The `crb` script needs Compose 2.20 or newer, bash, git, and curl on the host.
- Recommended: each project is a Git repository. Then every session started from the app gets its own git worktree. Other directories work too, with all sessions sharing `/workspace`.

## Quick start

```sh
mkdir claude-remote-box && cd claude-remote-box
curl -fsSLO https://raw.githubusercontent.com/marc2016/Claude-Remote-Box/main/crb
chmod +x crb
./crb add git@github.com:you/my-project.git
```

The script asks for the service name (also the name in the Claude app), where to clone the repository (default `./<name>/workspace`, next to its config), the spawn mode, the permission mode, whether to enable phone mode, an optional browser cache, and the Git identity for Claude's commits. Every question has a default; press Enter to take it. Nothing is changed until you confirm the summary. It then clones the repository, creates `./<name>/config` with mode 700, and writes `compose.yaml`, `box.yaml`, `.env`, and `services/<name>.yaml`. Do not run it as root: the config directory holds your login token and must belong to your user, or the container cannot write to it.

Then run the one-time setup for that service (here `my-project`):

```sh
docker compose up -d my-project
docker compose exec -it my-project setup
```

The service waits for setup instead of failing, so `up -d` can come first. `setup` runs three steps and explains each one:

1. **Login** with your claude.ai account: it shows a URL, you log in in any browser and paste the code back. Skipped if already logged in.
2. **Workspace trust**: Claude starts once; answer "Yes, I trust this folder", then type `/exit`. Skipped if already accepted.
3. **Enable Remote Control**: the server starts once; answer "Enable Remote Control?" with `y`, wait for "Connected" or the session URL, then press Ctrl-C. Ctrl-C ends only this step.

The waiting service starts its server a few seconds later; `docker compose ps` shows it as healthy. Open the Claude app, tap **Code**, and look for `my-project` (computer icon with a green dot).

Login, trust, and enablement are stored in `./my-project/config`, so they survive `docker compose down` and `up`. Back up that directory to keep the setup. Running `setup` again is harmless: it skips what is already done.

If the service is not running, run setup in a one-off container instead: `docker compose run --rm -it my-project setup`, then `docker compose up -d my-project`.

### Manual setup

These are the steps that `setup` runs:

```sh
docker compose run --rm -it my-project claude auth login       # 1. login
docker compose run --rm -it my-project claude                  # 2. accept trust, then /exit
docker compose run --rm -it my-project claude remote-control   # 3. answer y, wait for Connected, Ctrl-C
```

After these, the service still waits until `setup` has marked the setup as complete, unless login and trust were present when the container started (see "Upgrading to 0.3.0").

## Names in the Claude app

- `CRB_NAME` names the **environment**, shown as `Connected · my-project`.
- **Sessions** inside it are named `<CRB_NAME>-<two words>`, for example `my-project-calm-clock`. After your first prompt, the app shows that prompt as the title. Rename a session at any time with `/rename <name>`.
- The prefix only applies to sessions created after it is set. Sessions from an older setup keep their names, also after a restart. Rename them or archive them in the app.

## Adding a project

Run the script again in the same directory: `./crb add <git-url>`. It checks that the name is not taken, adds one file, and adds one line to `compose.yaml`. Then repeat the one-time setup for the new service. Each project has its own login.

The layout it creates:

```text
claude-remote-box/
  compose.yaml            include: [one line per project]
  box.yaml                shared hardening (image, user, cap_drop, ...), never started itself
  .env                    UID / GID of your user
  services/
    my-project.yaml       extends box, sets CRB_NAME and the mounts
  my-project/
    config/               login and settings, mode 700
    workspace/            the cloned repository, mounted as /workspace
```

### By hand

Write `services/another-project.yaml` (paths are relative to `services/`, see [services/example.yaml](services/example.yaml)):

```yaml
services:
  another-project:
    extends:
      file: ../box.yaml
      service: box
    environment:
      CRB_NAME: "another-project"
    volumes:
      - "/home/you/code/another-project:/workspace"
      - "../another-project/config:/home/node/.claude"
      - "another-project-browsers:/home/node/.cache/ms-playwright"   # optional, see Screenshots

volumes:
  another-project-browsers: {}
```

Add the line `- services/another-project.yaml`, indented by two spaces, below `include:` in `compose.yaml`, then create the config directory before the first start, or Docker creates it owned by root:

```sh
mkdir -p ./another-project/config && chmod 700 ./another-project/config
```

### Single-file setup

[compose.example.yaml](compose.example.yaml) keeps everything in one file, with the shared settings as a YAML anchor:

```yaml
services:
  another-project:
    <<: *box
    environment:
      CRB_NAME: another-project
    volumes:
      - ~/code/another-project:/workspace
      - ./another-project/config:/home/node/.claude
      - another-project-browsers:/home/node/.cache/ms-playwright   # optional, see Screenshots

volumes:
  another-project-browsers:
```

Both styles work side by side: the script adds an `include:` key to an existing single-file `compose.yaml` without touching its services. To move an existing service into its own file, copy its block into `services/<name>.yaml`, replace `<<: *box` with the `extends:` block above, prefix relative paths with `../`, remove the block from `compose.yaml`, add the `include:` line, and check with `docker compose config -q`. If your setup has no `.env`, the script does not create one, because that would change the user of the services that already run; it prints a hint instead. To reset a project, stop it and empty its config directory: `docker compose stop another-project && rm -rf ./another-project/config/* ./another-project/config/.[!.]*`.

### Config in a named volume

Instead of a host directory, the config can live in a Docker named volume. You do not need to create it first, and it works for any `UID`, but it is less convenient to back up and inspect:

```yaml
services:
  another-project:
    <<: *box
    volumes:
      - ~/code/another-project:/workspace
      - another-project-config:/home/node/.claude

volumes:
  another-project-config:
```

To reset it: `docker compose down another-project && docker volume rm <stack>_another-project-config`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CRB_NAME` | (required) | Environment name in the Claude app, and default session-name prefix |
| `CRB_SPAWN` | `worktree` for Git projects, `same-dir` otherwise | `worktree`: each new session gets its own git worktree. `same-dir`: all sessions share `/workspace`. If you set `worktree` explicitly, the project must be a Git repository |
| `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` | value of `CRB_NAME` | Prefix for new session names |
| `CRB_RESTART_DELAY` | `30` | Seconds to wait after the server fails before the container exits and restarts |
| `CRB_EXTRA_ARGS` | (empty) | Extra flags for `claude remote-control`, split on spaces. `crb add` and `crb update` set `--permission-mode acceptEdits` or `--permission-mode auto` here when you choose that mode; `default` leaves it empty. Other modes (`bypassPermissions`, `dontAsk`, `plan`) can be set by hand, see "Security model" |
| `CRB_STATUS_URL` | (empty) | Status endpoint, `http://` or `https://`. When set, the box reports its phase, a heartbeat, and its sessions' activity there, see "Status reporting". Empty: nothing is sent |
| `CRB_STATUS_TOKEN` | (empty) | Bearer token sent with every status request; `crb dashboard` generates it into `.env` |
| `CRB_DASHBOARD_BIND` | `127.0.0.1:8080` | Host address and port the dashboard is published on (in `.env`) |
| `UID` / `GID` | `1000` | User the container runs as. Set them to your host user in `.env` so files in your project keep the right owner |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | (empty) | Git identity for commits made by Claude |

Any command given to the container replaces the server, for example `docker compose run --rm -it my-project bash`.

## Phone mode

Phone mode is a file `CLAUDE.md` in the project's config directory, `./my-project/config/CLAUDE.md` on the host. Inside the container that directory is `/home/node/.claude`, Claude Code's user-level memory, so every session of the project reads it, including sessions in git worktrees, and it never enters your repository. The file tells Claude that you read and answer on a phone: compact replies without wide tables or pasted output, and, whenever there is a decision or a next step to choose, a question with tappable options (the `AskUserQuestion` tool, which the Claude app shows as a list) instead of an open question.

`crb add` writes it when you answer yes to the phone-mode question, and `./crb update` offers it for every project that does not have it yet. It never overwrites an existing file, so edit it freely, for example if Claude ends too many replies with a question. New sessions pick it up without a restart. To turn it off, delete the file.

## Status dashboard

One page, made for the phone, with one card per box: status and phase, permission mode, the active session with model, context size and token totals, what Claude is doing right now, and, most prominent, whether it waits for your approval. A box without setup shows the `setup` command instead. Tap a card for the session's timeline: your prompts, Claude's replies, the tool calls between them. Light and dark follow the device.

```sh
./crb dashboard        # adds the service and wires every box to it
docker compose up -d   # starts the dashboard and recreates the boxes
```

`crb dashboard` generates `CRB_STATUS_TOKEN` in `.env`, writes `services/crb-dashboard.yaml`, and adds `CRB_STATUS_URL` and `CRB_STATUS_TOKEN` to the `box` service in `box.yaml`. The dashboard keeps its SQLite database in a named volume (`crb-dashboard-data`): events for 7 days, session summaries for 90 days. It runs with the same hardening as a box and mounts nothing else: no Docker socket, no config directories, no workspaces. Its image is `ghcr.io/marc2016/claude-remote-box-dashboard`, released together with the box image under the same version.

**Where it is reachable.** By default the port is bound to `127.0.0.1:8080` on the host, so only an SSH tunnel or a reverse proxy on that machine reaches it. Set `CRB_DASHBOARD_BIND` in `.env` to change that, for example `0.0.0.0:8080` for the LAN or the address of a VPN interface such as Tailscale. **There is no login yet.** Whoever reaches the page sees your prompts and Claude's replies. Keep it on a private network or behind a VPN; authentication is planned as the next step.

To see the dashboard with dummy data on any machine with Node 22.13+ (it needs `node:sqlite`), without boxes: `cd dashboard && npm install && npm run demo`, then open `http://127.0.0.1:8080`; `PORT=8091 npm run demo` if 8080 is taken. The demo shows one box in every state, including an animated Clawd per card. For development with hot reload, `npm run dev` starts the server, Vite and the seed together; open `http://localhost:5173`.

Tap a card to open it: the card grows into a detail view with its information on the left and the conversation on the right (on a phone: information on top, conversation below), live, with your prompts as bubbles, Claude's replies as Markdown, and tool calls as compact lines that show "Freigabe ausstehend" while a session waits for you. The open box is in the URL (`#janus-note-vs`), so the back gesture closes it and a box can be linked. The session link on a card opens the session in the Claude app once the URL pattern is confirmed; until then the card offers the session id to copy. `./crb update` adds the two status variables to an installation that got the dashboard by hand. To remove the dashboard: delete `services/crb-dashboard.yaml`, its line in `compose.yaml`, and the two variables in `box.yaml`, then `docker compose up -d`.

## Status reporting

A box can report what it does to an HTTP endpoint you run, normally the status dashboard above. Set `CRB_STATUS_URL` and `CRB_STATUS_TOKEN` on the service; without the URL nothing runs and nothing is sent.

What is sent, as JSON arrays of events with the box name, a timestamp, and a sequence number: `phase` on every change (`waiting-config`, `waiting-setup`, `running`, `restarting`), a `heartbeat` every 30 s with phase, uptime, image and Claude Code version, and spawn mode, and per session `session_start`, `prompt`, `reply`, `tool` (tool name plus the command, path, or pattern), `tool_result` (ok or error), `waiting` when a tool call has had no result for 10 s (a permission prompt or a long-running command, the box cannot tell), `resumed`, `summary` after each reply (model, token totals, current context size, turns, tool calls, and cost and changed lines when the transcript has them), and `session_end` after an hour without activity.

The data comes from a small watcher process in the container that reads the session transcripts Claude Code writes in the config directory. It only reads; sessions are not slowed down. Prompts and replies are truncated to 4000 characters. Sends time out after 2 s; while the endpoint is unreachable, events are kept in a spool (newest 500) and delivered in order afterwards.

**Privacy:** your prompts and Claude's replies leave the box, to the host you configured. Use `https` or a private network when the endpoint is not on the same machine. The token only lets the endpoint tell your boxes apart from strangers; it does not encrypt anything. A receiver without a heartbeat for 90 s should treat the box as down.

## Screenshots

Ask Claude from the phone for a screenshot of your web app, for example "show me the start page on desktop and on a phone". Claude starts the dev server, takes the screenshots with a headless Chromium, and the images appear in the chat.

- Claude uses your project's own Playwright if it has one, otherwise `npx playwright`. The first time, it downloads Chromium for that Playwright version (about 150 MB).
- Screenshots and helper scripts go to a temporary directory, not into your project, unless you ask for them there.
- To keep the downloaded browser across `docker compose down` and `up`, mount a named volume at `/home/node/.cache/ms-playwright`, one per project, as in `compose.example.yaml`. Without it, nothing breaks; Chromium is downloaded again when needed. Use a named volume rather than a host directory: Docker creates it with the right permissions for any `UID`. Do not share it between projects.
- Only Chromium is supported. Device emulation covers phone and tablet views. WebKit and Firefox need more system libraries than the image contains.

## Your project's toolchain

The image ships Node.js 26 (LTS) on Debian 13, Git, ripgrep, the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI, and the system libraries and fonts that a Playwright-managed Chromium needs. It contains no browser itself: each project's Playwright version downloads the browser build it expects. The Chromium libraries add about 150 MB to the image download (about 400 MB unpacked). If Claude needs to build or test something else, extend the image:

```dockerfile
FROM ghcr.io/marc2016/claude-remote-box:0.3.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
USER node
```

Then use `build: .` instead of `image:` for that service.

## Versions and updating

Images are tagged with the project version, for example `0.3.0`. Each release pins one Claude Code version, and the built-in auto-updater is disabled.

| Tag | Meaning |
| --- | --- |
| `0.3.0` | One release. Never changes |
| `claude-2.1.316` | Newest release with this Claude Code version |
| `latest` | Newest release |

`crb add` writes `latest` into a new `box.yaml`, so the newest release is one `docker compose pull` away. To pin a release instead, set the tag in `box.yaml` or run `CRB_VERSION=0.3.0 ./crb add <git-url>`. To test an unreleased build, use `CRB_VERSION=edge`; the `edge` tag is published by a manual run of the image workflow.

### Updating

```sh
./crb update
```

One command brings the whole installation up to date, and it is safe to run at any time, also twice in a row:

1. It fetches the newest `crb` from this repository and, if it differs, replaces itself and starts over with the new version. Set `CRB_SOURCE` to a URL or a local path to fetch from somewhere else. GitHub may serve a copy that is a few minutes old right after a push.
2. If `box.yaml` pins a release tag, it offers to switch to `latest`.
3. For every project in `services/`, it shows the current permission mode and phone-mode state and asks only about what is missing: the permission mode when none is set (Enter keeps `default`) and the phone-mode file when there is none. Projects created by hand, and single-file setups with services in `compose.yaml`, are not edited; the command prints what to add where.
4. It shows a summary and changes nothing before you confirm. If `docker compose config -q` fails afterwards, the changed files are restored.
5. It runs `docker compose pull`. Services whose environment changed need `docker compose up -d <name>` to pick it up, which ends their running sessions, so the command asks first (default no) and prints the command for later.

To update by hand instead: change the tag in `box.yaml` (or in `compose.yaml` for a single-file setup) and run `docker compose pull && docker compose up -d`.

### Upgrading to 0.3.0

From 0.3.0 on, a service without completed setup waits instead of restarting, and `setup` replaces the three manual steps. Existing services need nothing: if the config already holds a login and the workspace trust when the container starts, the server starts directly. If it waits after the update, run `docker compose exec -it <service> setup` once.

When releasing: bump the image tag in `compose.example.yaml` and in the README examples. The `2.1.316` tag from the very first release stays available but is not updated.

## Git workflow

Claude can commit inside `/workspace`. The container holds no push credentials, and we recommend keeping it that way: review the work and push from the host.

In `worktree` mode, sessions started from the app work in git worktrees inside your project. They are visible on the host with `git worktree list`. Clean them up with `git worktree remove <path>` or `git worktree prune`.

## Security model

What the setup protects:

- Claude can reach only `/workspace` and its own config storage. Other projects, your home directory, and the Docker socket are not mounted.
- All Linux capabilities are dropped, privilege escalation is blocked, and the user is non-root.
- No inbound ports. Remote Control works over outbound HTTPS.
- In `default` mode, shell commands that are not pre-approved need your confirmation on the phone. In `acceptEdits` mode, file edits inside the project run without asking, commands still ask.

What it does **not** protect (yet):

- **Outbound network is unrestricted.** The config storage holds your claude.ai login token. A successful prompt injection that gets a command approved could send it, or your code, somewhere else. Read permission prompts carefully. An optional egress allowlist is planned.
- **`auto` mode moves that decision to a classifier.** With `--permission-mode auto`, Claude approves routine actions itself and asks you only for actions it judges risky. It is the mode with the least typing, and the container still limits the damage to the mounted project, but you no longer see every command before it runs, and the network and the token above are still exposed. Keep `default` if you want to see every command. `bypassPermissions` and `dontAsk` remove you from the loop entirely; the script does not offer them.
- Anything you approve runs with full access to the mounted project.
- The headless browser runs without its own sandbox (Playwright's default in containers), so the container is the only boundary for page content. Claude can open any URL the network allows, not only your dev server.

## Troubleshooting

Check `docker compose logs my-project` first. After a failed start, the container waits `CRB_RESTART_DELAY` seconds before it restarts.

- **`waiting for setup. Run on the host: docker compose exec -it <service> setup`.** Setup is not complete yet. Run it; the server starts by itself afterwards.
- **`cannot write to the config directory /home/node/.claude (owner 0:0, container runs as 1000:1000)`.** The config directory on the host belongs to another user, usually root because Docker created it. Run the printed `chown` on the host with the real path, for example `sudo chown -R 1000:1000 ./my-project/config`. The container continues by itself.
- **`server exited with status N, restarting in 30s` and `if this repeats, run setup again`.** The server failed after setup, for example because "Enable Remote Control?" was never answered or the login expired. Run `setup` again. If the log above the message mentions the permission mode, the value in `CRB_EXTRA_ARGS` is misspelled or not available for your account: fix or remove it in `services/<name>.yaml` and run `docker compose up -d <name>`; `setup` does not help in that case.
- **`You must be logged in to use Remote Control`.** The login is missing or expired. Run `setup` again.
- **`Workspace not trusted`.** The trust question was answered with "no". Run `setup` again.
- **`CRB_NAME is not set`.** The service has no `CRB_NAME` in its `environment:`. Add it; `setup` reports the same.
- **The service shows as unhealthy.** It is waiting for setup or for a writable config directory; the log says which.
- **`Worktree mode requires a git repository`.** `CRB_SPAWN` is set to `worktree`, but `/workspace` is not a Git repository. Check the bind mount path, remove `CRB_SPAWN`, or set it to `same-dir`.
- **Sessions are named after a random ID.** They were created before the prefix was set. Rename them with `/rename` or archive them.
- **Permission denied in `/workspace` or in the config directory.** `UID`/`GID` in `.env` do not match the owner of that directory.
- **Chromium fails with `error while loading shared libraries`.** The project's Playwright needs a library the image does not have yet. Update to a newer image, or extend the image as in "Your project's toolchain". `npx playwright install --with-deps` cannot work in the container, because it needs root.

## License

[MIT](LICENSE)
