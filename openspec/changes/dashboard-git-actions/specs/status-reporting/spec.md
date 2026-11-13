# Spec Delta

## ADDED Requirements

### Requirement: Distance to the default branch
For every checkout in the `git` event the watcher SHALL report in `behind_default` the number of commits on the default branch of `origin` that the checkout's commit does not contain, or null when the repository has no default branch on `origin`. The event SHALL carry `default_branch`, the name of that branch without the remote's name, or null. The default branch SHALL be determined as for the existing count of commits ahead of it. The watcher SHALL derive both from the refs stored in the repository and SHALL NOT fetch or contact a remote.

#### Scenario: Branch cut from an old main
- **WHEN** a session's branch was created from `main` and the host has since fetched 12 new commits on `origin/main`
- **THEN** the `git` event lists that checkout with `behind_default: 12` and carries `default_branch: "main"`

#### Scenario: Up to date
- **WHEN** a checkout contains every commit of `origin/main`
- **THEN** its `behind_default` is 0

#### Scenario: No default branch
- **WHEN** the repository has no remote named `origin`
- **THEN** `behind_default` is null for every checkout and `default_branch` is null
