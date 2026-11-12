# Design

## Context

See proposal.md for the motivation. What shapes the approach:

- `crb` is one bash file (bash 3.2, no associative arrays) that `./crb update` replaces in place. The host needs bash, git, curl, and Docker Compose, not Node. Projects are `services/<name>.yaml` files whose `volumes:` hold a line ending in `:/workspace"`, relative to `services/` when the workspace lies inside the installation (`crb` writes `"../<name>/workspace:/workspace"`).
- Boxes hold no push credentials and the dashboard mounts nothing; `box-status-reporting` D7 keeps acting on Git out of both. The host user has the credentials.
- Sessions in worktree mode work in Git worktrees that Claude Code creates inside the container. The repository records them with the path they have there. A scratch test with Git 2.54 shows what that means on the host: `git worktree list` marks such a worktree as `prunable`, `git -C <worktree>` fails with "not a git repository", and `git worktree prune` would delete the record of a live session. Addressing the worktree by its administrative directory works: `git --git-dir=<ws>/.git/worktrees/<id> --work-tree=<ws>/<relative path>` runs `status` and `merge --ff-only` correctly and leaves the record untouched.
- Finding on the Mini-PC (task 1.1, 2026-11-12, five projects, none sets `CRB_SPAWN`): every box logs "New sessions will be created in an isolated worktree" with capacity 1/32, yet no project has a worktree (`git worktree list` shows only the workspace on `main`) and every config directory holds only the transcript directory `-workspace`. So all sessions so far ran in `/workspace` on `main`; a worktree would only appear for an additional session started from the app, which has not happened yet. In practice `sync` therefore mostly pushes and fast-forwards `main` in a checkout a session works in, which the rule for modified tracked files covers. How Claude Code records a worktree's path and from which commit it starts one is still unobserved; D6 handles container paths, host paths, and relative records alike.
- The watcher does not send the `git` event yet (task 2.5 of `box-status-reporting`). The dashboard already stores it (`boxes.git_json`, an array of worktrees), picks a session's worktree by `cwd` or branch in `cards.js`, and renders branch, `ahead`, and `dirty` in `SessionBlock`.

## Goals / Non-Goals

**Goals:**
- One command that is safe to run at any time, also while sessions work, and that never needs a decision from the user.
- The same definition of "ahead" and "behind" in the script and in the watcher, so the dashboard and the command agree.
- No new process, no new credential, no new mount.

**Non-Goals:**
- Resolving diverged branches. The command reports them; the user merges or rebases by hand.
- A dashboard control for sync, a host agent, dashboard authentication.
- Remotes other than `origin`, submodules, Git LFS specifics.
- A timer installed by `crb`. The README shows a cron line; whether to use it stays with the user.

## Decisions

### D1: A `git` subcommand in `crb`, not a separate script or an npm script
`cmd_git` in `crb`, dispatched from `main`; `sync` and `--no-fetch` are its arguments, anything else is a project name. It reuses `die`, `warn`, the root check, and the service-file conventions, and ships through the existing self-update.
- An npm script would make Node a host requirement for a handful of Git calls; a second script file would need its own distribution next to `crb`.
- `check_host` also checks Docker Compose, which this command does not need. `cmd_git` runs only the root check and the `git` check, so it works on a host where Docker is stopped.

### D2: Project discovery from `services/*.yaml`
For each `services/<name>.yaml` except `crb-dashboard.yaml`, take the first volume entry whose target is `/workspace` and resolve the source: absolute as is, `~/` against `$HOME`, anything else relative to `services/`. A named volume (no slash in the source) is not a host directory and is skipped with a note. Without `services/` or `box.yaml` the command stops with the hint that it needs the `services/` layout.
- `docker compose config` would resolve paths exactly but needs Docker and is slow over SSH; the files `crb` writes have one fixed shape, and hand-written ones follow the README.

