# claude-remote-box

Run [Claude Code](https://code.claude.com) on your own headless machine in a small Docker Compose service, and drive it from your phone through Remote Control. Permission prompts appear on your phone, and your code never leaves your machine.

> **Unofficial project.** claude-remote-box is not affiliated with, endorsed by, or supported by Anthropic.

> **Early preview.** The first-run flow with the Claude app has not been verified end-to-end yet. Feedback and issues are welcome.

## Why this one

- **A lean Compose service.** One prebuilt image, plus one service per project. No SSH, no tmux, no open ports, no Docker socket.
- **Controlled from the phone.** Each project shows up as its own session in the Claude app under **Code**.
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
   |   /home/node/.claude  <- my-project-config (volume)|
   +----------------------------------------------------+
```

## Requirements

- A Claude subscription that includes Remote Control (Pro, Max, Ultra, Team, or Enterprise). **API keys and `claude setup-token` tokens do not work** for Remote Control.
- Docker with Compose v2.
- Each project directory is a Git repository. This is needed for the default `worktree` spawn mode.

## Quick start

```sh
mkdir claude-remote-box && cd claude-remote-box
curl -fsSLO https://raw.githubusercontent.com/marc2016/Claude-Remote-Box/main/compose.example.yaml
mv compose.example.yaml compose.yaml
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
```

Edit `compose.yaml`: set `CRB_NAME` and point the bind mount to your project. Then run the one-time setup for that service:

```sh
# 1. Log in with your claude.ai account (opens a URL, paste the code back)
docker compose run --rm -it my-project claude auth login

# 2. Start the server once interactively and answer both prompts with "y":
#    "Enable Remote Control?" and "Trust /workspace?". Then press Ctrl-C.
docker compose run --rm -it my-project claude remote-control

# 3. Run it in the background
docker compose up -d
```

Open the Claude app, tap **Code**, and select `my-project` (computer icon with a green dot).

Login, enablement, and trust are stored in the service's config volume, so they survive `docker compose down` and `up`.

## Adding a project

Every project is its own service with its own config volume:

```yaml
services:
  another-project:
    <<: *box
    environment:
      CRB_NAME: another-project
    volumes:
      - ~/code/another-project:/workspace
      - another-project-config:/home/node/.claude

volumes:
  another-project-config:
```

Then repeat the one-time setup for `another-project`. Each project has its own login. To reset a project, remove its volume: `docker compose down another-project && docker volume rm <stack>_another-project-config`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CRB_NAME` | (required) | Session name in the Claude app |
| `CRB_SPAWN` | `worktree` | `worktree`: each new session gets its own git worktree. `same-dir`: all sessions share `/workspace` |
| `CRB_EXTRA_ARGS` | (empty) | Extra flags for `claude remote-control`, split on spaces |
| `UID` / `GID` | `1000` | User the container runs as. Set them to your host user in `.env` so files in your project keep the right owner |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` | (empty) | Git identity for commits made by Claude |

Any command given to the container replaces the server, for example `docker compose run --rm -it my-project bash`.

## Your project's toolchain

The image ships Node.js 26 (LTS) on Debian 13, Git, and ripgrep. If Claude needs to build or test something else, extend the image:

```dockerfile
FROM ghcr.io/marc2016/claude-remote-box:2.1.316
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
USER node
```

Then use `build: .` instead of `image:` for that service.

## Updating

Each image tag pins one Claude Code version, and the built-in auto-updater is disabled. To update, change the tag in `compose.yaml` and run `docker compose pull && docker compose up -d`.

## Git workflow

Claude can commit inside `/workspace`. The container holds no push credentials, and we recommend keeping it that way: review the work and push from the host.

In `worktree` mode, sessions started from the app work in git worktrees inside your project. They are visible on the host with `git worktree list`. Clean them up with `git worktree remove <path>` or `git worktree prune`.

## Security model

What the setup protects:

- Claude can reach only `/workspace` and its own config volume. Other projects, your home directory, and the Docker socket are not mounted.
- All Linux capabilities are dropped, privilege escalation is blocked, and the user is non-root.
- No inbound ports. Remote Control works over outbound HTTPS.
- Shell commands that are not pre-approved need your confirmation on the phone.

What it does **not** protect (yet):

- **Outbound network is unrestricted.** The config volume holds your claude.ai login token. A successful prompt injection that gets a command approved could send it, or your code, somewhere else. Read permission prompts carefully. An optional egress allowlist is planned.
- Anything you approve runs with full access to the mounted project.

## Troubleshooting

- **The container restarts every few seconds.** The one-time setup is missing. Check `docker compose logs my-project`, then run steps 1 and 2 of the quick start.
- **`Workspace not trusted`.** Step 2 was skipped or answered with "n". Run it again.
- **Permission denied in `/workspace`.** `UID`/`GID` in `.env` do not match the owner of your project directory.

## License

[MIT](LICENSE)
