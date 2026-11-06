# Spec Delta

## MODIFIED Requirements

### Requirement: Interactive prompts with defaults
The script SHALL ask for its inputs interactively, show a default in square brackets where one exists, and accept the default on empty input. It SHALL ask for: the Git URL (optionally given as first argument instead), the service name, the clone directory, the spawn mode as a numbered choice, the permission mode as a numbered choice, whether to enable phone mode, whether to add a browser cache, and the Git author name and email. Defaults SHALL be: the service name derived from the repository name, the clone directory `./<service name>/workspace`, worktree spawn mode, the `default` permission mode, phone mode enabled, a browser cache, and the host's global Git identity. The clone directory SHALL NOT contain the config directory or lie inside it.

#### Scenario: Accept all defaults
- **WHEN** the user starts the script with `git@github.com:marc2016/FlashAgenda.git` as argument and presses Enter at every prompt
- **THEN** the summary shows service `flashagenda`, clone directory `./flashagenda/workspace`, spawn mode worktree, permission mode `default`, phone mode on, a browser cache, and the host's Git name and email

#### Scenario: URL as argument
- **WHEN** the Git URL is given as first argument
- **THEN** the script does not ask for it

## ADDED Requirements

### Requirement: Permission mode choice
The script SHALL offer the permission mode of the new service as a numbered choice of `default` (Claude asks before most actions), `acceptEdits` (file edits run without asking, commands still ask), and `auto` (Claude decides itself and asks only for risky actions). Each option SHALL carry a one-line explanation. The script SHALL NOT offer `bypassPermissions` or `dontAsk`. When the chosen mode is not `default`, the generated service SHALL pass it to the Remote Control server as `--permission-mode <mode>` through the existing extra-arguments variable; when it is `default`, the generated service SHALL NOT set that variable. The summary SHALL show the chosen mode.

#### Scenario: Auto mode chosen
- **WHEN** the user chooses `auto` and confirms
- **THEN** `docker compose config <name>` shows `CRB_EXTRA_ARGS: --permission-mode auto` for the service, and `docker compose config -q` succeeds

#### Scenario: Default mode chosen
- **WHEN** the user accepts the default at the permission prompt
- **THEN** the generated service has no `CRB_EXTRA_ARGS` entry

#### Scenario: Invalid choice
- **WHEN** the user enters `4` or `bypassPermissions`
- **THEN** the script explains the allowed choices and asks again

### Requirement: Phone mode memory file
When phone mode is enabled, the script SHALL write a file `CLAUDE.md` into `./<name>/config` after confirmation, owned by the invoking user. The file SHALL instruct Claude that the user reads and answers on a phone, SHALL ask for compact and clear replies without wide tables, long code blocks, or pasted command output, and SHALL ask to end a reply with the `AskUserQuestion` tool, recommended option first and at most four options, whenever there is a decision or a next step to choose. The script SHALL NOT overwrite an existing `CLAUDE.md` in that directory; it SHALL say that the file is kept. When phone mode is declined, the script SHALL NOT create the file. Inside the container the file SHALL be visible at `/home/node/.claude/CLAUDE.md`.

#### Scenario: Phone mode on
- **WHEN** the user accepts phone mode and confirms
- **THEN** `./<name>/config/CLAUDE.md` exists, mentions the phone, compact replies, and `AskUserQuestion`, and the summary lists the file

#### Scenario: Phone mode off
- **WHEN** the user answers `n` at the phone-mode prompt and confirms
- **THEN** `./<name>/config` exists and contains no `CLAUDE.md`

#### Scenario: Existing file kept
- **WHEN** `./<name>/config/CLAUDE.md` already exists and the user accepts phone mode
- **THEN** the file is unchanged after the script, and the output says it was kept

#### Scenario: Read by every session
- **WHEN** a session of the service starts, including a session in a git worktree
- **THEN** Claude follows the phone-mode instructions without the file being present in the repository
