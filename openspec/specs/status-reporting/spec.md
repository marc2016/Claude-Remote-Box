# status-reporting Specification

## Purpose
Lets a box report its phase, its sessions, and what they are doing to a status endpoint the user runs, so that a dashboard can show every box at a glance without a Docker socket or access to the config directory.

## Requirements

### Requirement: Remote tracking state
For every checkout in the `git` event the watcher SHALL additionally report the state against its remote counterpart, defined as in `host-git-sync` (the configured upstream, or otherwise the branch of the same name on `origin`): `remote` as `ok`, `none` (no counterpart), or `gone` (an upstream is configured but no longer present), the counterpart's name in `upstream`, the number of commits not on the counterpart in `unpushed`, and the number of commits only on the counterpart in `behind`; `upstream`, `unpushed`, and `behind` SHALL be null unless `remote` is `ok`. The event SHALL carry `fetched_at`, the time of the repository's last fetch, or null when it was never fetched. The watcher SHALL derive all of this from the refs stored in the repository; it SHALL NOT fetch or contact a remote.

#### Scenario: Unpushed commits
- **WHEN** a session's branch is 2 commits ahead of its upstream and the repository was fetched ten minutes ago
- **THEN** the `git` event lists that checkout with `remote: "ok"`, `unpushed: 2`, `behind: 0`, and `fetched_at` ten minutes in the past

#### Scenario: Branch not on origin
- **WHEN** a session's branch has no upstream and `origin` has no branch of that name
- **THEN** its entry has `remote: "none"` and `upstream`, `unpushed`, and `behind` are null

#### Scenario: After a host fetch
- **WHEN** the host fetches and `origin/main` moves 3 commits ahead of the checked-out `main`
- **THEN** the next `git` event reports `behind: 3` for that checkout and a newer `fetched_at`, without the box having contacted `origin`

#### Scenario: Never fetched
- **WHEN** the repository has no record of a fetch
- **THEN** `fetched_at` is null
