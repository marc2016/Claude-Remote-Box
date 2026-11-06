# Tasks

## 1. Script: permission mode

- [x] 1.1 Add the permission-mode menu to `add-project.sh` after the spawn mode (D2, D4): options `default`, `acceptEdits`, `auto` with one-line explanations, `1` preselected, numbers or names accepted, anything else re-asks. Verify by running the script with `4` then `bypassPermissions` then `3`: two warnings, then `auto` in the summary.
- [x] 1.2 Write `CRB_EXTRA_ARGS: "--permission-mode <mode>"` into `services/<name>.yaml` only for a non-default mode and show `Permission:` in the summary (D1). Verify with `docker compose config <name>` that `auto` yields `CRB_EXTRA_ARGS: --permission-mode auto` and `default` yields no `CRB_EXTRA_ARGS`.

## 2. Script: phone mode

- [x] 2.1 Add the phone-mode question (default yes) after the permission mode and embed the template from D3 as a heredoc. On confirmation write `./<name>/config/CLAUDE.md`, keep an existing file and say so, skip on no; print the outcome in the config step and list the file in the summary. Verify with three runs: default answer creates the file with the D3 content, `n` creates none, a pre-existing file with other content is unchanged and the output says it was kept.
- [x] 2.2 Make sure the declined summary still changes nothing and the rollback on an invalid compose result keeps the file like the config directory. Verify with the existing "declined" and "rollback" test scenarios after updating their answer sequences.

## 3. Tests

- [x] 3.1 Update every answer sequence in `tests/add-project.test.sh` for the two new prompts (D4) and add checks: `auto` flag in `docker compose config`, no flag for default, invalid choice re-asked, `CLAUDE.md` written with phone and `AskUserQuestion` mentions, not written on `n`, existing file kept, summary shows `Permission:` and `Phone mode:`. Verify that `tests/add-project.test.sh` passes and `shellcheck add-project.sh tests/add-project.test.sh` is clean.

## 4. Documentation

- [x] 4.1 Update the README (D5): "Why this one" bullet, quick-start sentence listing the new questions, configuration table entry for `CRB_EXTRA_ARGS` with the mode example, a "Phone mode" section with the file's purpose, its path in the container, and how to add it to an existing project, the security-model paragraph on `auto`, and a troubleshooting entry for a server that exits because of an invalid or unavailable permission mode. Verify that every new prompt and the file path appear in the README and that the old "Real permission prompts" wording is gone.
- [x] 4.2 Update the `CRB_EXTRA_ARGS` comment in `compose.example.yaml` to say the script asks for the mode, and confirm `docker compose -f compose.example.yaml config -q` passes.

## 5. Field test

- [ ] 5.1 On the Mini-PC, set `janus-note-vs` to `auto` and add the phone-mode file by hand as the README describes, restart the service, and use it from the phone for a few sessions. Verify that the server starts with `--permission-mode auto`, that Claude's replies are short and end with tappable choices when there is a decision, and that a worktree session also follows the file. Record in design.md under D2 whether `auto` was accepted and whether the preselection should switch.
