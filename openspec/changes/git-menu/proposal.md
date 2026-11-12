# Proposal

## Why

`crb git` shows the state of every project and `crb git sync` applies one rule to all of them, but there is nothing in between: to push one branch, to hold another back, or to deal with a diverged branch, the user still has to leave the tool and type Git commands into the right checkout. The first run on the Mini-PC showed exactly that: two branches that `sync` would publish at once, and a diverged `main` that the tool can only report. A menu that walks from project to branch to action covers these cases in the same place, also from a phone over SSH.

## What Changes

- `./crb git`, when run in a terminal, opens a menu instead of printing the overview: a list of projects with a one-line summary each, then the branches of the chosen project, then the actions for the chosen branch. Choices are numbers and single letters, so it works with a phone keyboard.
- Without a terminal (phone shortcut, cron, pipe) and with the new option `--list`, `./crb git` prints the overview as before. `./crb git sync` is unchanged. `--menu` opens the menu even without a terminal and reads the choices from standard input.
- Actions in the menu: fast-forward or push a single branch, synchronize one project, synchronize all projects, show a branch's latest commits, show the changed files that block a pull, fetch again.
- New: resolving a diverged branch. The menu shows the commits of both sides and offers a rebase onto the remote branch or a merge of it, after a confirmation. If the rebase or merge hits a conflict, it is aborted and the branch and its files are as before. The result is not pushed automatically; the branch then shows as ahead and can be pushed like any other.
- Synchronizing several branches at once (a project or all projects) asks for confirmation first, with the number of branches to push and to fetch.
- README: the "Git workflow" section describes the menu and `--list`.
- Not in this change: arrow-key or fuzzy selection, conflict resolution, resolving a diverged branch that is not checked out anywhere, stashing, deleting branches, worktree cleanup, and any change to the dashboard.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `host-git-sync`: adds the requirements "Interactive menu", "Branch and project actions in the menu", and "Resolving a diverged branch"; changes "Overview" (printed without a terminal or with `--list`) and "Unattended operation" (applies to the overview and to `sync`, not to the menu). The capability is introduced by the change `host-git-sync`, which is implemented on the branch `host-git-sync` and not archived yet; this change builds on that code and has to be archived after it.

## Impact

- `crb`: `git_project` is split into reading a project's state, printing it, and applying an action to one branch, so that the overview, `sync`, and the menu share them; new menu loop, `--list` and `--menu`, usage text. Still bash 3.2 and no new host requirement.
- `tests/crb.test.sh`: the existing `git` checks must pass unchanged; new checks drive the menu through `--menu` with piped choices.
- `README.md`: "Git workflow".
- Behavior change for interactive use: someone who types `./crb git` in a terminal gets the menu and needs `--list` (or a pipe) for the plain overview. Shortcuts and timers are not affected, because they run without a terminal.
- New exposure: the menu is the first place where the tool rewrites local commits (rebase) or creates one (merge commit), with the host user's Git identity as committer. Both happen only after a confirmation, only in a checkout without modified tracked files, and never with a force push.
