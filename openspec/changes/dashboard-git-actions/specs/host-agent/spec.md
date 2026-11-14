# Spec Delta

## Purpose

A process that keeps every project's view of `origin` fresh and carries out the Git actions queued in the dashboard with its own credentials, running as a Compose service of the installation, so that the dashboard can trigger pushes and merges without ever holding a credential or seeing a workspace, and nothing has to be installed on the host.

## ADDED Requirements

### Requirement: Agent process
`crb agent`, run in the directory that holds `compose.yaml`, SHALL run in the foreground until it is stopped: it fetches at an interval and carries out queued actions, as described in this capability. It SHALL refuse to run as root, SHALL need the `services/` layout as `crb git` does, and SHALL exit non-zero with a message that names `./crb agent install` when `.env` has no `CRB_AGENT_TOKEN`. Only one agent SHALL run per installation, whether as the service or in the foreground; a second one SHALL exit non-zero and say where an agent is already running. It SHALL write one line per fetch round and one line per action with its outcome to its output, without any token. On a termination signal it SHALL finish the action it is carrying out and then end. It SHALL NOT open a listening port.

#### Scenario: Second agent
- **WHEN** `./crb agent` is started while another one runs in the same installation
- **THEN** the second exits non-zero with a message saying so, and the first keeps running

#### Scenario: Token missing
- **WHEN** `./crb agent` is started and `.env` has no `CRB_AGENT_TOKEN`
- **THEN** it exits non-zero and names `./crb agent install`

#### Scenario: Stopped during an action
- **WHEN** the agent receives a termination signal while it pushes a branch
- **THEN** the push finishes, its result is reported to the dashboard, and the agent ends

### Requirement: Periodic fetch
The agent SHALL fetch `origin` for every project at start and then every `CRB_AGENT_FETCH_MINUTES` minutes (from `.env`, default 5, at least 1), in the way the overview of `host-git-sync` fetches: no local branch, working tree, or remote branch is changed. A project whose fetch fails SHALL be logged with Git's message, and the round SHALL continue with the next project. A fetch round SHALL NOT start while an action is being carried out, and an action SHALL NOT start during a fetch round.

#### Scenario: Round
- **WHEN** the agent has run for five minutes with the default interval and `origin/main` of one project moved in the meantime
- **THEN** that project's `origin/main` is at the new commit, its local `main` and working tree are as before, and the log has one line for the round

#### Scenario: One project offline
- **WHEN** `origin` of one of three projects cannot be reached
- **THEN** the other two are fetched, the log names the failed one with Git's message, and the agent keeps running

### Requirement: Carrying out actions
The agent SHALL collect queued actions from the dashboard of its installation, over the Compose network when it runs as the service, or over the address the dashboard is published on on the same machine when it runs in the foreground, never through the reverse proxy, authenticated with `CRB_AGENT_TOKEN`. It SHALL carry them out one at a time in the order they were queued, each as the corresponding command of `host-git-sync` (`fetch`: the overview for that project; `sync`: `crb git sync` for that project; `push`, `pull`, `merge`, `branch`: the single actions), and SHALL report for each the outcome `done`, `refused` (nothing was changed), or `failed`, with the command's output shortened to at most 2000 characters. The project, branch, and name of an action SHALL be passed to Git as arguments only and SHALL never be interpreted by a shell. An action whose kind is unknown, whose project is not a project of the installation, or whose branch or name is not a valid branch name SHALL be reported as `refused` without running Git.

#### Scenario: Push queued in the dashboard
- **WHEN** a push of `calm-clock` in `flashagenda` is queued and the agent collects it
- **THEN** `calm-clock` is on `origin`, and the dashboard holds the outcome `done` with the line the command printed

#### Scenario: Unknown project
- **WHEN** an action names the project `nope`
- **THEN** the agent reports `refused` with a message naming `nope`, and no Git command ran

#### Scenario: Hostile name
- **WHEN** an action of kind `branch` carries the name `x; touch /tmp/pwned`
- **THEN** it is reported as `refused`, no file `/tmp/pwned` exists, and no branch was created

#### Scenario: Order
- **WHEN** a merge of `calm-clock` and then a push of `main` are queued for the same project
- **THEN** the merge is carried out and reported before the push starts

### Requirement: Agent token
The agent and the dashboard SHALL share `CRB_AGENT_TOKEN` from `.env`, a random value of at least 32 characters that is different from `CRB_STATUS_TOKEN`. It SHALL be passed to the dashboard service only and SHALL NOT be in the environment of any box. `crb dashboard` SHALL write the variable into the dashboard service file it generates, with an empty default.

#### Scenario: Not in a box
- **WHEN** `docker compose config` is inspected after `crb agent install`
- **THEN** `CRB_AGENT_TOKEN` appears in the environment of `crb-dashboard` and of no other service; the agent reads it from the mounted `.env`

#### Scenario: New dashboard service
- **WHEN** `crb dashboard` generates the service file
- **THEN** the file passes `CRB_AGENT_TOKEN` with an empty default

### Requirement: Dashboard not reachable
When the dashboard cannot be reached or rejects the token, the agent SHALL keep running, SHALL keep fetching at its interval, SHALL try again after at most 30 seconds, and SHALL log the reason once per change of state instead of once per attempt.

#### Scenario: Dashboard restarted
- **WHEN** the dashboard container is recreated while the agent runs
- **THEN** the agent logs that the dashboard is not reachable once, logs that it is reachable again once, and carries out actions queued afterwards

