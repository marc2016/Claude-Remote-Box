# Proposal

## Why

The point of claude-remote-box is driving Claude from a phone, and on a phone typing is slow while tapping is easy. Today every project runs in the prompting permission mode, so almost every shell command produces an approval prompt, and Claude's replies are written as if for a laptop screen: long, with tables and pasted output, ending in open questions that need typed answers. The first field tests showed that the prompts get rubber-stamped after a while and that most of the typing on the phone is answering "what next?". Both can be fixed at the moment a project is created, without touching the image.

This reverses a decision from the first change (`initial-compose-service`, D3): the permission mode was deliberately hidden because "prompting is the product's point". The product's point is now "as little typing on the phone as possible"; prompts stay available as one of the choices.

## What Changes

- `add-project.sh` asks for the permission mode of the new service as a numbered choice (`default`, `acceptEdits`, `auto`) and writes it as `CRB_EXTRA_ARGS: "--permission-mode <mode>"` into `services/<name>.yaml` when it differs from `default`. No new environment variable and no image change: the entrypoint and `setup` already pass `CRB_EXTRA_ARGS` to the server. The modes `bypassPermissions` and `dontAsk` are not offered; they remain reachable by editing `CRB_EXTRA_ARGS` by hand.
- `add-project.sh` asks whether to enable "phone mode" (default yes) and, if so, writes a prepared `CLAUDE.md` into `./<name>/config`. Inside the container that directory is `/home/node/.claude`, Claude Code's user-level memory location, so the file applies to every session of that project, including worktree sessions, without living in the repository. It tells Claude that the user is on a phone: compact and clear replies, no wide tables or pasted output, and the `AskUserQuestion` tool with tappable options whenever there is a decision or a next step to choose. The file stays editable on the host.
- The README changes its positioning: "Real permission prompts" becomes "you choose at project creation how much Claude asks", the security model names what `auto` means (a classifier decides instead of the user, while outbound network is unrestricted), and the phone-mode file is documented so existing projects can copy it in by hand.
- The preselected permission mode stays `default` until `auto` has been used in the field for a while; the design records the condition for switching the preselection.

Out of scope: changing the managed `/etc/claude-code/CLAUDE.md` in the image (its loading in Remote Control sessions is still unverified in `browser-screenshots` task 1.1), changing the mode of existing services from the script, and detecting whether `auto` is available for the user's subscription.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-scaffolding`: the script asks two more questions (permission mode, phone mode), the generated service carries the chosen mode in `CRB_EXTRA_ARGS`, and the created config directory may contain the prepared `CLAUDE.md`. This capability is currently a delta in the in-flight change `add-project-script`; this change builds on it and must be archived after it.

The container's own default stays the prompting mode (`container-image`, "Remote Control server by default"), so that capability is unchanged: the mode is set per service through flags the container already accepts.

## Impact

- `add-project.sh`: two new prompts, the summary, the generated `services/<name>.yaml`, and the config directory step; the phone-mode template is embedded in the script because it is downloaded standalone.
- `tests/add-project.test.sh`: answer sequences of every scenario gain two inputs; new checks for the written flag and file.
- `README.md`: "Why this one", quick start, configuration table, security model.
- `compose.example.yaml`: the commented `CRB_EXTRA_ARGS` example gets a note that the script asks for it.
- No image change; `v0.3.0` is independent of this change.
