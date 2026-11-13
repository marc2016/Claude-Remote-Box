# Design

## Context

See proposal.md for the motivation. The starting point is the code of the change `host-git-sync` on the branch of the same name:

- `cmd_git` in `crb` parses `sync`, `--no-fetch`, and project names, discovers projects from `services/*.yaml`, and calls `git_project NAME SRC` once per project. `git_project` does everything in one loop per branch: it fetches, reads the state, prints the line, and, in sync mode, acts. Counters and the mode are globals (`GIT_MODE`, `GIT_FETCH`, `GIT_N_*`).
- Every Git call goes through `gq` (`-c gc.auto=0`, no stdin). Worktrees are addressed as `git --git-dir=<admin dir> --work-tree=<host path>`, so worktrees recorded with container paths work and their records stay untouched.
- The tests in `tests/crb.test.sh` run the command with piped input, as they do for `crb add`; nothing in the test setup has a terminal.
- A scratch test with Git 2.54 for this change: in a worktree whose records were rewritten to `/workspace/...`, `rebase` and `merge` through `--git-dir`/`--work-tree` complete when there is no conflict; on a conflict they exit non-zero, `diff --name-only --diff-filter=U` names the files, and `rebase --abort` or `merge --abort` restores the old HEAD with a clean checkout and an unchanged record.
- First run on the Mini-PC: five projects, among them a diverged `main` (1 ahead, 1 behind) and two new branches that `sync` would push at once.

## Goals / Non-Goals

**Goals:**
- One loop a person can follow on a phone: project, branch, action, result, back.
- The menu and `sync` cannot disagree: one function decides what a branch's state is and one applies an action.
- The overview and `sync` keep their output and exit codes exactly.

**Non-Goals:**
- A full-screen interface, cursor keys, colors, `fzf` or `gum`. Numbers and letters work in every SSH client and in the tests.
- Resolving conflicts. The menu stops at "there is a conflict" and leaves the checkout as it was.
- Resolving a diverged branch that is not checked out; that would need a temporary worktree.
- Remembering anything between runs.

## Decisions

### D1: When the menu opens
`crb git` opens the menu when the first argument is not `sync`, `--list` is absent, and `[ -t 0 ] && [ -t 1 ]`; `--menu` forces it. Everything else is the overview, as today.
- A separate subcommand (`crb git menu`) would change nothing for existing use, but the user chose the short form; shortcuts, cron, and pipes have no terminal and keep the overview.
- `--menu` exists for the tests and for unusual terminals; it is also what makes "the end of the input ends the menu" a tested path instead of an accident.
- `--no-fetch` is accepted with the menu and skips the first fetch. `--list` with `--menu` is an error.

### D2: Split `git_project` into scan, print, apply
- `git_scan NAME SRC` resolves the workspace, optionally fetches, and writes the project's state into globals: a status word for the project (`ok`, `fetch-failed`, `no-repo`, `no-origin`, `volume`, `missing`, `unsupported`), the fetch message, and one row per branch. A row is the fields of today's loop: branch, kind (`equal`, `empty`, `ff`, `push`, `pushnew`, `diverged`, `gone`, `blocked`, `unreachable`), ahead, behind, whether it is checked out, admin directory, host path, dirty flag, remote counterpart. Rows are joined by the unit separator (0x1f), which cannot occur in a ref name or a path and, not being whitespace, keeps empty fields when split with `IFS`.
- `git_row_text ROW` gives the state text ("3 hinter", "neu, 1 Commit", …); `git_apply ROW` performs the one action a row's kind allows (fast-forward, push, push with upstream) and returns the result text and Git's message.
- The overview and `sync` become loops over rows that call these; their output must stay byte-identical, which the existing checks verify without being edited.
- Bash 3.2 has no associative arrays and no namerefs: rows of the current project live in one indexed array, and the menu rescans a project after every action instead of patching rows. A rescan without a fetch is a handful of local Git calls.

### D3: Screens and input
Three screens, each printed below the previous output (no clearing, so the scrollback keeps the history and a dumb terminal works):

```text
Projekte
 1 auspex         ↑1 !1
 2 flashagenda    ↑1
 3 janus-note-vs  ↓1
 4 kuchometer     aktuell
 5 logis          aktuell
 ↑ pushen  ↓ holen  ! offen
 a alle synchronisieren
 f neu abrufen (fetch)
 q Ende
Auswahl:

auspex
 1 ! main               1 vor 1 hinter
 2 ↑ improve-call-diag… neu, 1 Commit
 3 = openspec/detect-t… neu, leer
 s Projekt synchronisieren
 f neu abrufen (fetch)
 z zurück   q Ende
Auswahl:

auspex · main
1 vor 1 hinter · divergiert
 1 Commits beider Seiten zeigen
 2 Rebase auf origin/main
 3 Merge von origin/main
 4 letzte Commits zeigen
 z zurück   q Ende
Auswahl:
```

