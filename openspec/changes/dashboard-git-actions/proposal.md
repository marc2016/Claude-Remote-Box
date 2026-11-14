# Proposal

## Why

The dashboard shows how every checkout stands against `origin`, but acting on it still needs an SSH session to the host and `./crb git`. From the phone that is the slow part of the loop: seeing "2 nicht gepusht" on a card and not being able to push it there. The dashboard also only learns about new commits on `origin` when somebody happens to fetch on the host, and nothing tells the user that a session works on a branch that was cut from an old `main`.

## What Changes

- An **agent**, `crb agent`, that fetches every project at a fixed interval, collects the Git actions queued in the dashboard, runs them, and reports each result back. It runs as its own Compose service `crb-agent` next to the dashboard, with the installation directory mounted and its own SSH key; nothing is installed on the host. `crb agent install` sets it up and prints the key to register with GitHub.
- **Git actions in the dashboard**: push a branch, pull (fast-forward) a branch, synchronize a project, fetch a project now, merge a branch into the default branch and push it, and create a branch and check it out in the workspace. Each action is queued, shown with its state, and ends with the agent's result or the reason it was refused.
- **Merge into the default branch** in one step: the merge is computed without a working tree, pushed, and only then applied locally. A conflict or a rejected push leaves everything as it was.
- **Create a branch**: a new branch from `origin`'s default branch, checked out in the workspace; when the workspace's default branch has commits that are not on `origin`, they can be taken along onto the new branch, which puts the default branch back to `origin`'s state.
- The same four single actions as **non-interactive commands**: `crb git push|pull|merge|branch <project> ...`, which is what the agent runs and what can be called from a shortcut.
- A **warning on the card** when a session's branch is behind `origin`'s default branch, and a visible state when the host agent has not reported for a while; in that state no action is offered.
- A **recent passkey confirmation** before an action is accepted: a session whose passkey sign-in is older than ten minutes has to confirm with the passkey once more.
- The watcher reports, per checkout, how many commits of the default branch it lacks.
- The dashboard container keeps exactly one mount and gets no Git credentials. With `CRB_DASHBOARD_AUTH=off` the dashboard stays read-only.

Not part of this change: resolving diverged branches from the dashboard (stays in the menu of `crb git`), bringing a session's branch up to date from the dashboard (the session does that), deleting branches or worktrees, pull requests, force-pushes.

Assumptions taken from the exploration without an explicit answer, to be confirmed at review: fetch interval of five minutes; the recent passkey confirmation; diverged branches are shown but not resolved in the dashboard; no "bring up to date" control for session branches; taking commits along from the default branch is offered (answered with "ich denke ja").

## Capabilities

### New Capabilities
- `host-agent`: the agent that fetches at an interval and carries out the actions queued in the dashboard, how it authenticates to the dashboard and to `origin`, how it is set up as a Compose service, and what it never does.
- `dashboard-git-actions`: queuing Git actions in the dashboard, who may queue them, the life of an action from queued to result, the controls on the cards and in the detail view, and the warnings for a stale session branch and an absent agent.

### Modified Capabilities
- `host-git-sync`: adds the non-interactive single actions, the rule for merging a branch into the default branch, and the rule for creating a branch.
- `status-reporting`: adds the distance of a checkout to the default branch.
- `project-scaffolding`: the subcommand list gains `agent`.
- `status-dashboard`: the Git overview of the detail view carries the action controls and, on a phone, opens as a sheet; it is no longer read-only.
- `installation-update`: `crb update` adds the agent token to an existing dashboard service and tells a running agent to pick up the new script.

## Impact

- `crb`: new subcommand `agent` (`install`, `uninstall`, `status`, `key`), the generated `services/crb-agent.yaml`, new single actions under `git`, the merge and branch rules, the token in `.env` and in the generated dashboard service, `update` reconciliation. `crb git merge` on the host needs Git 2.38 or newer there; the agent brings its own.
- `crb-watch.js`: one new field per checkout in the `git` event.
- `dashboard/server`: a job table, routes for queuing and for the agent, the recency rule for sessions, pruning.
- `dashboard/web`: action controls, confirmation dialogs, action state, the two warnings.
- A third image, `claude-remote-box-agent` (`agent/Dockerfile`), in the image workflow and `release.sh`.
- `services/crb-dashboard.yaml` (generated), `compose.example.yaml`, `.env`: `CRB_AGENT_TOKEN`.
- `README.md`: a section on the agent and the actions, the Git workflow section, the security model (the dashboard can now publish commits).
- Tests: `tests/crb.test.sh`, `tests/watch.test.sh`, `dashboard/test/*`.
- Open field work this change depends on: the worktree finding of the archived `host-git-sync` task 1.1 (from which commit a new session's worktree starts) and the Git version on the Mini-PC (only for `crb git merge` typed there).
