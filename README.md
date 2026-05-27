# AgentWeaver

`AgentWeaver` is a TypeScript/Node.js CLI for engineering durable workflows around coding agents.

It is built for teams that want agent work to behave less like one-off prompting and more like an inspectable engineering system: explicit workflows, durable artifacts, repeatable review gates, resumable execution, and repository-local guidance that evolves with the codebase.

Typical usage looks like:

`plan -> implement -> run-go-linter-loop -> run-go-tests-loop -> review -> review-fix`

Planning-heavy work can use:

`plan -> design-review -> implement -> review-loop`

The important part is not the exact chain. The point is that AgentWeaver lets you model, operate, and evolve the harness around the agent.

## Key Features

See [docs/features.md](docs/features.md) for the expanded feature overview.

- **Declarative agent workflows**: flows are JSON specs with phases, steps, prompt bindings, params, expectations, and post-step actions. Workflow design stays declarative while runtime behavior lives in typed nodes and executors.
- **Repository-local project playbook**: stable project conventions live under `.agentweaver/playbook/` as versioned rules, examples, and templates. Guided flows select relevant guidance before planning, implementation, review, and repair so repeated agent runs inherit the same project knowledge.
- **Artifact-first execution**: each stage produces structured JSON and human-readable markdown artifacts on disk. Artifacts are the contract between stages, which makes runs inspectable, reviewable, and restartable.
- **Planning and design-review gates**: planning flows produce design, implementation plan, and QA plan artifacts. `design-review` critiques those artifacts before coding starts, and the built-in `auto` workflow includes a design-review gate before implementation.
- **Review and repair loops**: review flows produce structured findings with severities. Repair flows can select blockers and critical findings, apply targeted fixes, and run follow-up checks.
- **Resumable automation**: long-running flows persist compact execution state, support resume/continue/restart semantics, and can restart from selected phases when the artifacts and launch profile are compatible.
- **Multiple execution backends**: Codex, OpenCode, shell/process checks, Jira, GitLab, Git commit, and Telegram notification integrations run through a common executor model.
- **Interactive TUI, Web UI, and direct CLI**: the same workflow model works in operator-driven interfaces, direct CLI commands, and non-interactive automation.
- **Custom flows**: built-in flows can be extended with global or project-local flow specs without changing AgentWeaver source code.
- **Plugin SDK**: local plugins can add public-SDK-compatible nodes and executors, with manifest validation, version checks, and documented entrypoint rules.
- **Operational diagnostics**: `doctor` checks system readiness, executor configuration, flow specs, node versions, and runtime environment shape before workflows fail mid-run.

## Why Harness Engineering

AgentWeaver is not positioned as a thin wrapper around one agent call. It is meant for harness engineering:

- The workflow is explicit instead of hidden in a long prompt.
- The intermediate decisions are persisted instead of disappearing in chat history.
- The agent receives project guidance from the repository instead of relying on memory or copy-pasted instructions.
- Review, repair, checks, and restart behavior are first-class parts of the workflow.
- The same model works in local CLI use, interactive operation, and automation.

In practice, this means you can treat an agent workflow like an engineered system: versioned, inspectable, repeatable, and debuggable.

## Core Concepts

- `flow spec`: declarative JSON under `src/pipeline/flow-specs/`, global `~/.agentweaver/.flows/`, or project-local `.agentweaver/.flows/`
- `node`: reusable runtime unit from `src/pipeline/nodes/`
- `executor`: integration layer for Jira, Codex, OpenCode, GitLab, shell/process execution, Telegram notifications, and related actions
- `scope`: isolated workspace key for artifacts and flow state; usually based on Jira task, otherwise derived from git context
- `artifact`: file produced or consumed by flows, used as the stable contract between stages
- `flow state`: compact persisted execution metadata used for resume/restart in long-running flows such as `auto`
- `project playbook`: local `.agentweaver/playbook/` directory with `manifest.yaml`, practices, examples, and templates; the format is described in [docs/playbook.md](docs/playbook.md)

## Launch Semantics