### D3: Remote counterpart
For a branch `b`: the configured upstream if `branch.b.merge` is set; otherwise `origin/b` if that ref exists; otherwise none. If an upstream is configured but its ref is missing after the fetch, the state is `gone`. The script reads this in one call, `git for-each-ref refs/heads --format='%(refname:short)|%(upstream:short)|%(upstream:track)'` (`[ahead n, behind m]`, `[gone]`, or empty), and falls back to `rev-list --left-right --count b...origin/b` for branches without a configured upstream. The watcher uses the same two steps per checkout.
- Only configured upstreams would miss the common case: Claude creates a session branch without tracking, and it shows as "new" forever even after a push from elsewhere.

### D4: Fetch with prune, without housekeeping, without prompts
`git -c gc.auto=0 fetch --prune origin` per project, with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND` defaulting to `ssh -o BatchMode=yes -o ConnectTimeout=10` (kept if the user set it), and `GIT_OPTIONAL_LOCKS=0` so that `status` does not even refresh an index. All later Git calls of the command also pass `-c gc.auto=0`.
- `--prune` makes "deleted on `origin`" visible. Without it a merged and deleted branch looks equal forever, and with a naive rule it would be pushed again.
- `gc.auto=0`: automatic housekeeping includes `git worktree prune`, which treats container-path worktrees as stale once they are older than the expiry. The command must not be what deletes a session's worktree record.
- Batch mode turns a passphrase or host-key prompt into a failed fetch instead of a hung shortcut.

### D5: The action per branch
From the state in D3 and whether the branch is checked out (D6):

| State | Action |
| --- | --- |
| equal | none |
| behind, not checked out | `git update-ref refs/heads/b <counterpart commit> <old commit>` (only behind, so this is a fast-forward; the old value guards against a concurrent commit) |
| behind, checked out, no modified tracked files | `merge --ff-only <counterpart>` in that checkout |
| behind, checked out, modified tracked files or checkout not reachable | none, reported |
| ahead | `git push origin b:<counterpart branch>` |
| none, with commits not on the default branch | `git push -u origin b` |
| none, no such commits | none |
| ahead and behind | none, reported |
| gone | none, reported |

- "Modified tracked files" is `status --porcelain --untracked-files=no`. Untracked files do not block: Git itself refuses a fast-forward that would overwrite one, and that refusal is reported as a failure of that branch. Counting untracked files would block every project that leaves build output around. The dashboard's `dirty` count includes untracked files, so the two can differ; the overview's note uses the script's definition.
- The default branch is `origin/HEAD` when set, else `origin/main`, else `origin/master`, as in `box-status-reporting` D7. "Commits not on the default branch" is `rev-list --count <default>..b`; it keeps fresh session branches without work off `origin`.
- Push happens regardless of local changes: only committed work leaves.
- When the fetch of a project fails, `sync` changes nothing in that project: acting on refs of unknown age could push over or pull less than what is on `origin`.
- `sync` does not accept `--no-fetch`, for the same reason.
- No confirmation step. The command is the button; a question would break the shortcut and the timer. The overview (`crb git`) is the preview.
- One failing branch does not stop the others; failures are collected and decide the exit code.

### D6: Checkouts and container-path worktrees
The workspace itself is one checkout. For every directory `<ws>/.git/worktrees/<id>`: read `gitdir` (the worktree's `.git` file as recorded), strip the trailing `/.git`; if it starts with `/workspace/`, the host path is `<ws>/<rest>`; if it exists on the host as recorded, use it; otherwise the worktree is not reachable. The branch is `git --git-dir=<admin dir> symbolic-ref -q HEAD`; detached HEADs are skipped. Commands on a reachable worktree run as `git --git-dir=<admin dir> --work-tree=<host path>`.
- Running the worktree part through `docker compose exec` would have the right paths, but it needs a running service and Docker, and makes the result depend on the container state.
- Rewriting the records to host paths (`git worktree repair`) would break the worktree for the session that uses it.
- A workspace that is itself a worktree or uses a separate Git directory (`.git` is a file) is reported as not supported; `crb add` never creates one.

### D7: Output
German, as in the rest of `crb`, one block per project, no table borders, no banner (the banner is 11 lines on a phone). A line is a marker, the branch name padded to 20 characters, and the state; that is 39 columns for the longest state without a note. The marker carries the action, because the action as a word does not fit next to a 20-character name in 40 columns: `↓` will be fast-forwarded, `↑` will be pushed, `!` is left for the user (with the reason on an indented line below), `=` needs nothing. `*` after the state marks local changes in the checkout. A legend line ends the overview.

```text
flashagenda · Fetch ok
↓ main                 3 hinter
↑ calm-clock           neu, 1 Commit
↑ feature/nav          2 vor *
! fix/login            1 vor 2 hinter
    divergiert, bitte selbst lösen

