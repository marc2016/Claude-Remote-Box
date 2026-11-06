# Design

## Context

See proposal.md for motivation. What shapes the approach:

- `claude remote-control` in the pinned Claude Code version accepts `--permission-mode <mode>` with `acceptEdits, auto, bypassPermissions, default, dontAsk, plan`, applying to every session the server spawns. The entrypoint and `setup` step 3 already append `CRB_EXTRA_ARGS` to the server command, and `compose.example.yaml` already shows `--permission-mode auto` there as a commented example.
- The config directory `./<name>/config` is mounted at `/home/node/.claude`, which is both `CLAUDE_CONFIG_DIR` and Claude Code's user-level memory location (`~/.claude/CLAUDE.md`). A file there is read by every session of that project, in `/workspace` and in worktrees, and never enters the repository.
- `add-project.sh` is downloaded standalone with `curl`, so anything it writes must be embedded in it. It already follows the pattern "ask with default, only write what differs from the default" for `CRB_SPAWN`.
- The first change (`initial-compose-service`, D3) decided not to expose the permission mode as a first-class variable because prompting was the product's point. This change reverses the product stance, not the technical reason: the container still needs nothing from the mode, so passing it through stays the right mechanism.
- The Claude app shows `AskUserQuestion` as a tappable list (confirmed on the phone), which is what makes the phone-mode file worthwhile.

## Goals / Non-Goals

**Goals:**
- Both choices are made once, at project creation, by the host script, and are visible in plain files the user can edit later.
- No image change; the change ships independently of `v0.3.0`.
- The old "prompts are the point" positioning is replaced consistently in the README, including the security consequences of `auto`.

**Non-Goals:**
- Changing the mode or the phone-mode file of an existing service from the script.
- Verifying whether `auto` is available for the user's subscription; the field test covers that.
- Touching the managed `/etc/claude-code/CLAUDE.md` in the image.

## Decisions

### D1: Pass the mode through `CRB_EXTRA_ARGS`, no new variable
The script writes `CRB_EXTRA_ARGS: "--permission-mode <mode>"` for a non-default choice. The container does not interpret the mode, so a dedicated variable would only add code and a release dependency.
- *Alternative: `CRB_PERMISSION_MODE` read by the entrypoint.* Rejected for now. It would allow a friendlier error for a mistyped mode and a future availability fallback, but needs image support and a release; it can be introduced later without changing the generated files' meaning. The condition for revisiting: the container has to act on the mode (validation, fallback, display in `setup`).
- *Alternative: `permissions.defaultMode` in Claude Code's `settings.json` in the config directory.* Rejected. Foreign JSON to merge, and the precedence between that file and `--permission-mode` is unknown.
- A hand-edited `CRB_EXTRA_ARGS` with an invalid mode makes the server exit non-zero; the existing restart delay and "run setup again" message apply. The README troubleshooting gets an entry for that, because the message is misleading in this case.

### D2: Offer three modes, preselect `default`
The menu lists `default`, `acceptEdits`, `auto`, each with a one-line explanation, in that order, with `1` preselected. `bypassPermissions` and `dontAsk` remove the user from the loop entirely while the container has unrestricted outbound network and holds the login token; they stay a hand-edit. `auto` keeps a classifier in the loop and is the mode that matches "little typing", but its availability per subscription is unknown, so it is not preselected yet.
- Condition for switching the preselection to `auto`: a project has run in `auto` mode for at least a week of regular use from the phone without the server refusing the mode and without a case where the user would have wanted a prompt. Record the outcome here; switching is a one-line change plus the README.

### D3: Phone mode as a user-level `CLAUDE.md` in the config directory
The script embeds the template as a heredoc and writes it to `./<name>/config/CLAUDE.md` on a yes (default yes). The file is owned by the invoking user like the directory. An existing file is never overwritten, so the user's edits survive a re-run.
- *Alternative: managed `/etc/claude-code/CLAUDE.md` in the image.* Rejected for the opinionated part. It cannot be switched off per project, changing it needs a new image, and whether Remote Control sessions load it at all is still open (`browser-screenshots` task 1.1). The user-level file is known to be read in every session.
- *Alternative: `CLAUDE.md` in `/workspace`.* Rejected. It would live in the user's repository and reach every collaborator.
- Template content (English, so it matches the managed file and Claude Code's own conventions):

```markdown
# Phone mode

The user reads and answers on a phone. The screen is small, typing is slow,
tapping is easy.

## Replies

- Keep every reply compact: a few short sentences or a short list, then stop.
- Lead with the result or the answer. Details only when asked.
- No wide tables, no long code blocks, no pasted command output. Summarize
  instead; the user can ask for the full version.
- Use headings only when a reply really has several parts.

## Choices instead of typing

- Whenever there is a decision or a next step to choose, end your reply with
  the AskUserQuestion tool. Put the recommended option first, at most four.
- Prefer questions with options over open questions.
- When a task is finished, offer the sensible follow-ups as a choice.
```

- "Whenever there is a decision" rather than "always": a list after every reply, including plain status updates, would be noise. The wording is expected to need tuning after a few days of use, which is why the file is editable on the host.

### D4: Question order and summary
The two new questions follow the spawn mode, before the browser cache, so the questions about how sessions behave sit together. The summary gains `Permission:` and `Phone mode:` lines, and the config step prints whether `CLAUDE.md` was written, kept, or skipped. Test answer sequences gain two entries at that position.

### D5: README positioning
"Real permission prompts" in "Why this one" becomes a bullet that the user chooses at creation how much Claude asks, from prompting everything to `auto`. The security model keeps the list of what the container protects and adds one paragraph: with `auto`, a classifier approves routine actions instead of the user, while outbound network is unrestricted and the config holds the login token; users who want to see every command keep `default`. The configuration table explains `CRB_EXTRA_ARGS` with the mode as its main example, and a short "Phone mode" section documents the file, that it is user-level memory inside the container, and how to add it to an existing project by hand.

## Risks / Trade-offs

- [`auto` not available for the subscription or model] → The server exits, and the user sees the generic restart message. Mitigation: the troubleshooting entry from D1, `default` preselected, and the field test in the tasks tries `auto` before the change is archived.
- [Phone-mode file makes Claude end every reply with a question] → Wording in D3 limits it to decisions; the file is editable; the README says so.
- [`AskUserQuestion` with four options cannot express everything] → Claude falls back to prose for anything that is not a choice; "Other" is always available in the app.
- [Users of older `add-project.sh` copies see no new questions] → Nothing breaks; their services stay in `default` mode. No compatibility handling.
- [Reversing a documented decision confuses readers of the archive] → The proposal names the reversal and the old decision's location.

## Migration Plan

Host script and docs only. Existing projects: edit `services/<name>.yaml` to add `CRB_EXTRA_ARGS: "--permission-mode auto"` and copy the phone-mode block into `./<name>/config/CLAUDE.md`, then `docker compose up -d <name>` (the memory file is read at session start, no restart needed for it). Rollback: remove the line and the file.

This change depends on `add-project-script` being archived first, because its delta modifies a requirement that only exists there.
