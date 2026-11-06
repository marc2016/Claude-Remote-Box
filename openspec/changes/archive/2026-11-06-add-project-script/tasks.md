# Tasks

## 1. Base layout

- [x] 1.1 Add `box.yaml` with the base service `box` (image, restart, user, `cap_drop`, `security_opt`, `ulimits: core: 0`) and `services/example.yaml` extending it (D2). Verify with a test `compose.yaml` that includes the example: `docker compose config -q` passes and `docker compose config --services` lists only the example service, not `box`.

## 2. Script

- [x] 2.1 Write `add-project.sh` skeleton (D1): headline, `ask`/`confirm` helpers, tool and Compose-version checks, root refusal (D4). Verify with `shellcheck add-project.sh` and that running it as root (`sudo`) or with a fake old `docker compose` exits with the expected message.
- [x] 2.2 Implement the prompts and defaults: URL from argument or prompt, derived service name, clone directory, spawn mode choice, browser cache, Git identity from `git config --global`. Verify with piped Enter-only input that the summary shows the defaults from the spec scenario "Accept all defaults".
- [x] 2.3 Implement name validation and uniqueness against `docker compose config --services` and `services/<name>.yaml`, and the `include:` form check (D3, D4). Verify that `Flash Agenda`, `-x`, and an existing name are rejected with a re-prompt, and that a flow-style `include:` stops before the summary.
- [x] 2.4 Implement the summary and confirmation. Verify that answering Enter or `n` leaves the directory byte-for-byte unchanged (`find . -newer` marker check).
- [x] 2.5 Implement the side effects in D5 order with step counters: clone or reuse (with its prompt), config directory mode 700 (with reuse prompt), base files only when missing, service file (D2, D6), include entry (D3). Verify on an empty directory that all files from the spec scenario "Empty directory" exist and `stat` shows mode 700 on the config directory.
- [x] 2.6 Implement the final `docker compose config -q`, the rollback, and the next-steps output (D5). Verify by forcing a failure (e.g. a pre-existing invalid `box.yaml`) that the include line and service file are gone, clone and config remain, and the exit code is non-zero.

## 3. Tests and CI

- [x] 3.1 Write `tests/add-project.test.sh` (D7) with a local bare repo as URL, covering: all defaults, invalid and duplicate names, declined summary, existing checkout reuse, empty directory, existing single-file setup with `x-box`, rollback, generated service hardening via `docker compose config <name>`. Verify all cases pass locally.
- [x] 3.2 Add a CI workflow that runs `shellcheck` and the test on pull requests. Verify it passes on the branch.

## 4. Documentation

- [x] 4.1 Update the README: quick start with `curl` of `add-project.sh` and running it; "Adding a project" with the script first and the manual single-file way as alternative; the new layout; Compose ≥ 2.20; how to move an existing service into `services/`; `CRB_VERSION` in the release checklist. Point `compose.example.yaml`'s header comment to the script. Verify every YAML snippet in the README passes `docker compose config -q`.

## 5. Field test

- [x] 5.1 On the mini PC, add FlashAgenda with the script next to the existing LoopTalk service, then `docker compose up -d flashagenda` and run setup. Verify that LoopTalk keeps running unchanged, FlashAgenda connects in the Claude app as `flashagenda`, and record the result in design.md.
