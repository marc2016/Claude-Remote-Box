# Spec Delta

## Purpose

A host command that shows how every project's branches stand against `origin` and synchronizes them in both directions with one call, using the host user's Git credentials, so that no box and no dashboard ever needs to push or pull.

## ADDED Requirements

### Requirement: Git subcommand and project selection
The host script SHALL provide `crb git [project...]` and `crb git sync [project...]`, run in the directory that holds `compose.yaml`. Without project names they SHALL cover every project that has a file `services/<name>.yaml` mounting a host directory at `/workspace`, in alphabetical order, whether the file was written by `crb add` or by hand; the dashboard service is not a project. With names they SHALL cover only those and SHALL exit non-zero, before contacting any remote, when a name is unknown. A project whose workspace is not a Git repository or has no remote named `origin` SHALL be listed with that reason and skipped. When the installation keeps its services in `compose.yaml` instead of `services/`, the command SHALL say that it needs the `services/` layout and exit non-zero. The command SHALL refuse to run as root.

#### Scenario: All projects
- **WHEN** `./crb git` runs in an installation with the projects `flashagenda` and `looptalk`
- **THEN** both are fetched and listed, `flashagenda` first

#### Scenario: Named project
- **WHEN** `./crb git sync looptalk` runs
- **THEN** only `looptalk` is fetched and synchronized

#### Scenario: Unknown project
- **WHEN** `./crb git nope` runs
- **THEN** it exits non-zero with a message naming `nope`, and no fetch happened

#### Scenario: Not a repository
- **WHEN** a project's workspace is a plain directory
- **THEN** its entry reads that it is not a Git repository, and the other projects are still handled

### Requirement: Overview
`crb git` SHALL fetch `origin` for each selected project and print, per project, one line for every local branch: its name, the number of commits ahead of and behind its remote counterpart, a note when its checkout has local changes, and the action a sync would take. The remote counterpart of a branch is its configured upstream, or otherwise the branch of the same name on `origin` when one exists. The branch checked out in the workspace itself SHALL be listed first. `crb git` SHALL NOT change any local branch, working tree, or remote branch; apart from the fetch it only reads. When the fetch of a project fails, its entry SHALL say so, show the state from the last successful fetch marked as possibly outdated, and the command SHALL continue with the next project and exit non-zero at the end. With `--no-fetch` the command SHALL skip the fetch and show the stored state.

#### Scenario: Mixed state
- **WHEN** `main` is 3 commits behind `origin/main`, `feature/nav` is 2 ahead of `origin/feature/nav`, and `calm-clock` has one commit and no branch on `origin`
- **THEN** the project's entry lists `main` with "3 hinter" and the action fast-forward, `feature/nav` with "2 vor" and the action push, and `calm-clock` as new with the action push

#### Scenario: Read-only
- **WHEN** `./crb git` has run
- **THEN** every local branch points to the same commit as before, no working tree file changed, and `origin` received nothing

#### Scenario: Offline
- **WHEN** `origin` cannot be reached for one project
- **THEN** that entry says the fetch failed and shows the stored state as possibly outdated, the other projects are listed normally, and the exit code is non-zero

### Requirement: Sync rule
`crb git sync` SHALL fetch `origin` and then decide for every local branch of each selected project independently:

- equal to its remote counterpart: nothing;
- only behind: fast-forward the local branch, and the working tree of the checkout that has it checked out;
- only ahead: push it to its remote counterpart;
- no remote counterpart and at least one commit that is not on `origin`'s default branch: push it under the same name and set it as upstream;
- no remote counterpart and no such commit: nothing;
- ahead and behind: nothing, reported as diverged;
- remote counterpart configured but no longer on `origin`: nothing, reported as deleted on `origin`;
- only behind, but its checkout has modified tracked files, or the checkout cannot be reached from the host: nothing, reported with the reason.

A checkout with a detached HEAD has no branch and SHALL be skipped. The command SHALL print one line per branch with what it did or why it did nothing, and a final line with the number of branches pushed, fast-forwarded, and left for the user.

#### Scenario: Fast-forward main
- **WHEN** `main` is checked out in the workspace, clean, and 3 commits behind `origin/main`
- **THEN** after `sync` the workspace is at `origin/main` and the entry reads that `main` was fast-forwarded by 3 commits