↓ fast-forward  ↑ push  ! offen
Ausführen: ./crb git sync
* lokale Änderungen im Checkout
```

`sync` prints the same lines with `✓` and the result ("3 geholt", "2 gepusht", "neu, 1 gepusht") or `✗`, the state, and Git's message folded to the width, and ends with `2 gepusht · 1 geholt · 1 offen`, plus `· n Fehler` when something failed. Branch names longer than 20 characters are cut with `…`.

### D8: Watcher fields
Per checkout in the `git` event: `remote` (`ok` | `none` | `gone`), `upstream`, `unpushed`, `behind` as in D3, computed next to the existing `ahead` and `dirty`. Per event: `fetched_at` from the modification time of `FETCH_HEAD` in the repository's common Git directory, null when the file is missing. Same 5 s timeout and same cache as the rest of the event.
- `ahead` (against the default branch) stays: it answers "did this session produce commits", which `unpushed` does not for a branch that is not on `origin`.
- The box does not fetch. `behind` and `fetched_at` are as fresh as the last `crb git` on the host; the detail view shows the age so a stale "0 hinter" is recognizable.

### D9: Dashboard storage and API
`boxes.git_json` stores `{ worktrees, fetched_at }` instead of the bare array; reading accepts both shapes, so no table change and an existing database keeps working. `GitWorktree` gains the four optional fields. `BoxCard` gains `git: { fetched_at, worktrees } | null` for the detail view; the session's `git` stays the picked worktree. `/workspace` sorts first.
- A separate table for checkouts would allow history, which nothing shows.

### D10: Git row and detail view
A pure function maps a worktree to the row's state text (spec "Cards"), used by the card and by the detail list; with `remote` undefined it returns today's "n Commits vor". The detail view gets a `GitOverview` component in the information column: the list from 768 px up, one summary line below. No buttons.

## Risks / Trade-offs

- [Worktree records differ from the assumption, for example relative paths from a newer Git, or worktrees outside `/workspace`] → task 1.1 checks a real box before anything is built on it. The explicit `--git-dir`/`--work-tree` addressing also works for relative and host-valid records; worktrees outside the workspace are pushed but not fast-forwarded.
- [A fast-forward changes files under a running session] → only with no modified tracked files and only forward, so no work is lost; Claude sees newer files than it read. Sessions that must not move can keep a local change, or the user syncs a named project.
- [`sync` publishes `main` without review] → documented in the README's "Git workflow" and "Security model"; pushes are never forced, so a protected `main` on the remote rejects them and the branch is reported as failed.
- [Every local branch with commits is pushed, including experiments] → stated in the README; branches without commits stay local. A filter is left for later if it turns out to be noise.
- [Host Git commands by the user still run housekeeping and can prune session worktrees] → the README's advice to use `git worktree prune` on the host is corrected (task 5.1); this command never triggers it.
- [Non-interactive SSH has no agent] → fetch fails fast with Git's message; the README names the fix (a key without passphrase for this host, or a deploy key).
- [Script and watcher compute the remote state separately, in bash and in Node] → both are the two Git calls of D3; one test repository layout is used in `tests/crb.test.sh` and `tests/watch.test.sh` with the same expected numbers.

## Migration Plan

`crb` reaches installations through `./crb update`; the command works at once and independently of the images. Watcher and dashboard ship with the next release of both images. Any order works: a new dashboard shows the old Git row for old boxes, an old dashboard ignores the new fields. Rollback is the previous `crb` and image tag; nothing is migrated.

## Open Questions

- From which commit Claude Code starts a new session worktree (local `main`, `origin/main`, or the workspace's HEAD). It decides only how strongly the README recommends the timer; task 1.1 records the answer.
