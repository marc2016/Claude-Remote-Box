# Tasks

## 1. Rename and structure

- [x] 1.1 Rename `add-project.sh` to `crb` (git mv, mode 755) and add `main()` with subcommand dispatch (D1): `add [url]` runs the existing flow, `update` calls the new function, no or unknown subcommand prints usage and exits 64. Verify `./crb` and `./crb foo` print the usage with both subcommands and exit 64, and `./crb add <url>` starts with the service-name question.
- [x] 1.2 Factor the permission menu, the phone-mode template, and the `environment:` line writer into functions used by `add` (D1) without changing `add`'s output. Verify by renaming `tests/add-project.test.sh` to `tests/crb.test.sh`, switching its invocations to `crb add`, and confirming every existing scenario still passes.
- [ ] 1.3 Spike the CDN cache (D2): push a one-line comment change to `crb` on a branch, then fetch `raw.githubusercontent.com/.../<branch>/crb` with and without `?t=<epoch>` within a minute. Record in design.md whether the query string bypasses the cache; if not, add the delay sentence to the README task 4.1.

## 2. Update flow

- [x] 2.1 Implement the self-update (D2): fetch `$CRB_SOURCE` (default the main URL with `?t=<epoch>`, local path or `file://` accepted) to a temp file, check size, shebang, and `bash -n`, compare with `$0`, replace keeping the mode with `crb.old` as fallback until the re-exec runs, `exec "$0" update --no-self-update`. Verify with a test that points `CRB_SOURCE` at a modified copy: the file is replaced, the output says so, and the modified copy's marker appears in the rest of the run; and with an unreachable `CRB_SOURCE`: a warning and the run continues.
- [x] 2.2 Implement the preflight and the image tag step: refuse root, require `compose.yaml`, detect `box.yaml` vs single-file, offer `latest` for a pinned tag (D6 for single-file). Verify with a `box.yaml` pinned to `0.2.0` (offer, after confirmation only the tag changed) and one on `latest` (no question).
- [x] 2.3 Implement the per-project reconciliation (D3): list `services/*.yaml`, mount check, show current state, ask only for missing permission mode and missing `CLAUDE.md`, append to an existing `CRB_EXTRA_ARGS`. Verify with three projects in one installation: one without settings (asked, `auto` plus file written), one with both (listed, not asked), one with `CRB_EXTRA_ARGS: "--capacity 4"` (flag appended), and `docker compose config -q` passes.
- [x] 2.4 Implement summary, confirmation, write, validate, restore (D4) and the pull plus recreate question (D5): declined summary changes nothing; failed `docker compose config -q` restores service files and `box.yaml` byte-identically and keeps created `CLAUDE.md`; recreate defaults to no and prints `docker compose up -d <names>`. Verify each with a test scenario; the pull and recreate commands are stubbed in tests through a fake `docker` on `PATH` that records its arguments and delegates `compose config` to the real one.
- [x] 2.5 Implement the single-file path (D6): no `services/`, services from `docker compose config --services`, print the line and the path per service, no edit, pull still runs. Verify with `compose.example.yaml` copied as `compose.yaml`: `compose.yaml` is byte-identical afterwards and the output names `my-project`.

## 3. Tests and CI

- [x] 3.1 Add the `update` scenarios from 2.1 to 2.5 to `tests/crb.test.sh`, including "second run changes nothing" on an installation just updated, and update `.github/workflows/scripts.yml` to `crb` and `tests/crb.test.sh`. Verify that `tests/crb.test.sh` passes locally and `shellcheck crb tests/crb.test.sh` is clean.

## 4. Documentation

- [x] 4.1 Update the README: quick start fetches `crb` and runs `./crb add`, "Adding a project" uses `./crb add`, "Versions and updating" is rewritten around `./crb update` (what it does, that it asks before writing, that recreate ends sessions, single-file hint, the cache note from 1.3 if needed), and "Phone mode" says `./crb update` adds the file to existing projects. Verify that no `add-project.sh` remains in the repository outside `openspec/` and that the README's commands match the usage line of `crb`.

## 5. Field test

- [ ] 5.1 On the Mini-PC: replace `add-project.sh` with `crb` as the migration plan says, run `./crb update` on the installation with `janus-note-vs` and LoopTalk, choose `auto` and phone mode where offered, accept the recreate, and confirm in the Claude app that both services reconnect and that a session in `janus-note-vs` follows the phone-mode file. Run `./crb update` a second time and verify it reports nothing to do. Record the result in design.md.
