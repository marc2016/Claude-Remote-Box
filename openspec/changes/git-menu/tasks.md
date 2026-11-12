# Tasks

## 1. Shared state and actions

- [x] 1.1 Split `git_project` in `crb` into `git_scan`, `git_row_text`, and `git_apply` (D2) and rebuild the overview and `sync` on them. Verify that `tests/crb.test.sh` passes with its existing `Git:` checks unedited, under the default bash and under `/bin/bash` 3.2, and that `shellcheck crb` reports nothing new.

## 2. Menu

- [x] 2.1 Add `--list` and `--menu` and the terminal check (D1; specs "Interactive menu", "Overview", "Unattended operation"). Verify in `tests/crb.test.sh`: without a terminal `./crb git` prints the overview and ends; `--list` does the same; `--menu` with empty input prints the project list and exits 0; `--list --menu` exits non-zero; `./crb git sync` with `--menu` absent never prompts. Update the existing checks that call `./crb git` only where they need `--list` to stay meaningful, and say which in the commit.
- [x] 2.2 Implement the three screens, navigation, and input handling (D3; spec "Interactive menu"). Verify in `tests/crb.test.sh` by piping choices to `--menu` against the fixture of the `Git: overview` checks: the project list shows each project with its summary, including a project with a failed fetch and one that is not a repository; a project number shows its branches with the workspace's branch first; a branch number shows only the actions for its state; `z` goes back one screen and `q` ends; an unknown input repeats the screen with the note; one project name on the command line starts at its branches; a session that only navigates leaves every ref, working tree, and the bare repository unchanged; the widest menu line for an 18-character branch name is at most 40 columns.

## 3. Actions

- [x] 3.1 Implement single-branch fetch and push, project and all-project synchronization with the count and confirmation, fetch again, and the read-only views (D4, D6; spec "Branch and project actions in the menu"). Verify in `tests/crb.test.sh`, one check per scenario of that requirement: pushing one of two ahead branches leaves the other local; fetching `main` moves the workspace; declining the project confirmation changes nothing; confirming "alle" gives the same refs as `crb git sync` on an identical fixture and prints the three counts; a blocked branch offers no fetch and lists the modified file; a push rejected by a `pre-receive` hook shows Git's message, keeps the branch ahead, and the menu accepts the next choice.
- [x] 3.2 Implement showing both sides, rebase, and merge with preconditions, confirmation, and abort (D5; spec "Resolving a diverged branch"). Verify in `tests/crb.test.sh`, one check per scenario: both sides listed under their labels; rebase without conflict gives remote commit then local commit, `origin` unchanged, state "1 vor"; merge without conflict gives a commit with two parents; a conflicting rebase and a conflicting merge each leave HEAD, the working tree, and the admin directory (no `rebase-merge`, no `MERGE_HEAD`) as before and name the file; declining changes nothing; a checkout with a modified tracked file and a branch that is not checked out offer neither action and give the reason; a rebase in a worktree with container-path records succeeds and leaves the `gitdir` record byte-identical; a checkout with a rebase already in progress offers neither action.

## 4. Documentation

- [x] 4.1 Update the README section "Git workflow": the menu with one example screen, `--list` for the plain overview, that shortcuts and cron are unaffected, what rebase and merge do (confirmation, abort on conflict, never pushed automatically, committer is the host user), and the usage text and header comment of `crb`. Verify by running every command the section shows against a test installation and comparing the example screen with real output.

## 5. Field test

- [ ] 5.1 On the Mini-PC with the new `crb`: open the menu over SSH from the phone, navigate to `auspex`, show both sides of `main`, resolve it by rebase or merge, and push it from the menu; push one of the new branches alone and leave the other. Verify on GitHub that exactly those branches arrived, that `./crb git --list` afterwards shows `auspex` `main` as up to date, and that every screen was readable on the phone without horizontal scrolling.
