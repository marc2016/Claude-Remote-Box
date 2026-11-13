# host-git-sync Specification

## Purpose
A host command that shows how every project's branches stand against `origin` and synchronizes them in both directions with one call, using the host user's Git credentials, so that no box and no dashboard ever needs to push or pull.

## Requirements

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
When `crb git` is run without a terminal on its input or its output, or with `--list`, it SHALL fetch `origin` for each selected project and print, per project, one line for every local branch: its name, the number of commits ahead of and behind its remote counterpart, a note when its checkout has local changes, and the action a sync would take. The remote counterpart of a branch is its configured upstream, or otherwise the branch of the same name on `origin` when one exists. The branch checked out in the workspace itself SHALL be listed first. The overview SHALL NOT change any local branch, working tree, or remote branch; apart from the fetch it only reads. When the fetch of a project fails, its entry SHALL say so, show the state from the last successful fetch marked as possibly outdated, and the command SHALL continue with the next project and exit non-zero at the end. With `--no-fetch` the command SHALL skip the fetch and show the stored state.

#### Scenario: Mixed state
- **WHEN** `main` is 3 commits behind `origin/main`, `feature/nav` is 2 ahead of `origin/feature/nav`, and `calm-clock` has one commit and no branch on `origin`
- **THEN** the project's entry lists `main` with "3 hinter" and the action fast-forward, `feature/nav` with "2 vor" and the action push, and `calm-clock` as new with the action push

#### Scenario: Read-only
- **WHEN** `./crb git --list` has run
- **THEN** every local branch points to the same commit as before, no working tree file changed, and `origin` received nothing

#### Scenario: Offline
- **WHEN** `origin` cannot be reached for one project
- **THEN** that entry says the fetch failed and shows the stored state as possibly outdated, the other projects are listed normally, and the exit code is non-zero

#### Scenario: Without a terminal
- **WHEN** `./crb git` runs from cron, with its output redirected to a file
- **THEN** the overview is written and no menu is shown

#### Scenario: List in a terminal
- **WHEN** `./crb git --list` runs in a terminal
- **THEN** the overview is printed and the command ends without a prompt

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
The overview and `crb git sync` SHALL run to the end without asking a question, so that they can be called over SSH from a phone shortcut or from a timer; only the menu asks. In every mode, including the menu, Git SHALL NOT be allowed to prompt for credentials or host-key confirmation; a remote that needs such input SHALL count as a failed fetch or push. For the overview and `crb git sync` the exit code SHALL be 0 when no fetch, push, or fast-forward failed, also when branches were left for the user, and non-zero otherwise. Their output SHALL be plain lines readable at 40 columns for branch names up to 20 characters.

#### Scenario: No terminal
- **WHEN** `./crb git sync` runs with no terminal attached and the remote would ask for a passphrase
- **THEN** the command does not wait for input, reports the project's fetch as failed, and exits non-zero

#### Scenario: Left for the user
- **WHEN** the only finding is one diverged branch
- **THEN** the final line counts one branch left for the user and the exit code is 0

#### Scenario: Sync in a terminal
- **WHEN** `./crb git sync` runs in a terminal
- **THEN** it synchronizes and ends without showing a menu or asking a question

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

### Requirement: Interactive menu
When `crb git` is run without `sync` and without `--list`, and both its input and its output are a terminal, it SHALL open a menu instead of printing the overview. With `--menu` it SHALL open the menu regardless of the terminal and read the choices from standard input. The menu SHALL first fetch `origin` for the selected projects, unless `--no-fetch` is given, and then show the project list: one numbered line per selected project with its name and a summary (the number of branches to push, to fetch, and left for the user, or that it is up to date, or the reason it cannot be handled, such as a failed fetch or a missing repository). Choosing a project SHALL show its branches as numbered lines with the same state texts as the overview, the workspace's own branch first; choosing a branch SHALL show the actions available for it. When exactly one project name is given on the command line, the menu SHALL start at that project. Every screen SHALL offer a way back and a way to end, a choice SHALL be a number or a single letter confirmed with Enter, and an input that matches no choice SHALL repeat the screen with a short note. The end of the input SHALL end the menu. The menu SHALL exit with code 0 when ended by the user. Menu lines SHALL be readable at 40 columns for branch names up to 18 characters; longer names are cut.

#### Scenario: Opens in a terminal
- **WHEN** `./crb git` runs in a terminal in an installation with five projects
- **THEN** the projects are fetched and a numbered list of the five projects with their summaries is shown, followed by a prompt

#### Scenario: Project summary
- **WHEN** a project has one branch to push, one diverged branch, and nothing to fetch
- **THEN** its line in the project list reads that 1 is to push and 1 is open

#### Scenario: From project to branch to action
- **WHEN** the user enters the number of a project and then the number of a branch that is 2 commits behind
- **THEN** the branch screen shows the branch with "2 hinter" and offers to fetch it, to show its commits, and to go back

#### Scenario: Single project named
- **WHEN** `./crb git auspex` runs in a terminal
- **THEN** the menu starts with the branches of `auspex`

#### Scenario: Wrong input
- **WHEN** the user enters `x` on a screen that has no choice `x`
- **THEN** the same screen is shown again with a note that the input is not a choice, and nothing was changed

#### Scenario: Input ends
- **WHEN** the menu runs with `--menu` and its input ends after one choice
- **THEN** the menu ends without an error and with exit code 0

