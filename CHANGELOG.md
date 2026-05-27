# Changelog

## Unreleased

- Replaced the public preset-style Auto surface with one built-in `agentweaver auto` workflow and saved custom workflows addressed as `auto-config:<name>`.
- Removed public legacy Auto commands and `--preset`; old persisted `auto-*` state now reports: `This run was created with legacy auto-* flow identity. Restart with \`agentweaver auto\`.`
- Saved Auto configs now normalize to version 2 without `basePreset`; version 1 configs remain readable and are migrated before use.

## v0.1.20

Release range: `v0.1.19...v0.1.20`

### Highlights

- Added the configurable `agentweaver auto` entrypoint with slot-based `simple` and `standard` presets.
- Added saved YAML auto-flow configs with project-level and user-level discovery.
- Added a Web UI auto-flow editor with preset selection, block toggles, config save/reset actions, validation diagnostics, and a slot/block progress tree.
- Added a Web UI Git workspace pane with branch operations, fetch, pull, staging, commit, push, and side-by-side diff inspection.
- Added manual task-source fallback for Jira-backed planning and auto flows when Jira input is unavailable.
- Added persisted Web UI preferences for theme, panel sizing, auto-flow editor height, and log auto-scroll.

### Configurable Auto Flow

- Added `agentweaver auto [--preset <simple|standard>|--config <name>] [--dry-run-flow]`.
- `agentweaver auto` now defaults to the `standard` preset, equivalent to the design-review-gated `auto-common` pipeline.
- `--preset simple` resolves to the simplified planning, implementation, and review-loop pipeline.
- `--config <name>` loads saved configs from `.agentweaver/flow-configs/<name>.yaml` before `~/.agentweaver/flow-configs/<name>.yaml`; project configs take precedence.
- `--dry-run-flow` validates and previews the resolved source, phase order, block decisions, diagnostics, and artifact policy without running workflow steps or writing resolver artifacts.
- Non-dry configurable auto runs now write `flow-config.yaml`, `resolved-flow.json`, and `resolved-flow-summary.json` under the active scope artifact directory.
- Added configurable auto status and reset support through `agentweaver auto-status` and `agentweaver auto-reset` with the same preset/config selectors.
- Preserved `auto-common` and `auto-simple` behavior through resolver-backed built-in presets while replacing the old static flow-spec files.

### Auto-Flow Model

- Added the slot model for `source`, `normalize`, `planning`, `designReview`, `implementation`, `postImplementationChecks`, `review`, and `final`.
- Added locked core blocks for task source collection, source normalization, planning, and implementation.
- Added optional block support for design review loops, review loops, Go linter checks, and Go test checks.
- Added validation for unknown blocks, invalid slots, locked block changes, duplicate blocks, missing dependencies, unsupported parameters, and out-of-range parameters.
- Added auto-flow identity handling so preset-backed and named-config flows have separate resumable state.

### Web UI

- Added an auto-flow editor that can switch presets, load saved configs, enable or disable optional blocks, insert or remove supported blocks, edit `maxIterations`, and save configs.
- Added a slot/block progress view for configurable auto runs, including pending, running, success, failed, stopped, skipped, waiting-user, disabled, blocked, invalid, and empty states.
- Added a Git workspace panel with repository status, current branch, upstream, ahead/behind counts, last commit, changed files, and operation feedback.
- Added Web UI Git actions for branch creation, checkout, fetch, fast-forward pull, stage, unstage, commit selected paths, and push.
- Added a side-by-side Git diff drawer with `HEAD`, staged, and worktree modes.
- Added diff parsing for modified row pairing, renames, binary files, too-large diffs, and synthetic untracked text diffs.
- Added a light Web UI theme, resizable workspace panels, resizable auto-flow editor height, current-flow header improvements, and activity log auto-scroll controls.
- Fixed Artifact Explorer visibility so it can show markdown artifacts from the active scope, including artifacts from earlier runs in that scope.

### Task Source and Workflow Behavior

- Added a manual Jira task input node and hidden `manual-jira-input` flow that stores pasted task text as raw Jira-style artifacts for normalization.
- `plan`, `auto`, `auto-common-guided`, `auto-common`, `auto-simple`, and `auto-golang` can now prompt for Jira input and fall back to pasted manual task text when Jira is omitted.
- Updated `plan` to operate from normalized task sources instead of requiring Jira fetch as the only entry path.
- Refined restart behavior so independent single-purpose flows reset only their saved flow state while keeping existing scope artifacts available.

### Documentation

