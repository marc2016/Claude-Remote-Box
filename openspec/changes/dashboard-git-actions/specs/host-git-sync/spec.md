# Spec Delta

## ADDED Requirements

### Requirement: Single actions
The host script SHALL provide four actions that handle one branch of one project without a menu and without a question: `crb git push <project> <branch>`, `crb git pull <project> <branch>`, `crb git merge <project> <branch>`, and `crb git branch <project> <name> [--carry]`. Each SHALL fetch `origin` for that project first and SHALL change nothing when the fetch fails. `push` SHALL push the branch exactly when the sync rule would push it, and `pull` SHALL fast-forward it exactly when the sync rule would fast-forward it; in every other state they SHALL change nothing and say why. `merge` and `branch` follow the requirements below. Each action SHALL print its result in plain lines readable at 40 columns and SHALL exit with 0 when it did what was asked, with 3 when it refused and changed nothing, and with 1 when it failed. An unknown project, a missing argument, or a name that is not a valid branch name SHALL count as refused. The actions SHALL obey the limits of sync: no force-push, no deleted branch, no prompt from Git.

#### Scenario: Push one branch
- **WHEN** `./crb git push flashagenda calm-clock` runs and `calm-clock` has two commits and no branch on `origin`
- **THEN** `calm-clock` is on `origin` with its upstream set, no other branch was pushed, and the exit code is 0

#### Scenario: Pull blocked
- **WHEN** `./crb git pull flashagenda main` runs and the workspace has a modified tracked file
- **THEN** `main` and the working tree are as before, the output says that local changes prevent it, and the exit code is 3

#### Scenario: Nothing to push
- **WHEN** `./crb git push flashagenda main` runs and `main` equals `origin/main`
- **THEN** nothing is pushed, the output says that the branch is up to date, and the exit code is 3

#### Scenario: Diverged
- **WHEN** `./crb git push flashagenda main` runs and `main` is ahead of and behind `origin/main`
- **THEN** nothing is pushed, the output says that the branch has diverged, and the exit code is 3

#### Scenario: Offline
- **WHEN** `origin` cannot be reached
- **THEN** nothing is changed, the output says that the fetch failed, and the exit code is 1

#### Scenario: Project named like an action
- **WHEN** `./crb git push` runs without further arguments
- **THEN** the exit code is 3 with a message showing the arguments it needs, and no project is fetched

### Requirement: Merging a branch into the default branch
`crb git merge <project> <branch>` SHALL bring the commits of a local branch into the default branch of `origin` and publish the result, in one step. It SHALL refuse, changing nothing, when: the branch does not exist or is the default branch itself; the branch has no commit that is not on `origin`'s default branch; the local default branch has commits that are not on `origin`; or the two sides conflict, in which case the output SHALL name the conflicting files. Otherwise it SHALL compute the merge on top of `origin`'s default branch without changing any working tree, as a fast-forward when the branch already contains `origin`'s default branch and as a merge commit with both sides as parents otherwise, and SHALL push the result to the default branch on `origin`. Only after `origin` accepted it SHALL it move the local default branch to the result: together with its files where that branch is checked out in a checkout that can be reached from the host and has no modified tracked files; the reference alone where it is not checked out; and not at all otherwise, in which case the output SHALL say that the local default branch is now behind and why. When `origin` rejects the push, no local branch and no working tree SHALL have changed. Uncommitted changes in the merged branch's checkout are not part of the merge and SHALL NOT prevent it. The merged branch and its checkout SHALL be left as they are.

#### Scenario: Merge commit
- **WHEN** `calm-clock` has two commits, `origin/main` has one commit that `calm-clock` lacks, both touch different files, and `./crb git merge flashagenda calm-clock` runs
- **THEN** `origin/main` is a merge commit with the previous `origin/main` and `calm-clock` as parents, the workspace on `main` shows the merged files, `calm-clock` points to the same commit as before, and the exit code is 0

#### Scenario: Fast-forward
- **WHEN** `calm-clock` contains `origin/main` and has two commits more
- **THEN** `origin/main` and the local `main` point to the tip of `calm-clock` and no merge commit was created

#### Scenario: Conflict
- **WHEN** `calm-clock` and `origin/main` change the same line
- **THEN** `origin/main`, the local `main`, and every working tree are as before, the output names the conflicting file, and the exit code is 3

#### Scenario: Default branch not checked out
- **WHEN** the workspace has `feature/nav` checked out and `calm-clock` is merged
- **THEN** `origin/main` and the local `main` are at the result and the files in the workspace are unchanged

#### Scenario: Workspace has local changes
- **WHEN** the workspace on `main` has a modified tracked file and `calm-clock` is merged
- **THEN** `origin/main` is at the result, the local `main` and the workspace's files are as before, and the output says that `main` is behind because of local changes

#### Scenario: Unpushed commits on the default branch
- **WHEN** the local `main` has one commit that is not on `origin`
- **THEN** nothing is changed, the output says that `main` has to be pushed or moved to a branch first, and the exit code is 3

#### Scenario: Push rejected
- **WHEN** `origin` rejects the push of the result
- **THEN** the local `main`, `calm-clock`, and every working tree are as before, the output shows Git's message, and the exit code is 1

#### Scenario: Uncommitted work in the session's checkout
- **WHEN** the worktree of `calm-clock` has a modified tracked file
- **THEN** the merge contains the commits of `calm-clock` only, and that worktree is unchanged

### Requirement: Creating a branch
`crb git branch <project> <name>` SHALL create a local branch and check it out in the workspace's own checkout. It SHALL refuse, changing nothing, when a local branch or a branch on `origin` of that name exists, when the workspace has no branch checked out, or when `origin` has no default branch. Without `--carry` the new branch SHALL start at `origin`'s default branch, and the action SHALL refuse when the workspace has modified tracked files. With `--carry` the action SHALL require that the workspace has the default branch checked out and that this branch has commits that are not on `origin`, and SHALL refuse otherwise; the new branch SHALL then start at the workspace's current commit, so that no file changes and local modifications stay as they are, and the local default branch SHALL be moved to `origin`'s default branch. In both forms the new branch SHALL have no upstream and SHALL NOT be pushed, and no commit SHALL become unreachable.

#### Scenario: Fresh branch
- **WHEN** the workspace is on `main`, 3 commits behind `origin/main`, without local changes, and `./crb git branch flashagenda feature/nav` runs
- **THEN** the workspace has `feature/nav` checked out at `origin/main`, the local `main` points to the same commit as before, `origin` has no `feature/nav`, and the exit code is 0

#### Scenario: Taking commits along
- **WHEN** the workspace is on `main` with 2 commits that are not on `origin` and one modified tracked file, and `./crb git branch flashagenda rescue --carry` runs
- **THEN** the workspace has `rescue` checked out at the same commit as before with the same modified file, the local `main` equals `origin/main`, and the 2 commits are on `rescue`

#### Scenario: Nothing to take along
- **WHEN** `--carry` is given and the local `main` equals `origin/main`
- **THEN** nothing is changed and the output says that `main` has no commits of its own

#### Scenario: Local changes without carry
- **WHEN** the workspace has a modified tracked file and no `--carry` is given
- **THEN** no branch is created, the workspace is as before, and the exit code is 3

#### Scenario: Name taken
- **WHEN** `origin` already has a branch `feature/nav`
- **THEN** no branch is created and the output says that the name is taken

#### Scenario: Invalid name
- **WHEN** the name is `-x` or `a..b` or contains a space
- **THEN** no branch is created and the exit code is 3