#### Scenario: Read-only until an action is chosen
- **WHEN** the user opens the menu, looks at two projects and a branch, and ends it
- **THEN** no local branch, working tree file, or remote branch was changed

### Requirement: Branch and project actions in the menu
The menu SHALL offer, for a branch, only the actions that fit its state: fetching (fast-forward) for a branch that is only behind and whose checkout allows it, pushing for a branch that is only ahead or new with commits, showing the modified tracked files for a branch whose pull is blocked by them, and, for every branch, showing its latest commits. Fetching and pushing a single branch SHALL do exactly what `crb git sync` does for a branch in that state, within the limits of "Limits of what sync changes", and SHALL run without a further question. The project screen SHALL offer to synchronize the project and the project list SHALL offer to synchronize all selected projects; both SHALL apply the sync rule, and both SHALL first show how many branches will be pushed and fetched and ask for confirmation, with no as the default. After an action the menu SHALL show its result, including Git's message when it failed, and SHALL show the affected screen again with the new state. The menu SHALL offer to fetch again on the project list and on the project screen. A failed action SHALL NOT end the menu.

#### Scenario: Push one branch
- **WHEN** a project has two branches that are ahead and the user chooses one of them and then "pushen"
- **THEN** that branch is on `origin`, the other is not, and the project screen shows the first as up to date and the second still as ahead

#### Scenario: Fetch one branch
- **WHEN** the user chooses `main`, which is 2 commits behind and checked out without modified tracked files, and then the fetch action
- **THEN** the workspace is at `origin/main` and the branch screen shows `main` as up to date

#### Scenario: Synchronize a project declined
- **WHEN** the user chooses to synchronize a project with one branch to push and one to fetch and answers the confirmation with Enter
- **THEN** nothing is pushed or fetched and the project screen is shown again

#### Scenario: Synchronize all confirmed
- **WHEN** the user chooses to synchronize all projects and confirms
- **THEN** every project is handled as by `crb git sync`, the counts of pushed, fetched, and open branches are shown, and the project list shows the new summaries

#### Scenario: Blocked pull
- **WHEN** the user chooses a branch that is behind and whose checkout has a modified tracked file
- **THEN** the branch screen does not offer to fetch it, says that local changes prevent it, and offers to list the modified files

#### Scenario: Rejected push
- **WHEN** `origin` rejects the push of the chosen branch
- **THEN** Git's message is shown, the branch screen is shown again with the branch still ahead, and the menu keeps running

### Requirement: Resolving a diverged branch
For a branch that is both ahead of and behind its remote counterpart, the menu SHALL offer to show the commits of each side, labelled as local and as on `origin`, and to resolve it by a rebase of the local commits onto the remote counterpart or by a merge of the remote counterpart into the branch. Resolving SHALL be offered only when the branch is checked out in a checkout that can be reached from the host, has no modified tracked files, and has no rebase or merge in progress; otherwise the menu SHALL say why it cannot resolve the branch. Before a rebase or a merge the menu SHALL state what will happen, including that a session working in that checkout will see changed files, and SHALL ask for confirmation with no as the default. When the rebase or merge completes, the branch SHALL be only ahead and SHALL NOT be pushed by that action. When it stops on a conflict or fails for another reason, the menu SHALL abort it, so that the branch points to the same commit as before and the checkout has no modified tracked files, SHALL name the conflicting files, and SHALL say that the branch has to be resolved by hand. The menu SHALL NOT force-push, and SHALL NOT rebase or merge a branch in any state other than diverged.

#### Scenario: Show both sides
- **WHEN** the user chooses a branch that is 1 ahead and 1 behind and then to show the commits
- **THEN** the local commit and the commit on `origin` are listed under separate labels with their subjects

#### Scenario: Rebase without conflict
- **WHEN** the user chooses to rebase a diverged `main` whose local commit and remote commit touch different files, and confirms
- **THEN** `main` contains the remote commit followed by the local one, the branch screen shows "1 vor", `origin/main` is unchanged, and the menu offers to push

#### Scenario: Merge without conflict
- **WHEN** the user chooses to merge instead and confirms
- **THEN** `main` has a merge commit with both sides as parents, is ahead of `origin/main` and not behind, and `origin/main` is unchanged

#### Scenario: Conflict
- **WHEN** the local commit and the remote commit change the same line and the user confirms a rebase
- **THEN** the rebase is aborted, `main` points to the same commit as before, the checkout has no modified tracked files and no rebase in progress, and the menu names the conflicting file and says to resolve it by hand

#### Scenario: Declined
- **WHEN** the user chooses to rebase and answers the confirmation with Enter
- **THEN** nothing is changed and the branch screen is shown again

#### Scenario: Checkout has local changes
- **WHEN** the diverged branch's checkout has a modified tracked file
- **THEN** rebase and merge are not offered, and the screen says that the local changes have to be committed or discarded first

#### Scenario: Not checked out
- **WHEN** the diverged branch is not checked out in any checkout
- **THEN** rebase and merge are not offered, and the screen says that the branch has to be checked out to be resolved

#### Scenario: Worktree created in the container
- **WHEN** the diverged branch is checked out in a worktree recorded as `/workspace/.claude/worktrees/calm-clock` and the user confirms a rebase without conflict
- **THEN** the branch is rebased in `<workspace>/.claude/worktrees/calm-clock` on the host and the worktree record is unchanged
