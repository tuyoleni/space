# Space

Space is a cross-platform (macOS + Windows) Electron desktop application
that removes the setup, identity-switching, Git, GitHub, runtime, terminal,
and project-management friction that prevents people from building
software. It orchestrates the real Git CLI, GitHub CLI, package managers,
runtimes, and cloud CLIs through a coherent interface and an explicit
workspace context — it does not replace them.

## Source of truth

The implementation baseline is
[`docs/Space_Product_Engineering_Specification_v1.0.pdf`](docs/Space_Product_Engineering_Specification_v1.0.pdf),
plus the Architecture Decision Records in [`docs/adr/`](docs/adr/). The
spec is deliberately prescriptive (MUST/MUST NOT/SHOULD/MAY keywords) and
governs every product and engineering decision in this repository. Where
this README and the spec disagree, the spec wins.

Required reading order for new contributors, per spec section 1.2:
1. Product definition and non-negotiable principles (spec section 3).
2. Scope hierarchy and workspace isolation model (spec section 5).
3. Security boundaries (spec section 25).
4. Electron process architecture (spec section 20).
5. Workspace Process Runner (spec section 21).
6. Functional requirements for the feature being implemented.
7. Testing and definition of done (spec sections 34-35).

## Repository layout

```
apps/desktop/       Electron app: src/main, src/preload, src/renderer
packages/contracts/       IPC schemas and shared domain types
packages/domain/          Pure models and policies
packages/workspace-runner/  Environment construction and process execution
packages/git-engine/      Git commands, parsers, queue, fixtures
packages/github-engine/   gh adapter and GitHub models
packages/environment/     Tool registry, installers, service adapters
packages/terminal/        PTY host and protocol
packages/activity/        Event model and aggregation
packages/automation/      Triggers, conditions, actions
packages/storage/         SQLite repositories and migrations
packages/security/        Permission policy, redaction, sender validation
packages/ui/              Shared renderer components
tests/{fixtures,integration,e2e}/
docs/{adr,threat-model,runbooks}/
```

Packages that execute native operations (`workspace-runner`, `git-engine`,
`github-engine`, `environment`, `terminal`, `storage`, `security`) must
never be imported into the renderer bundle (spec section 32).

## Milestones

Built as vertical slices, not a broad mock interface (spec section 36 /
43). Tracked as an ordered set of milestones mirroring the spec's phased
implementation programme:

| Milestone | Spec phase | Exit criteria |
|---|---|---|
| M0 | Scaffold | Toolchain, package boundaries, secure Electron defaults in place |
| M1 | Phase 0: Technical risk spikes | Native baseline, environment runner, Git graph proven |
| M2 | Phase 1: Secure application foundation | Create/switch workspaces and add folders; no arbitrary command path from renderer |
| M3 | Phase 2: Computer bootstrap | Clean machines prepared; interrupted setup resumes safely |
| M4 | Phase 3: Project and terminal foundation | Create/trust a project, install deps, run it from a workspace-bound terminal |
| M5 | Phase 4: Complete local Git | Daily Git work completed without leaving Space |
| M6 | Phase 5: GitHub workflow | Publish, PR, checks, merge, release in a disposable test org |
| M7 | Phase 6: Intent and agent layer | Agent changes traceable, secrets excluded, high-impact actions confirmed |
| M8 | Phase 7: Automation and hardening | Local automation, cross-platform hardening, performance, accessibility, updates |

The final implementation directive (spec section 43): the first reliable
deliverable is a secure vertical slice — two named workspaces with distinct
Git identities, a real workspace-bound terminal in each, a real project
with real Git init and a real commit, real history rendering, and
GitHub publish through the correct workspace identity, with a receipt for
every mutating action.

## Development

```bash
npm install
npm run dev        # starts the Electron app (apps/desktop)
npm run lint
npm run typecheck
npm run test
```

## Prohibited shortcuts

See spec section 39. Notably: no `runAnyCommand`/generic shell IPC, no
direct Node access from the renderer, no token storage in SQLite/plain
JSON, no rewriting global config files on workspace switch, no running
dependency installs before trust is granted, and no treating workspace
isolation as a malicious-code sandbox.