- A project line is number, name, and the counts with the markers of the overview (`↑1 ↓2 !1`); written out ("1 pushen, 2 holen, 1 offen") it does not fit 40 columns next to a 14-character name. A legend line follows the list.
- A branch line is number, marker, name padded to 18, state: 2 + 1 + 1 + 1 + 18 + 1 + 16 = 40 columns. The overview keeps 20 for the name; the menu gives two columns to the number.
- The prompt and every confirmation are printed by the script, not by `read -p`, which stays silent without a terminal; when the input is not a terminal the choice is echoed, so a piped session reads like a typed one.
- Input is read with `read -r`; leading and trailing blanks are dropped; an empty line repeats the screen; EOF ends the menu with code 0. Letters are fixed across screens: `q` end, `z` back, `f` fetch, `s` synchronize project, `a` synchronize all.
- Actions on the branch screen are numbered in a fixed order and only those that apply are listed, so the numbers are stable for a given state.
- With more than 99 branches or projects the number column widens; nothing else changes.

### D4: Actions that sync already knows
Single-branch fetch and push call `git_apply` on the row and need no confirmation: choosing the branch and then the action is the confirmation. "Projekt synchronisieren" and "alle synchronisieren" count the `ff`, `push`, and `pushnew` rows first, print `2 pushen, 1 holen. Ausführen? (y/N)`, and run the same loop as `crb git sync` on yes. With nothing to do they say so and ask nothing.
- A failed fetch of a project disables its actions, as in `sync`: the state would be of unknown age. The project screen then shows the stored state and offers only `f` and back.

### D5: Rebase and merge
Offered only for kind `diverged`, with the branch checked out in a reachable checkout, no modified tracked files, and neither `rebase-merge`, `rebase-apply`, nor `MERGE_HEAD` in its admin directory. Then:

1. Print what will happen: the two counts, the checkout path, and that a session working there will see changed files. Ask `(y/N)`.
2. Record HEAD. Run `rebase <counterpart>` or `merge --no-edit <counterpart>` through `gq --git-dir … --work-tree …`.
3. On success: rescan, show the branch screen; the branch is now `push`.
4. On any non-zero exit: collect `diff --name-only --diff-filter=U`, run `rebase --abort` or `merge --abort`, verify that HEAD is the recorded commit, and print the conflicting files (or Git's message when there are none, for example a missing committer identity) and "bitte von Hand lösen". If the abort itself fails or HEAD differs, say so plainly with the checkout path; this is the one case that needs the user in the repository, and it must not be hidden.

- Rebase rewrites only the local commits, which are by definition not on the remote counterpart, so no force push is ever needed afterwards.
- The committer of rebased commits and the author of a merge commit is the host user's Git identity, not the identity configured for Claude in the service file; authors of rebased commits are kept. This is stated in the confirmation text's README counterpart, not on screen.
- `merge` uses Git's default message. No `--no-ff` is needed: a diverged branch can never fast-forward.
- Hooks in the repository run as for any Git command on the host.

### D6: Showing commits and files
- "Commits beider Seiten": `log --oneline --no-decorate -n 10 <counterpart>..<branch>` under "lokal:" and `<branch>..<counterpart>` under "auf origin:", each line cut to the screen width; "… und n weitere" when there are more.
- "letzte Commits": `log --oneline --no-decorate -n 5 <branch>`.
- "geänderte Dateien": `status --short --untracked-files=no` in the checkout, at most 15 lines.
All three only read and return to the branch screen.

### D7: No new state, no new files
The menu keeps nothing between runs and writes nothing outside the repositories it acts on. Exit code 0 when ended by the user or by the end of the input; argument and layout errors exit non-zero before the menu opens, as today.

## Risks / Trade-offs

- [`./crb git` in a terminal no longer prints and ends] → `--list` is in the usage text and the README; scripts are unaffected because they have no terminal. A script that allocates a terminal on purpose (`ssh -t`) would get the menu and has to add `--list`.
- [The refactoring changes the overview or `sync` by accident] → their checks in `tests/crb.test.sh` stay as they are and must pass before the menu is added (task 1.1).
- [An abort does not restore the checkout] → HEAD is compared after the abort and a mismatch is reported with the path; the precondition "no modified tracked files" means there is no uncommitted work that an abort could lose.
- [A session works in the checkout while it is rebased] → the confirmation says so; the precondition keeps uncommitted edits safe; a session that commits during the rebase makes the rebase fail and be aborted.
- [Untracked files that the incoming commits would overwrite] → Git refuses, which takes the failure path of D5.
- [Rebased commits get another committer and new hashes] → they were never on `origin`; documented in the README.
- [Menu output is not covered by a real terminal in the tests] → `--menu` uses the same code path except for the terminal check; the field test (task 5.1) covers the terminal.

## Migration Plan

Ships with `crb` through `./crb update` after `host-git-sync` is merged; no image change. Rollback is the previous `crb`.
