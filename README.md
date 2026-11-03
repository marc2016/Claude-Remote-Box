# claude-remote-box

Run [Claude Code](https://code.claude.com) on your own headless machine in a small Docker Compose service, and drive it from your phone through Remote Control. Permission prompts appear on your phone, and your code never leaves your machine.

> **Unofficial project.** claude-remote-box is not affiliated with, endorsed by, or supported by Anthropic.

## Why this one

- **A lean Compose service.** One prebuilt image, plus one service per project. No SSH, no tmux, no open ports, no Docker socket.
- **Controlled from the phone.** Each project shows up as its own environment in the Claude app under **Code**.
- **Real permission prompts.** Claude runs in the normal permission mode, not with `--dangerously-skip-permissions`. Before it runs a command, it asks on your phone and waits for your answer.
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
   |   /workspace          <- ~/code/my-project (bind)  |
   |   /home/node/.claude  <- ./my-project/config (bind)|
   +----------------------------------------------------+
```

## Requirements

- A Claude subscription that includes Remote Control (Pro, Max, Ultra, Team, or Enterprise). **API keys and `claude setup-token` tokens do not work** for Remote Control.
- Docker with Compose v2.
- Recommended: each project is a Git repository. Then every session started from the app gets its own git worktree. Other directories work too, with all sessions sharing `/workspace`.

## Quick start

```sh
mkdir claude-remote-box && cd claude-remote-box
curl -fsSLO https://raw.githubusercontent.com/marc2016/Claude-Remote-Box/main/compose.example.yaml
mv compose.example.yaml compose.yaml
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p ./my-project/config && chmod 700 ./my-project/config
```

Edit `compose.yaml`: set `CRB_NAME` and point the `/workspace` bind mount to your project. Create the config directory before the first start, as above: if it is missing, Docker creates it owned by root, and the container cannot write to it. The directory holds your login token, so keep it private.

Then run the one-time setup for that service:

```sh
# 1. Log in with your claude.ai account (opens a URL, paste the code back)
docker compose run --rm -it my-project claude auth login

# 2. Start Claude once, accept "Do you trust the files in this folder?", then type /exit
docker compose run --rm -it my-project claude

# 3. Start the server once, answer "Enable Remote Control?" with y,
#    wait for the session URL, then press Ctrl-C
docker compose run --rm -it my-project claude remote-control

# 4. Run it in the background
docker compose up -d
docker compose logs -f my-project
```

Open the Claude app, tap **Code**, and look for `my-project` (computer icon with a green dot).

Login, trust, and enablement are stored in `./my-project/config`, so they survive `docker compose down` and `up`. Back up that directory to keep the setup.

## Names in the Claude app

- `CRB_NAME` names the **environment**, shown as `Connected · my-project`.
- **Sessions** inside it are named `<CRB_NAME>-<two words>`, for example `my-project-calm-clock`. After your first prompt, the app shows that prompt as the title. Rename a session at any time with `/rename <name>`.
- The prefix only applies to sessions created after it is set. Sessions from an older setup keep their names, also after a restart. Rename them or archive them in the app.

## Adding a project

Every project is its own service with its own config directory:

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

```sh
mkdir -p ./another-project/config && chmod 700 ./another-project/config
```

Then repeat the one-time setup for `another-project`. Each project has its own login. To reset a project, stop it and empty its config directory: `docker compose stop another-project && rm -rf ./another-project/config/* ./another-project/config/.[!.]*`.

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
| `CRB_EXTRA_ARGS` | (empty) | Extra flags for `claude remote-control`, split on spaces |
| `UID` / `GID` | `1000` | User the container runs as. Set them to your host user in `.env` so files in your project keep the right owner |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | (empty) | Git identity for commits made by Claude |

Any command given to the container replaces the server, for example `docker compose run --rm -it my-project bash`.

## Screenshots

Ask Claude from the phone for a screenshot of your web app, for example "show me the start page on desktop and on a phone". Claude starts the dev server, takes the screenshots with a headless Chromium, and the images appear in the chat.

- Claude uses your project's own Playwright if it has one, otherwise `npx playwright`. The first time, it downloads Chromium for that Playwright version (about 150 MB).
- Screenshots and helper scripts go to a temporary directory, not into your project, unless you ask for them there.
- To keep the downloaded browser across `docker compose down` and `up`, mount a named volume at `/home/node/.cache/ms-playwright`, one per project, as in `compose.example.yaml`. Without it, nothing breaks; Chromium is downloaded again when needed. Use a named volume rather than a host directory: Docker creates it with the right permissions for any `UID`. Do not share it between projects.
- Only Chromium is supported. Device emulation covers phone and tablet views. WebKit and Firefox need more system libraries than the image contains.

## Your project's toolchain

The image ships Node.js 26 (LTS) on Debian 13, Git, ripgrep, the [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI, and the system libraries and fonts that a Playwright-managed Chromium needs. It contains no browser itself: each project's Playwright version downloads the browser build it expects. If Claude needs to build or test something else, extend the image:

```dockerfile
FROM ghcr.io/marc2016/claude-remote-box:0.2.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
USER node
```

Then use `build: .` instead of `image:` for that service.

## Versions and updating

Images are tagged with the project version, for example `0.2.0`. Each release pins one Claude Code version, and the built-in auto-updater is disabled.

| Tag | Meaning |
| --- | --- |
| `0.2.0` | One release. Never changes |
| `claude-2.1.316` | Newest release with this Claude Code version |
| `latest` | Newest release |

To update, change the tag in `compose.yaml` and run `docker compose pull && docker compose up -d`. The `2.1.316` tag from the very first release stays available but is not updated.

## Git workflow

Claude can commit inside `/workspace`. The container holds no push credentials, and we recommend keeping it that way: review the work and push from the host.

In `worktree` mode, sessions started from the app work in git worktrees inside your project. They are visible on the host with `git worktree list`. Clean them up with `git worktree remove <path>` or `git worktree prune`.

## Security model

What the setup protects:

- Claude can reach only `/workspace` and its own config storage. Other projects, your home directory, and the Docker socket are not mounted.
- All Linux capabilities are dropped, privilege escalation is blocked, and the user is non-root.
- No inbound ports. Remote Control works over outbound HTTPS.
- Shell commands that are not pre-approved need your confirmation on the phone.

What it does **not** protect (yet):

- **Outbound network is unrestricted.** The config storage holds your claude.ai login token. A successful prompt injection that gets a command approved could send it, or your code, somewhere else. Read permission prompts carefully. An optional egress allowlist is planned.
- Anything you approve runs with full access to the mounted project.
- The headless browser runs without its own sandbox (Playwright's default in containers), so the container is the only boundary for page content. Claude can open any URL the network allows, not only your dev server.

## Troubleshooting

Check `docker compose logs my-project` first. After a failed start, the container waits `CRB_RESTART_DELAY` seconds before it restarts.

- **`You must be logged in to use Remote Control`.** Step 1 of the quick start is missing.
- **`Workspace not trusted`.** Step 2 was skipped, or the trust question was answered with "no". Run it again.
- **`Worktree mode requires a git repository`.** `CRB_SPAWN` is set to `worktree`, but `/workspace` is not a Git repository. Check the bind mount path, remove `CRB_SPAWN`, or set it to `same-dir`.
- **Sessions are named after a random ID.** They were created before the prefix was set. Rename them with `/rename` or archive them.
- **Permission denied in `/workspace` or in the config directory.** `UID`/`GID` in `.env` do not match the owner of that directory.
- **Chromium fails with `error while loading shared libraries`.** The project's Playwright needs a library the image does not have yet. Update to a newer image, or extend the image as in "Your project's toolchain". `npx playwright install --with-deps` cannot work in the container, because it needs root.

## License

[MIT](LICENSE)