#### Scenario: Wrong token
- **WHEN** the dashboard runs with a different `CRB_AGENT_TOKEN`
- **THEN** the agent logs that its token was rejected, keeps fetching, and carries out nothing

### Requirement: Service installation
`crb agent install` SHALL, after one confirmation that lists what it will do: create `CRB_AGENT_TOKEN` in `.env` when it is missing; add the variable to a dashboard service file created by `crb` that lacks it, or print the line to add for a file that was not; recreate the dashboard when either changed; write the service file `services/crb-agent.yaml` and list it under `include:` in `compose.yaml`; create the agent's key when it has none; and start the service. It SHALL install nothing outside the installation directory and SHALL NOT call `sudo`. The service SHALL run `crb agent` of the installation directory as the user of the boxes (`UID`/`GID` from `.env`), without added capabilities, with a read-only root file system, without a published port, and without the Docker socket; it SHALL see the installation directory and every project's workspace at the same absolute paths as the host, and SHALL restart when it ends unexpectedly. When `docker compose config` rejects the result, every file SHALL be restored and nothing started. Run again, it SHALL rewrite a service file created by `crb` and keep the key; a service file not created by `crb` SHALL stay unchanged and be named. `crb agent uninstall` SHALL stop and remove the service, its file, and its `include:` line, and SHALL leave `.env` and the key unchanged. `crb agent status` SHALL print whether the service exists and runs, the time of the last fetch round, and whether the dashboard accepted the agent's last request, and SHALL exit non-zero when the agent does not run.

#### Scenario: First install
- **WHEN** `./crb agent install` is confirmed in an installation with a dashboard created by `crb` and no agent token
- **THEN** `.env` has a `CRB_AGENT_TOKEN`, the dashboard service passes it, the dashboard was recreated, `services/crb-agent.yaml` exists and is included, `docker compose ps crb-agent` shows it running, no file outside the installation directory changed, and `./crb agent status` exits 0

#### Scenario: Declined
- **WHEN** the confirmation is answered with Enter
- **THEN** `.env`, `compose.yaml`, and the files in `services/` are as before, and no container was started

#### Scenario: Hand-written dashboard service
- **WHEN** the dashboard service file was not created by `crb`
- **THEN** the file is unchanged and the output shows the line to add to it

#### Scenario: Project outside the installation directory
- **WHEN** one project's workspace is `/srv/repos/app` and `./crb agent install` has run
- **THEN** the agent's service mounts `/srv/repos/app` at `/srv/repos/app`, and a push of that project from the dashboard succeeds

#### Scenario: Files belong to the user
- **WHEN** the agent has pulled a branch with a new file
- **THEN** the new file belongs to the `UID` and `GID` of `.env`

#### Scenario: Uninstall
- **WHEN** `./crb agent uninstall` has run
- **THEN** no agent container exists, `compose.yaml` no longer includes `services/crb-agent.yaml`, `./crb agent status` exits non-zero, and `.env` and the key are unchanged

### Requirement: Agent credentials
The agent SHALL authenticate to `origin` with its own SSH key without passphrase, kept in `./crb-agent/.ssh/` of the installation and in no box and not in the dashboard. `crb agent install` SHALL create an Ed25519 key there when none exists, without needing `ssh-keygen` on the host, and SHALL print its public key with the advice to register it as an SSH key of the GitHub account or of a user with access to the projects, saying that a deploy key works for one repository only. After the user confirms that the key is registered, it SHALL check access by fetching every project in the agent's service and print the result per project. `crb agent key` SHALL print the public key. The agent SHALL record the host key of a server on first contact and SHALL reject a changed one. For a project whose `origin` is an HTTPS URL, the agent SHALL reach the same repository over SSH without the repository's configuration being changed. The agent SHALL never ask for input: a missing or rejected key SHALL be a failed fetch or action with Git's message.

#### Scenario: Key created
- **WHEN** `./crb agent install` runs and `./crb-agent/.ssh/id_ed25519` does not exist
- **THEN** afterwards it exists, is readable by the user only, and its public key was printed

#### Scenario: Key not yet registered
- **WHEN** the agent fetches with a key that GitHub does not know
- **THEN** the fetch round logs the project with Git's message about the denied key, and the agent keeps running

#### Scenario: HTTPS origin
- **WHEN** a project's `origin` is `https://github.com/me/app.git` and a push of it is queued
- **THEN** the push reaches `git@github.com:me/app.git` with the agent's key, and `git -C <workspace> remote get-url origin` still prints the HTTPS URL

#### Scenario: Key kept on reinstall
- **WHEN** `./crb agent install` runs a second time
- **THEN** the key is the same as before

### Requirement: Picking up a new script
When the file `crb` the agent was started from has been replaced, the agent SHALL finish the action it is carrying out and then continue as the new script, without the user restarting it.

#### Scenario: After an update
- **WHEN** `./crb update` replaces `crb` while the agent runs
- **THEN** within one minute the agent runs the new script, and no action was interrupted

### Requirement: Limits of the agent
The agent SHALL carry out only the action kinds named in this capability. It SHALL NOT force-push, SHALL NOT delete a branch or a worktree, SHALL NOT change a file in a working tree except through the fast-forward, the merge, and the branch creation described in `host-git-sync`, and SHALL NOT run a command that an action supplies.

#### Scenario: Unknown kind
- **WHEN** an action of kind `delete` reaches the agent
- **THEN** it is reported as `refused` and nothing was changed