- `resume` only resumes a genuinely interrupted run and uses the saved execution state without rebuilding already completed steps
- `continue` is intended for completed iterative cycles and starts the next iteration from the latest valid artifacts without deleting historical artifacts
- `restart` is treated as a new run. For end-to-end attempt flows, the current active attempt is archived under `.agentweaver/scopes/<scope>/.artifacts/restart-archives/attempt-XXXX` before the new attempt starts; for independent single-purpose flows, restart only resets that flow's saved state and keeps existing scope artifacts available.
- For ambiguous launches, the operator must choose the action explicitly: by confirmation in interactive mode, or with `--resume`, `--continue`, or `--restart` in non-interactive mode
- This contract applies to `auto`, `auto-config:<name>`, `instant-task`, `review-loop`, `run-go-linter-loop`, and `run-go-tests-loop`

## Declarative Workflow Model

The center of the system is the declarative flow spec:

- phases define the workflow structure visible to operators
- steps define execution units inside each phase
- prompt bindings define how agent instructions are assembled
- params define node runtime inputs
- expectations define postconditions
- `after` actions update runtime state without introducing ad-hoc imperative glue

This keeps workflow design in JSON while keeping implementation details in typed runtime code.

The full flow-spec reference now lives in [docs/declarative-workflows.md](docs/declarative-workflows.md).

## Repository Layout

- `src/index.ts` — CLI entrypoint, interactive mode bootstrap, and top-level orchestration
- `src/executors/` — first-class executors
- `src/executors/configs/` — data-only default executor configs
- `src/pipeline/` — declarative flow loading, compilation, validation, runtime, and built-in flow specs
- `src/pipeline/nodes/` — reusable runtime nodes used by flow specs
- `src/runtime/` — shared runtime services such as command resolution and subprocess execution
- `src/interactive/` — Ink-based interactive session, controller, state, and view-model logic
- `src/markdown.ts` — markdown rendering for terminal output
- `src/structured-artifact-schemas.json` — schemas for machine-readable artifacts
- `tests/` — automated tests for pipeline behavior

## Built-In Flows

User-invokable built-in commands currently map to these flow specs:

- `plan` — uses a normalized task source from Jira or manual input, generates clarifying questions for the developer, collects answers, and produces design, implementation plan, and QA plan as structured JSON and markdown artifacts
- `design-review` — performs a structured critique of the latest planning artifacts and writes a dedicated `design-review/v1` artifact; `approved_with_warnings` is treated as ready to proceed and may still produce `ready-to-merge.md`
- `task-describe` — generates a brief task description from a Jira issue or from manual input; when Jira is provided, fetches the issue and summarizes it; otherwise accepts free-form text and analyzes the codebase to produce a richer description
- `implement` — runs LLM-backed implementation based on previously approved design and plan artifacts; executes code changes locally in the project working directory
- `review` — performs code review of current changes against the task design and plan; produces structured review findings with severity levels and a ready-to-merge verdict
- `review-fix` — takes review findings, auto-selects blockers and criticals (or lets the developer pick manually), builds a targeted fix prompt, and applies fixes locally; runs mandatory checks after modifications
- `review-loop` — iteratively runs review → review-fix cycles up to 5 times; stops early when ready-to-merge is achieved; each iteration auto-selects blockers and critical findings for fixing
- `bug-analyze` — fetches a Bug-type Jira issue or accepts manual task text when Jira is unavailable, validates Jira issue type only for Jira-backed runs, generates or reuses a cached task summary, and produces structured bug analysis: root cause hypothesis, fix design, and step-by-step fix plan
- `bug-fix` — applies the fix designed in bug-analyze; uses the root cause hypothesis, fix design, and fix plan artifacts as the source of truth to implement code changes locally
- `git-commit` — four-phase commit workflow: collects git status and diff, generates a commit message via LLM, presents a file selection form, then shows the editable message for confirmation and executes the commit
- `gitlab-diff-review` — prompts for a GitLab merge request URL, fetches the MR diff via GitLab API, and runs LLM-backed code review producing structured findings with severity levels and a ready-to-merge verdict
- `gitlab-review` — prompts for a GitLab merge request URL, fetches existing code review comments via GitLab API, assesses which findings are fair and which can be dismissed, then runs review-fix to apply fixes for the accepted findings
- `mr-description` — generates a concise merge request description based on the task context and current code changes; produces both markdown and structured JSON artifacts
- `run-go-tests-loop` — runs `run_go_tests.py` and analyzes failures; if tests fail, sends the error output to LLM for a fix and retries; repeats up to 5 attempts, stopping early on success
- `run-go-linter-loop` — runs `run_go_linter.py` and analyzes output; if the linter reports issues, sends them to LLM for a fix and retries; repeats up to 5 attempts, stopping early on success
- `auto` — the single built-in Auto workflow: task source → normalize → plan → design-review loop → implement → review loop. It is immutable; custom variants are saved as `auto-config:<name>`.
- `doctor` — diagnostics command that runs system, executor, and flow readiness health checks; supports filtering by category or check ID and JSON output

