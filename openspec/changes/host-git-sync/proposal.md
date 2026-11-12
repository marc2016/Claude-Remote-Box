# Proposal

## Why

Work that Claude commits in a box stays on the machine until someone logs in, finds the right checkout or worktree, and runs `git push` by hand; in the other direction, `main` in the workspace goes stale without a manual `git pull`. The dashboard cannot tell either: its Git row only knows commits ahead of the default branch, not whether they are on `origin`, and the watcher does not send Git state at all yet. A single host command that shows and synchronizes every project, plus the push state on the dashboard, closes that gap without giving a container push credentials.

## What Changes

- New subcommand `./crb git [project...]`: fetches `origin` for every project (or the named ones) and prints, per project, `main` and every local branch with commits ahead and behind its remote counterpart and what a sync would do.
- New subcommand `./crb git sync [project...]`: after the fetch, applies one rule per branch: fast-forward when only behind, push when only ahead, push with upstream for a new branch that has commits, and report without acting when the branch has diverged, its remote branch was deleted, or the checkout has local changes. It never forces, merges, rebases, or deletes, and it runs without questions so it can be called from a phone shortcut over SSH or from a timer.
- Both commands work with worktrees created inside the container, whose recorded paths start with `/workspace` and are not valid on the host.
- The watcher's `git` event additionally reports, per checkout, the remote counterpart, commits not pushed, and commits behind, and once per repository the time of the last fetch. Still read-only and without network access: the host's fetch updates the refs the box reads.
- The dashboard card's Git row shows the push state ("2 nicht gepusht", "3 hinter", "nicht auf origin", "gepusht") next to the changed-file count. The detail view lists every checkout of the box with ahead, behind, and the age of the last fetch.
- README: the "Git workflow" section describes the two commands, the phone shortcut, an optional timer, and states that `sync` pushes `main` without a review step.
- Not in this change: a push or pull control on the dashboard (needs dashboard authentication and a host agent), credentials in a box or in the dashboard, pull requests, merging, and worktree cleanup.

## Capabilities

### New Capabilities
- `host-git-sync`: the `crb git` and `crb git sync` host commands: project discovery, fetch, the per-branch overview, the sync rule and its safety limits, non-interactive operation, and handling of container-created worktrees.

### Modified Capabilities
- `status-reporting`: adds the requirement "Remote tracking state" to the `git` event (remote counterpart, unpushed, behind, last fetch). The capability is introduced by the change `box-status-reporting`, which is not archived yet; this change builds on its requirement "Git state" and its open task 2.5.
- `status-dashboard`: "Box and session state" derives the push state and a per-box list of checkouts; "Cards" changes the content of the Git row; "Session detail view" adds the Git overview.
- `project-scaffolding`: "Subcommand invocation" lists `git` as a subcommand and in the usage text.

## Impact

- `crb`: new `cmd_git` with project discovery from `services/*.yaml`, usage text, `main` dispatch. No new host requirement: bash, git, and the push credentials the host user already has.
- `crb-watch.js`: the `git` event (task 2.5 of `box-status-reporting` is a prerequisite) gains four fields.
- `dashboard/`: `shared/types.ts`, `server/db.js` (stored shape of the Git state, still reading the old one), `server/cards.js`, `web/src/components/BoxCard.tsx`, `DetailView.tsx`, `seed.mjs`, tests.
- `tests/crb.test.sh`, `tests/watch.test.sh`, `dashboard/test/`.
- `README.md`: "Git workflow", usage, "Security model" note on pushing `main`.
- Compatibility: a new dashboard with an old box, and the reverse, keep working; the Git row falls back to today's text when the new fields are missing.
- Security model unchanged: boxes and dashboard hold no credentials and mount nothing new. The new exposure is on the host: one command now publishes whatever was committed, including on `main`.
