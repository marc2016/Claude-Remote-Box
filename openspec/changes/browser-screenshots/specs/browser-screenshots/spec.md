# Spec Delta

## Purpose

Lets Claude render a project's web UI in a headless Chromium inside the container and show the result as an image in the remote chat, without root access and without workarounds that are lost on container recreation.

## ADDED Requirements

### Requirement: Chromium runtime dependencies
The image SHALL contain the system libraries and fonts that a Chromium or Chromium headless shell installed by Playwright needs to start and render pages on Linux, on every published platform (linux/amd64 and linux/arm64). The image SHALL NOT contain a browser binary. This SHALL hold under the documented hardening (all capabilities dropped, `no-new-privileges`) and under any non-root UID/GID.

#### Scenario: Project Playwright works without workarounds
- **WHEN** a project in `/workspace` has Playwright as a dependency, and Claude runs `npx playwright install chromium` and then takes a screenshot of the running dev server
- **THEN** Chromium starts and the screenshot file is written, without root, without downloading system packages, and without setting `LD_LIBRARY_PATH`

#### Scenario: Text renders readably
- **WHEN** a page with Latin text including German umlauts and with emoji is screenshotted
- **THEN** the text is rendered with real glyphs, not as empty boxes

#### Scenario: arm64 host
- **WHEN** the same project is run in the arm64 image
- **THEN** the screenshot succeeds in the same way as on amd64

### Requirement: Browser cache location
Browsers installed by Playwright inside the container SHALL be stored in one fixed directory under the home directory, writable by any container UID. The directory SHALL be mountable as optional storage. When it is not mounted, browser installation SHALL still succeed and only be repeated after container recreation.

#### Scenario: Cache mounted
- **WHEN** the cache directory is mounted, Claude installs Chromium once, and the user runs `docker compose down` and `docker compose up -d`
- **THEN** a later screenshot in the same project works without downloading the browser again

#### Scenario: Cache not mounted
- **WHEN** no cache storage is mounted and Claude runs `npx playwright install chromium`
- **THEN** the installation succeeds under any container UID

### Requirement: No core dumps
Processes in the container SHALL NOT write core dump files, including when a browser process crashes.

#### Scenario: Crashing process
- **WHEN** a process started in a remote session terminates with a signal that would normally produce a core dump
- **THEN** no `core` or `core.<pid>` file appears in `/workspace` or elsewhere in the container

### Requirement: Screenshot guidance for Claude
The image SHALL provide Claude Code with guidance that applies to every session without changes to the project or to the mounted config storage. The guidance SHALL state that Chromium dependencies are present, that the project's own Playwright is preferred, where browsers are cached, that screenshots are saved outside `/workspace` unless the user asks otherwise, and that a screenshot is shown to the user by reading the image file.

#### Scenario: Request from the phone
- **WHEN** the user asks in a remote session for a screenshot of the web application in a project with Playwright
- **THEN** Claude takes the screenshot with the project's Playwright and the image appears in the chat in the Claude app

#### Scenario: Project unchanged
- **WHEN** Claude has taken screenshots in a session
- **THEN** `git status` in `/workspace` shows no screenshot files and no helper scripts, unless the user asked for them to be added
