# Spec Delta

## MODIFIED Requirements

### Requirement: Workspace isolation
A service SHALL mount exactly one host project directory, at `/workspace`, as its only host-file access besides its own config storage and an optional browser cache storage. The browser cache storage SHALL hold only browser binaries, no credentials and no project files, and SHALL NOT be shared with the config storage. The service SHALL NOT mount the Docker socket or any other host path.

#### Scenario: Other host files unreachable
- **WHEN** Claude in the `projekt-a` service tries to read a file of `projekt-b` or the host home directory
- **THEN** the file does not exist inside the container

#### Scenario: Cache storage holds no secrets
- **WHEN** a user inspects the browser cache storage of a service that is logged in and has taken screenshots
- **THEN** it contains browser files only, and the login token exists only in the config storage