There are also built-in nested/helper flows that are loaded declaratively but are not direct top-level CLI commands, for example `review-project` (project-level code review used internally when no prior design/plan artifacts are present).

## Interactive Flow Catalog

The TUI and Web UI organize launchable flows as a display catalog. This changes navigation only; CLI command ids, flow ids, resume state, and routing keys stay stable.

- `Recommended` is first, expanded by default, and contains `Auto` and `Instant task`. `Auto` is selected by default when it is available.
- `Custom` contains saved Auto configs, project-local flows, and global flows under `Saved auto flows`, `Project flows`, and `Global flows`.
- `Built-in blocks` is a collapsed library for experienced users. It groups reusable launchable entries under `Core pipeline`, `Quality checks`, `Task utilities`, `Delivery`, `Integrations`, and `Specialized`.

Catalog terms are intentionally separate from runtime implementation:

- A recipe is an end-user scenario such as `auto`, `instant-task`, or `auto-config:<name>`.
- A block is a reusable pipeline stage such as `plan`, `design-review`, `implement`, `review`, `review-fix`, `review-loop`, `run-go-tests-loop`, or `run-go-linter-loop`.
- A tool supports an adjacent task, such as `task-describe`, `playbook-init`, `git-commit`, or `mr-description`.
- An integration works primarily with an external system, such as `gitlab-review` or `gitlab-diff-review`.
- Specialized flows cover narrower task classes, such as `bug-analyze` and `bug-fix`.

## Requirements

- Node.js `>= 18.19.0`
- npm
- `codex` CLI for Codex-backed stages
- `opencode` CLI if you use OpenCode-backed stages
- access to Jira and/or GitLab when the selected flow needs them

## Web UI

The `agentweaver web [--no-open] [--host <host>|--listen-all] [<jira-browse-url|jira-issue-key>]` command starts interactive mode through the Web UI. By default, the server binds to `127.0.0.1`, asks the operating system for a random port, and prints the final address as `AgentWeaver Web UI: http://127.0.0.1:<port>/`.

To open the Web UI from another machine on a trusted network, configure Web UI credentials first:

```bash
export AGENTWEAVER_WEB_USERNAME=operator
export AGENTWEAVER_WEB_PASSWORD='choose-a-strong-password'
agentweaver web --listen-all --no-open
```

External binding requires both `AGENTWEAVER_WEB_USERNAME` and `AGENTWEAVER_WEB_PASSWORD`. This applies to `agentweaver web --listen-all`, `agentweaver web --host 0.0.0.0`, `agentweaver web --host ::`, explicit non-loopback IP addresses such as `192.168.1.10` or `2001:db8::1`, and any hostname other than `localhost`. In this mode, the server listens on the requested interface; connect to the IP address or hostname of the machine running AgentWeaver and the assigned port.

The default localhost bindings, including `127.0.0.1`, `::1`, and `localhost`, remain no-auth by default. If Web UI credentials are configured, the same Basic auth check also protects localhost Web UI requests.

Web UI authentication uses HTTP Basic auth. Over plain HTTP, use it only on trusted networks because credentials are not encrypted in transit. For untrusted networks, put AgentWeaver behind TLS termination or an equivalent reverse proxy.

