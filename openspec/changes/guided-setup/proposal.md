# Proposal

## Why

Setting up a project today takes three separate interactive runs (`claude auth login`, `claude` for trust, `claude remote-control` for enablement) in the right order, all before `docker compose up -d`. In the first field test this went wrong in several ways: `up -d` came too early and the container looped through restarts, `docker compose exec` was impossible on a restarting container, it was unclear which step asks which question, and a config directory that Docker had created as root showed up only as a confusing login error. Setup should be one command that can run at any time, against a container that is already up.

## What Changes

- Without completed setup, the container no longer exits. It stays running, logs a setup hint periodically, and starts the Remote Control server on its own as soon as setup is complete. **BREAKING** for anyone who relied on the container exiting: a missing setup no longer produces failing restarts.
- A new `setup` command in the image runs the three official steps in order, explains each one, skips login and trust when they are already done, and marks setup as complete at the end. Step 3 is ended by the user with Ctrl-C after "Connected" appears. It works both through `docker compose exec` on a running container and through `docker compose run`.
- At start, the container checks that its config directory is writable and, if not, reports the owner and the needed `chown` instead of failing later at login. It keeps waiting, so the fix can be applied on the host without restarting.
- The container reports its state through a Docker healthcheck: healthy only while the server runs.
- Existing installations where login and trust are already present count as set up, so they keep starting the server directly after the update.
- The README quick start becomes: create the config directory, `docker compose up -d`, `docker compose exec -it <service> setup`.

Out of scope: one login shared by several projects (needs a separate spike), writing Claude Code's own config to pre-accept trust or enablement, detecting "Connected" automatically.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `container-image`: the restart throttling no longer covers missing setup; new requirements for waiting until setup is complete, the guided `setup` command, the config directory check, and the health state.
- `project-service`: the documented first-run flow changes to `up -d` followed by `exec ... setup`.

## Impact

- Changed files: `entrypoint.sh`, `Dockerfile` (new `setup` script, `HEALTHCHECK`), `README.md`, `compose.example.yaml` comments.
- New file: the `setup` script in the image.
- Compatibility: existing config directories keep working without a new setup run. Users who scripted the old three `run -it` commands can keep doing so, because the command passthrough is unchanged.