- Updated README usage for `agentweaver auto`, `--preset`, `--config`, `--dry-run-flow`, saved config locations, resolver artifacts, and manual task input.
- Updated Web UI documentation to describe process-local session state and globally persisted visual preferences.
- Clarified Artifact Explorer behavior for active-scope markdown artifacts.
- Updated guided playbook notes for `auto-common-guided --accept-playbook-draft [<jira>]` and manual task input.

### Tests

- Added coverage for configurable auto-flow resolution, presets, saved config validation, CLI dry-run previews, status, and reset.
- Added coverage for auto-flow identity, state routing, resolver artifacts, and flow-spec routing groups.
- Added coverage for Git status parsing, Git service operations, safe path handling, diff parsing, untracked diff rendering, binary diff handling, and Web UI diff APIs.
- Added coverage for Web UI protocol actions, static app behavior, server behavior, session handling, settings persistence, interactive controller behavior, and auto-flow editor state.

## v0.1.18

Release range: `v0.1.17...v0.1.18`

### Highlights

- Added a Web UI for the interactive operator workflow through `agentweaver web`.
- Added project playbooks and guided project guidance for repository-specific agent context.
- Added the new `auto-common-guided` flow, which injects compact playbook guidance into planning, design review, implementation, review, and repair phases.
- Added `playbook-init` to generate and write a manifest-based project playbook.
- Added automatic scope switching for interactive and web sessions when the current git branch changes.

### Web UI

- Added `agentweaver web [--no-open] [--host <host>|--listen-all] [<jira>]`.
- The Web UI binds to `127.0.0.1` by default, uses an OS-assigned random port, and prints the final URL.
- Added browser auto-open support, with `--no-open` and `AGENTWEAVER_WEB_NO_OPEN=1` for CI and smoke checks.
- Added WebSocket-based live interaction for flow selection, launch confirmations, user-input forms, progress, logs, help, and interruption.
- Added health and shutdown endpoints: `GET /__agentweaver/health` and `POST /__agentweaver/exit`.

### Security

- External Web UI binding now requires HTTP Basic auth.
- `--listen-all`, `--host 0.0.0.0`, `--host ::`, non-loopback IPs, and non-localhost hostnames require both `AGENTWEAVER_WEB_USERNAME` and `AGENTWEAVER_WEB_PASSWORD`.
- Localhost bindings remain no-auth by default unless credentials are configured.
- Web UI docs now clarify that Basic auth over plain HTTP should only be used on trusted networks or behind TLS termination.

### Project Playbook and Guided Flows

- Added `.agentweaver/playbook/` support with `manifest.yaml`, project context, practices, examples, and templates.
- Added deterministic repository inventory and playbook generation nodes.
- Added playbook validation for manifest format, paths, phases, severities, duplicate ids, and relationship references.
- Added structured playbook artifacts, including repository inventory, practice candidates, playbook questions, answers, draft, and write result.
- Added project guidance artifacts for `plan`, `design-review`, `implement`, `review`, and `repair/review-fix`.
- Added `--accept-playbook-draft` for non-interactive playbook initialization and guided flow startup when a manifest is missing.

### Workflow Changes

- Added `auto-common-guided --help-phases`.
- Updated planning, design-review, implementation, review, and review-fix prompts to accept optional project guidance files.
- Added project guidance wiring to `auto-common-guided` before each guided LLM phase.
- Added web and interactive controller actions that can be shared by Ink and browser sessions.
- Improved interactive session cleanup and interruption handling.
- Interactive and web sessions now refresh branch-derived scope before launch confirmation, before flow launch, and after active flows complete.

### Documentation

- Expanded the README with Web UI usage, auth requirements, guided project guidance, playbook initialization, and updated smoke checks.
- Added `docs/features.md` with a high-level feature overview.
- Added `docs/playbook.md` with the playbook format, rule maintenance guidance, validation behavior, and guided execution notes.
- Moved the flow-spec reference from `FLOW-SPECS.md` to `docs/declarative-workflows.md`.

### Build and Packaging

- Added Tailwind CSS build steps for Web UI styles:
  - `npm run build:web-css`
  - `npm run dev:web-css`
- Updated `npm run build` to build Web UI CSS before TypeScript compilation and flow-spec copying.
- Added the `yaml` runtime dependency for playbook manifest and frontmatter parsing.

### Tests

- Added coverage for Web UI CLI behavior, server behavior, protocol parsing, and web interactive sessions.
- Added coverage for playbook runtime validation, inventory, prompts, write behavior, and `playbook-init`.
- Added coverage for project guidance generation and guided `auto-common` flow behavior.
- Extended interactive controller and state tests for Web UI-compatible actions and scope behavior.