By default, AgentWeaver tries to open the browser after the server starts successfully and the URL is printed. For CI, tests, and manual smoke checks, use `agentweaver web --no-open` or the `AGENTWEAVER_WEB_NO_OPEN=1` environment variable; the `--no-open` flag is supported only after the `web` command.

The Web UI serves the operator console from the same local process, including `/`, `/static/app.js`, and `/static/styles.css`. Live browser interaction uses WebSocket on `/__agentweaver/ws`. Bounded checks can use `GET /__agentweaver/health`, and shutdown is available through `POST /__agentweaver/exit` or `SIGINT`/`SIGTERM`.

Web UI session state is process-local: active flow selection, confirmations, forms, progress, and logs exist only while the AgentWeaver process is running and are not shared with other AgentWeaver processes. Visual preferences such as theme, panel sizes, and log auto-scroll are stored in the global AgentWeaver settings file at `~/.agentweaver/settings.json`, so they survive host and port changes.

### Artifact Explorer

After a Web UI workflow completes, and also after a failed run when artifacts were written before failure, the Web UI offers the Artifact Explorer. It reads markdown artifacts from the active AgentWeaver scope, including artifacts from earlier runs in that scope; the latest workflow run is used only to choose the initial preview when possible. The browser requests artifact content through safe artifact identifiers resolved by the active catalog and registry; it does not accept arbitrary filesystem paths.

The MVP explorer previews Markdown, JSON, plain text, and diff artifacts. Diffs are rendered as text. Binary and unknown artifacts are listed with metadata and safe raw/download actions, but their inline preview is a placeholder. Large previews are bounded and marked as truncated with loaded byte and total size metadata; raw and download links can still serve the full artifact bytes with no-store cache headers and safe content types.

When Web UI credentials are configured, the same HTTP Basic auth protection applies to `/`, `/static/*`, `/__agentweaver/ws`, `/__agentweaver/exit`, and the artifact list, preview, raw, and download API routes. The MVP explorer does not support artifact editing, comments, run comparison, image previews, specialized viewers, live updates, or full-text search.

## Installation

Local development:

```bash
npm install
npm run build
```

Run from source:

```bash
node dist/index.js --help
```

Global install after publishing:

## Plugin SDK

AgentWeaver supports local plugins and custom declarative flows from both global and project-local `.agentweaver` directories.

Plugin authors must use only the public SDK subpath: `agentweaver/plugin-sdk`.
The package root `agentweaver`, internal paths such as `agentweaver/dist/*` and `agentweaver/src/*`, and repository-relative source imports are not part of the supported SDK contract.

Supported plugin manifest locations are:

- `~/.agentweaver/.plugins/<plugin-id>/plugin.json`
- `.agentweaver/.plugins/<plugin-id>/plugin.json`

The plugin directory name and manifest `id` must match exactly.

Use the dedicated guide at [docs/plugin-sdk.md](docs/plugin-sdk.md) for:

- the executor versus node architecture
- manifest and entrypoint rules
- optional routing metadata for plugin LLM executors
- runtime context APIs available to plugin code
- global and project-local flow wiring under `~/.agentweaver/.flows/` and `.agentweaver/.flows/`
- compatibility, testing, troubleshooting, and a complete end-to-end walkthrough

Repository reference examples live under `docs/examples/`, for example:

- `docs/examples/.plugins/claude-example-plugin/`
- `docs/examples/.flows/claude-example.json`

```bash
npm install -g agentweaver
agentweaver --help
```

One-off usage after publishing:

```bash
npx agentweaver --help
```

## Environment Loading

AgentWeaver loads environment variables from two optional `.env` files:

1. `~/.agentweaver/.env`
2. `<project>/.agentweaver/.env`

Priority is:

1. shell environment
2. project-local `.agentweaver/.env`
3. global `~/.agentweaver/.env`

The directory `~/.agentweaver` is created automatically on startup. Missing `.env` files are allowed.

`AGENTWEAVER_HOME` is only used to override the package installation/home directory used by the CLI. It is not the same thing as `~/.agentweaver`.

## Environment Variables

Required for Jira-backed flows:

- `JIRA_API_KEY` — Jira API token

Common optional variables:

- `JIRA_USERNAME` — required for Jira Cloud Basic auth
- `JIRA_AUTH_MODE` — `auto`, `basic`, or `bearer`
- `JIRA_BASE_URL` — required when passing only an issue key such as `DEMO-123`
- `GITLAB_TOKEN` — token for GitLab review-related flows
- `AGENTWEAVER_HOME` — override package home/installation directory
- `CODEX_BIN` — override `codex` executable path
- `CODEX_MODEL` — fallback model for Codex-backed executors
- `OPENCODE_BIN` — override `opencode` executable path
- `OPENCODE_MODEL` — fallback model for OpenCode-backed executors

Example:

```bash
JIRA_API_KEY=your-jira-api-token
JIRA_USERNAME=your.name@company.com
JIRA_AUTH_MODE=auto
JIRA_BASE_URL=https://jira.example.com
GITLAB_TOKEN=your-gitlab-token
AGENTWEAVER_HOME=/absolute/path/to/AgentWeaver
CODEX_BIN=codex
CODEX_MODEL=gpt-5.4
OPENCODE_BIN=opencode
OPENCODE_MODEL=minimax-coding-plan/MiniMax-M2.7
```

## TUI-First Operations

The full-screen TUI is not a cosmetic wrapper. It is the operator console for the harness:

- browse recommended recipes, custom workflows, and built-in blocks
- start from `Recommended`, use `Custom` for saved or user-defined flows, and open `Built-in blocks` when you need a specific reusable stage
- launch flows in the current scope
- inspect progress by phase and step
- follow activity, prompts, summaries, and statuses
- operate resumable flows without losing the execution model

The CLI remains important for direct execution and automation, but the TUI is where the harness becomes an operational system rather than a set of commands.

## CLI Usage

Interactive mode:

```bash
agentweaver
agentweaver DEMO-1234
agentweaver --force DEMO-1234
```

Direct flow execution:

```bash
agentweaver plan DEMO-1234
agentweaver design-review DEMO-1234
agentweaver task-describe DEMO-1234
agentweaver implement DEMO-1234
agentweaver review DEMO-1234
agentweaver review-fix DEMO-1234
agentweaver review-loop DEMO-1234
agentweaver bug-analyze DEMO-1234
agentweaver bug-fix DEMO-1234
agentweaver git-commit DEMO-1234
agentweaver gitlab-diff-review
agentweaver gitlab-review
agentweaver mr-description DEMO-1234
agentweaver run-go-tests-loop DEMO-1234
agentweaver run-go-linter-loop DEMO-1234
agentweaver auto DEMO-1234
agentweaver auto --config backend-standard --dry-run-flow DEMO-1234
agentweaver doctor
agentweaver doctor --json
agentweaver doctor <category>|<check-id>
```

From a source checkout:

```bash
node dist/index.js plan DEMO-1234
node dist/index.js design-review DEMO-1234
node dist/index.js implement DEMO-1234
node dist/index.js review DEMO-1234
node dist/index.js auto --dry-run-flow DEMO-1234
node dist/index.js auto --config backend-standard --dry-run-flow DEMO-1234
```

Useful commands:

```bash
agentweaver --help
agentweaver --version
agentweaver auto --help-phases
agentweaver auto-status DEMO-1234
agentweaver auto-status --config backend-standard DEMO-1234
agentweaver auto-reset DEMO-1234
agentweaver auto-reset --config backend-standard DEMO-1234
agentweaver doctor
agentweaver doctor --json
```

Notes:

- `--dry` fetches required context but prints launch commands instead of running Codex/OpenCode steps
- `--dry-run-flow` applies only to `agentweaver auto`; it validates and previews the resolved flow without running workflow steps or writing resolver artifacts
- `--config <name>` applies only to `agentweaver auto`; it loads a saved YAML config by name
- `--verbose` streams child process stdout/stderr in direct CLI mode
- `--prompt <text>` appends extra instructions to the prompt
- `--scope <name>` is supported by scope-flexible flows such as `implement`, `review`, `review-fix`, `review-loop`, `run-go-tests-loop`, `run-go-linter-loop`, `gitlab-review`, and `gitlab-diff-review`
- `--md-lang <en|ru>` applies only to generated workflow markdown artifacts, not repository source files or committed documentation
- `--force` only affects interactive mode: it skips loading cached summary-pane content on startup so Jira-backed flows that regenerate summary artifacts can repopulate it during the run
- Saved auto flow configs are discovered at `.agentweaver/flow-configs/<name>.yaml` first and `~/.agentweaver/flow-configs/<name>.yaml` second; the project config wins when both exist
- Non-dry `agentweaver auto` runs write `flow-config.yaml`, `resolved-flow.json`, and `resolved-flow-summary.json` under `.agentweaver/scopes/<scopeKey>/.artifacts`
- Task-driven flows that can run without a Jira key show Jira input and manual task text in the same first form; leave Jira empty and fill the task description when Jira is unavailable
- In the Web UI, `task-describe` can also work from one uploaded UTF-8 `.md`, `.markdown`, `.txt`, or `.xml` task source file without Jira
- `gitlab-review` and `gitlab-diff-review` ask for a GitLab merge request URL interactively
- `auto-status` and `auto-reset` operate on persisted state for `auto` or `auto-config:<name>`

## Auto Workflow

`agentweaver auto` is the single built-in task automation workflow. It is generated in memory from the immutable base Auto definition and runs task source collection, normalization, planning, design review, implementation, and review.

Use `agentweaver auto --dry-run-flow <task>` to inspect the generated phases, included/skipped blocks, max-iteration settings, and artifact policy without invoking executors or writing resolver artifacts.

Auto workflow blocks are the assembly units used to build `auto` and `auto-config:<name>`. Launchable catalog entries such as `Plan`, `Review loop`, `Go tests loop`, and `Go linter loop` are related concepts, but the interactive catalog is not the runtime source for Auto assembly.

Saved custom Auto workflows are YAML files named by command flag:

```yaml
kind: auto-flow-config
version: 2
name: backend-standard
slots:
  designReview:
    blocks:
      - id: review.design-loop
        enabled: true
        maxIterations: 3
  postImplementationChecks:
    blocks:
      - id: checks.go.linter
        enabled: true
        maxIterations: 5
  review:
    blocks:
      - id: review.loop
        enabled: true
  final:
    blocks: []
```

Supported slots are `designReview`, `postImplementationChecks`, `review`, and `final`. Supported block ids are `review.design-loop`, `checks.go.linter`, `checks.go.tests`, and `review.loop`. `enabled` accepts `true`, `false`, or `auto`; `maxIterations`, when present, must be a positive integer. Version 1 configs are read and normalized to version 2; old persisted `auto-*` state must be restarted with `agentweaver auto`.

## Launch Profiles and Resume

Interactive flow runs can ask for an LLM launch profile: executor plus model. That selection is persisted with resumable flow state.

Resume is allowed only when:

- the flow state exists for the current scope
- the saved launch profile matches the requested one
- required artifacts from completed steps are still present and valid
- Jira-backed flows still have the Jira context they need

If those checks fail, the runtime requires a restart instead of resuming.

## Artifacts and Scope

Artifacts and flow state are stored under the current project scope. In practice:

- Jira-backed runs usually use the Jira issue key as scope
- non-Jira runs can fall back to a git-derived scope
- `--scope <name>` lets you override the default for supported commands
- interactive and web sessions automatically switch the branch-derived scope after the git branch changes, unless the session was started with an explicit Jira argument or `--scope`

The runtime uses artifacts as the contract between stages, including markdown outputs and structured JSON files validated against schemas.

## Interactive TUI

Running without a command opens the full-screen TUI. It acts as the operator console for the harness: browsing flows, launching them in scope, following current execution, and reviewing summaries.

Interactive mode is Ink-only. It requires:

- a real TTY for both stdin and stdout
- installed runtime dependencies from `npm install`

Current navigation:

- `Up` / `Down` — move in the flow tree
- `Left` / `Right` — collapse or expand folders
- `Enter` — toggle folder or run selected flow
- `Tab` / `Shift+Tab` — switch panes
- `PgUp` / `PgDn` — scroll focused pane
- `h` — open help
- `q` or `Ctrl+C` — exit

Current layout:

- left column: `Flows`, `Flow Description`, `Status`
- right column: `Current Flow`, optional `Task Summary`, `Activity`
- `Current Flow` is intentionally tall and scrollable; in the current layout it uses the same height budget as `Flows`
- the `Task Summary` pane is runtime-driven and shows whichever markdown artifact the active flow publishes into summary state, such as a normalized task context or a cached task summary

Flow discovery behavior:

- built-in flows are loaded from `src/pipeline/flow-specs/`
- global custom flows are loaded from `~/.agentweaver/.flows/`
- project-local custom flows are loaded from `.agentweaver/.flows/`
- all discovered flow specs are validated at load time
- duplicate flow ids fail fast across built-in, global, and project-local sources
- custom flows are shown separately in the UI as global and project-local groups

## Custom Flows

You can add custom flow specs under either:

```bash
~/.agentweaver/.flows/**/*.json
.agentweaver/.flows/**/*.json
```

Custom flows:

- are discovered recursively
- get their flow id from the relative path without `.json`
- share the same validator and runtime as built-in flows
- cannot conflict with an existing built-in or other discovered flow id

Use the global directory for reusable personal flows and plugins across repositories, and the project-local directory for repo-specific wiring.

Nested `flow-run` steps can reference built-in, global, or project-local specs by file name, as long as the name resolves unambiguously.

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

Type-check only:

```bash
npm run check
```

Preview publish tarball:

```bash
npm run pack:check
```

Run from source in dev mode:

```bash
npm run dev -- --help
```

Recommended smoke checks:

```bash
node dist/index.js --help
node dist/index.js auto --help-phases
node dist/index.js plan --dry DEMO-1234
node dist/index.js implement --dry DEMO-1234
node dist/index.js review --dry DEMO-1234
```

## Guided Project Guidance

The project playbook is AgentWeaver's way to turn project-specific conventions into durable agent context. Instead of repeating the same instructions in every prompt, a repository can keep stable rules, examples, and templates under `.agentweaver/playbook/`. Guided flows validate that material, select the parts relevant to the current task and phase, and pass compact guidance into the model before planning, implementation, review, and repair.

Typical playbook content includes:

- engineering rules such as required test locations, documentation language, or runtime validation boundaries
- examples that should be opened only when relevant, instead of pasted into every prompt
- templates for recurring artifact shapes or implementation notes
- repository context that should remain visible across tasks without overriding task-specific inputs

Project playbook guidance can be generated and maintained independently with `playbook-init`. Auto workflow execution no longer exposes a separate guided auto command; custom Auto variants are represented as `auto-config:<name>` saved configs.

The guidance is intentionally phase-aware. A rule can apply only to `plan`, `implement`, `review`, or another supported phase; it can also target languages, frameworks, glob patterns, and keywords. AgentWeaver writes both a structured `project-guidance/v1` JSON artifact and a derivative markdown file, then passes their paths into the phase prompt as supplemental project-local context.

Initialize or refresh the playbook with:

```bash
agentweaver playbook-init
agentweaver playbook-init --accept-playbook-draft
```

The workflow does not read old `playbook.json` or `playbook.md` files as fallbacks. Run `agentweaver playbook-init --accept-playbook-draft` to explicitly accept generated playbook content without interactive review. An invalid manifest stops validation before an LLM prompt.

To inspect whether playbook guidance participated in a run, check the generated artifacts:

```bash
find .agentweaver/scopes -name 'project-guidance-*'
rg -n "Project Guidance|practice\\." .agentweaver/scopes
```

Keep `.agentweaver/playbook/` in Git even when other AgentWeaver runtime state is ignored. The playbook format and maintenance workflow are documented in [docs/playbook.md](docs/playbook.md).

Current limitations: skills integration is not available yet; the playbook generator must rely on repository evidence and clarification answers; guided prompts receive compact context and open full examples only when they are directly relevant to the current phase.
