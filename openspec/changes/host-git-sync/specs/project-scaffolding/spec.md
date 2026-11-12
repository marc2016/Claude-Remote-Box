# Spec Delta

## MODIFIED Requirements

### Requirement: Subcommand invocation
The host script SHALL be named `crb` and SHALL take a subcommand as its first argument: `add [git-url]` runs the project scaffolding described in this capability, `update` runs the installation update, `dashboard` adds the status dashboard, `git` runs the Git overview and sync described in `host-git-sync`, and no subcommand or an unknown one SHALL print a usage text listing all of them and exit non-zero. `crb add` SHALL behave exactly as the scaffolding script did, including its printed next steps.

#### Scenario: Add with URL
- **WHEN** the user runs `./crb add git@github.com:marc2016/FlashAgenda.git`
- **THEN** the scaffolding questions start with the service name, as before

#### Scenario: No subcommand
- **WHEN** the user runs `./crb`
- **THEN** the usage with `add`, `update`, `dashboard`, `git`, and `git sync` is printed and the exit code is non-zero