#### Scenario: Push session branch
- **WHEN** a session's branch is 2 commits ahead of its branch on `origin`
- **THEN** after `sync` the branch on `origin` has those commits

#### Scenario: New branch with commits
- **WHEN** a session's branch has one commit and does not exist on `origin`
- **THEN** after `sync` it exists on `origin` with that commit and is the local branch's upstream

#### Scenario: New branch without commits
- **WHEN** a session's branch points to a commit that is on `origin`'s default branch
- **THEN** `sync` does not create it on `origin`

#### Scenario: Diverged
- **WHEN** a branch is 1 ahead and 2 behind its remote counterpart
- **THEN** `sync` changes neither side and reports the branch as diverged with both numbers

#### Scenario: Local changes block the pull
- **WHEN** `main` is behind and its checkout has a modified tracked file
- **THEN** `sync` leaves `main` and the file as they are and reports that local changes prevent the fast-forward

#### Scenario: Local changes do not block the push
- **WHEN** a branch is ahead and its checkout has a modified tracked file
- **THEN** `sync` pushes the committed work and leaves the file untouched

#### Scenario: Deleted on origin
- **WHEN** a branch's upstream was deleted on `origin` after a merge
- **THEN** `sync` does not push it again and reports it as deleted on `origin`

### Requirement: Limits of what sync changes
`crb git sync` SHALL NOT force-push, create merge commits, rebase, reset, stash, or discard changes, and SHALL NOT delete any branch, worktree, or worktree record, locally or on `origin`. It SHALL NOT create local branches for branches that exist only on `origin`. It SHALL only use the remote `origin`. It SHALL NOT run any command inside a container and SHALL NOT require a project's service to be running.

#### Scenario: Rejected push
- **WHEN** `origin` rejects the push of a branch
- **THEN** the branch is reported as failed with Git's message, nothing is forced, the remaining branches are still handled, and the exit code is non-zero

#### Scenario: Remote-only branch
- **WHEN** `origin` has a branch that does not exist locally
- **THEN** `sync` does not create it locally and does not list it

#### Scenario: Service stopped
- **WHEN** a project's service is not running
- **THEN** `sync` handles the project the same way

### Requirement: Unattended operation
Both commands SHALL run to the end without asking a question, so that they can be called over SSH from a phone shortcut or from a timer. Git SHALL NOT be allowed to prompt for credentials or host-key confirmation; a remote that needs such input SHALL count as a failed fetch or push. The exit code SHALL be 0 when no fetch, push, or fast-forward failed, also when branches were left for the user, and non-zero otherwise. The output SHALL be plain lines readable at 40 columns for branch names up to 20 characters.

#### Scenario: No terminal
- **WHEN** `./crb git sync` runs with no terminal attached and the remote would ask for a passphrase
- **THEN** the command does not wait for input, reports the project's fetch as failed, and exits non-zero

#### Scenario: Left for the user
- **WHEN** the only finding is one diverged branch
- **THEN** the final line counts one branch left for the user and the exit code is 0

### Requirement: Worktrees created in the container
The commands SHALL handle branches that are checked out in worktrees created inside the container, whose recorded location starts with `/workspace`: such a worktree SHALL be found at the corresponding path below the project's workspace on the host, checked for local changes there, and fast-forwarded there. A worktree whose recorded location is neither below `/workspace` nor a path that exists on the host SHALL count as not reachable; its branch can still be pushed. The commands SHALL NOT repair, rewrite, or prune worktree records, and their Git calls SHALL NOT trigger Git's automatic housekeeping in the repository.

#### Scenario: Fast-forward a session worktree
- **WHEN** a worktree recorded as `/workspace/.claude/worktrees/calm-clock` has a clean checkout of a branch that is 1 commit behind
- **THEN** `sync` fast-forwards that branch and the files in `<workspace>/.claude/worktrees/calm-clock` on the host

#### Scenario: Worktree outside the workspace
- **WHEN** a branch is checked out in a worktree recorded under `/tmp` in the container and is ahead
- **THEN** `sync` pushes the branch, and for a branch that is behind there it reports that the checkout cannot be reached

#### Scenario: Records kept
- **WHEN** `sync` has run in a repository whose worktree records point to paths that do not exist on the host
- **THEN** every worktree record is still present and unchanged
