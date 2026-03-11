# Service Concept Implementation - Work Plan

## TL;DR

> **Quick Summary**: Implement a "Service" abstraction for serviceclaw that allows non-technical users to install pre-configured bundles of skills, tools, triggers, and UI components as "AI mini-apps" with one-click installation.
>
> **Deliverables**:
>
> - Service manifest schema and validation
> - Service lifecycle manager (install/enable/disable/uninstall)
> - CLI commands for Service management
> - Integration with existing CronService for triggers
> - 4 example Services demonstrating different capabilities
> - Configuration wizard UI
> - Documentation and developer guide
>
> **Estimated Effort**: Medium (2-3 months, ~15-20 tasks)
> **Parallel Execution**: YES - 4 waves with 3-6 tasks each
> **Critical Path**: T1 → T4 → T6 → T9 → T11-14 (Final Review)

---

## Context

### Original Request

User wants to add a "Service" concept to serviceclaw (fork of openclaw) - a higher-level abstraction that bundles skills, scripts, triggers, and web UI into installable "AI mini-apps" for non-technical primary users.

### Key Insights from Metis Gap Analysis

**Critical Risks Identified:**

1. **Scope Creep Risk**: Must extend existing infrastructure (CronService, plugin tools) rather than building parallel architecture
2. **Security Risk**: ClawHavoc incident showed 47% of skills had security issues - Services need capability declarations and user confirmation
3. **Dependency Hell**: Version conflicts between bundled components - need atomic installation with rollback
4. **Resource Leaks**: Cron jobs and state must be cleaned up on uninstall

**Guardrails Applied:**

- Services are NOT a new runtime - they use existing infrastructure
- NO custom UI frameworks - extend existing Control UI patterns
- NO Service-to-Service dependencies in MVP
- NO marketplace/registry in MVP - install from local files/GitHub
- Services subject to existing tool policy - cannot bypass security

### Target Users

**Primary**: Non-technical users who want "one-click install" solutions  
**Secondary**: Power users who want to create and share Service templates

---

## Work Objectives

### Core Objective

Enable non-technical users to install complete AI solutions ("Services") that bundle skills, tools, triggers, and configuration without manual setup or deep technical knowledge.

### Concrete Deliverables

1. **Service Manifest Schema** - JSON schema defining Service structure
2. **Service Lifecycle Manager** - Install/enable/disable/uninstall with atomic operations
3. **CLI Commands** - `serviceclaw service [list|install|remove|enable|disable|status|logs]`
4. **Trigger Integration** - Cron, webhook, and message triggers via existing infrastructure
5. **Four Example Services**:
   - Daily Briefing (cron trigger)
   - Webhook Receiver (webhook trigger)
   - Message Processor (message trigger)
   - Data Dashboard (UI-focused, with auto-refresh)
6. **Configuration Wizard** - Visual config UI (Option B)
7. **Documentation** - Developer guide and API reference

### Definition of Done

All acceptance criteria pass (see Verification Strategy section), including:

- Service installs in <30 seconds
- Service respects tool policy (cannot bypass denylist)
- Service uninstall cleans up all resources
- Each example Service has automated lifecycle test
- Security audit passes (no privilege escalation)

### Must Have

- [ ] Service manifest format with validation
- [ ] Lifecycle states: installing → installed → enabled → disabled → uninstalling
- [ ] Integration with CronService for scheduled triggers
- [ ] CLI for Service management
- [ ] 4 working example Services (Daily Briefing, Webhook Receiver, Message Processor, Data Dashboard)
- [ ] Atomic installation with rollback on failure
- [ ] Security: capability declarations, user confirmation for privileged tools

### Must NOT Have (Guardrails)

- [ ] Service-to-Service dependencies (out of scope)
- [ ] Custom UI frameworks (use existing Lit patterns)
- [ ] Service marketplace/registry (Phase 2)
- [ ] Advanced sandboxing beyond existing tool policy
- [ ] Hot-reload of Services (require restart)
- [ ] Cross-Service communication
- [ ] Automatic updates

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES (Vitest for testing, existing test patterns)
- **Automated tests**: YES (TDD approach - tests first, implementation after)
- **Framework**: Vitest with existing test utilities
- **Strategy**: Each task includes unit tests; integration tests for Service lifecycle

### QA Policy

Every task MUST include agent-executed QA scenarios:

- **CLI/Backend**: Bash commands with assertions on output/exit codes
- **File operations**: Verify file creation, content, permissions
- **Integration**: End-to-end Service lifecycle (install → trigger → verify → uninstall)

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - Can Start Immediately):
├── Task 1: Define 3 Example Services
├── Task 2: Audit Existing Trigger Infrastructure
├── Task 3: Analyze Extension/Plugin Patterns
└── Task 4: Service Architecture Design Document

Wave 2 (Schema & Design):
├── Task 5: Service Manifest JSON Schema
├── Task 6: Service Core Infrastructure (Lifecycle Manager)
└── Task 7: Service Registry & State Management

Wave 3 (CLI & Integration):
├── Task 8: Service CLI Commands
├── Task 9: CronService Integration for Service Triggers
├── Task 10: Security Model (Capability Declarations)
└── Task 11: Error Handling & Rollback

Wave 4 (Examples & Polish):
├── Task 12: Example Service 1 - Daily Briefing
├── Task 13: Example Service 2 - Webhook Receiver
├── Task 14: Example Service 3 - Message Processor
├── Task 15: Example Service 4 - Data Dashboard
├── Task 16: Configuration Wizard UI
└── Task 17: Documentation & Developer Guide

Wave 5 (Integration & Review):
├── Task 18: Integration Tests (Full lifecycle)
├── Task 19: Performance Testing
└── Task 20: Security Audit

Wave FINAL (4 Parallel Reviews):
├── Task F1: Plan Compliance Audit (Oracle)
├── Task F2: Code Quality Review
├── Task F3: Real Manual QA
└── Task F4: Scope Fidelity Check
```

### Dependency Matrix

| Task                     | Depends On  | Blocks          |
| ------------------------ | ----------- | --------------- |
| T1 (Example Services)    | -           | T4, T12-14      |
| T2 (Trigger Audit)       | -           | T4, T9          |
| T3 (Extension Patterns)  | -           | T5, T6          |
| T4 (Architecture Design) | T1, T2      | T5, T6, T7      |
| T5 (Manifest Schema)     | T3, T4      | T6              |
| T6 (Core Infrastructure) | T3, T4, T5  | T7, T8, T9, T10 |
| T7 (Registry/State)      | T4, T6      | T8, T12-14      |
| T8 (CLI)                 | T6, T7      | T12-14          |
| T9 (Cron Integration)    | T2, T6      | T12-14          |
| T10 (Security)           | T6          | T12-14          |
| T11 (Error Handling)     | T6          | T12-14          |
| T12-15 (Examples)        | T1, T6-11   | T16-18          |
| T16 (Config Wizard)      | T5, T12-15  | -               |
| T17 (Docs)               | T12-16      | -               |
| T18 (Integration Tests)  | T12-15      | F1-F4           |
| T19 (Performance)        | T12-15      | F1-F4           |
| T20 (Security Audit)     | T10, T12-15 | F1-F4           |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks → `artistry` (T1), `deep` (T2, T3), `artistry` (T4)
- **Wave 2**: 3 tasks → `unspecified-medium` (T5, T7), `ultrabrain` (T6)
- **Wave 3**: 4 tasks → `unspecified-medium` (T8, T9, T11), `deep` (T10)
- **Wave 4**: 6 tasks → `artistry` (T12-15), `visual-engineering` (T16), `writing` (T17)
- **Wave 5**: 3 tasks → `deep` (T18, T20), `unspecified-medium` (T19)
- **Wave FINAL**: 4 tasks → `oracle` (F1), `unspecified-high` (F2, F3), `deep` (F4)

Critical Path: T1 → T4 → T6 → T9 → T12-15 → T18 → F1-F4

---

## TODOs

- [x] **1. Define 3 Example Services**

  **What to do**:
  - Document 3 specific Service use cases that will guide architecture decisions
  - Define: Service purpose, trigger type, skills/tools needed, UI requirements, configuration schema
  - Get user approval on examples before proceeding with implementation

  **Recommended Example Services**:
  1. **Daily Briefing Service**: Cron trigger (8am daily) → fetches weather/news/calendar → generates summary → delivers via preferred channel
  2. **Webhook Receiver Service**: Webhook trigger → receives HTTP POSTs → processes payload via skills → stores/acts on data
  3. **Message Processor Service**: Message trigger → watches specific channels → processes attachments/commands → responds

  **Must NOT do**:
  - Don't implement the Services yet - this is design phase only
  - Don't over-engineer requirements - keep them simple for MVP

  **Recommended Agent Profile**:
  - **Category**: `artistry` - creative problem-solving for user-facing design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T4, T12, T13, T14
  - **Blocked By**: None

  **References**:
  - `docs/tools/skills.md` - Understand skill structure
  - `src/cron/service.ts` - Current cron capabilities
  - `extensions/lobster/README.md` - Complex extension example

  **Acceptance Criteria**:
  - [ ] Document exists with 3 Service definitions
  - [ ] Each Service has: purpose, trigger, skills/tools list, config schema draft
  - [ ] User has approved the examples

  **QA Scenarios**:

  ```
  Scenario: Review example definitions
    Tool: Read
    Steps:
      1. Read document at docs/services/examples.md
      2. Verify 4 examples defined
      3. Verify each has required fields
    Expected Result: Document is complete and approved
    Evidence: .sisyphus/evidence/task-1-examples-reviewed.md
  ```

  **Commit**: YES
  - Message: `docs: define 3 MVP Service examples`
  - Files: `docs/services/examples.md`

---

- [x] **2. Audit Existing Trigger Infrastructure**

  **What to do**:
  - Map all existing trigger mechanisms in the codebase
  - Document cron system, webhook handlers, message triggers
  - Identify extension points for Service trigger integration

  **Must NOT do**:
  - Don't modify any existing code
  - Don't design new trigger types yet

  **Recommended Agent Profile**:
  - **Category**: `deep` - thorough research of existing patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T4, T9
  - **Blocked By**: None

  **References**:
  - `src/cron/service.ts` - Cron job management
  - `src/cron/types.ts` - Cron type definitions
  - `src/web/routes.ts` - Webhook routing
  - `src/auto-reply/` - Message trigger handling
  - `src/channels/` - Channel integrations

  **Acceptance Criteria**:
  - [ ] Document listing all trigger types with file paths
  - [ ] Analysis of how each trigger type works
  - [ ] Identification of Service integration points

  **QA Scenarios**:

  ```
  Scenario: Verify trigger audit document
    Tool: Read
    Steps:
      1. Read docs/services/trigger-audit.md
      2. Verify cron, webhook, message triggers documented
      3. Verify file paths included
    Expected Result: Complete audit with integration recommendations
    Evidence: .sisyphus/evidence/task-2-trigger-audit.md
  ```

  **Commit**: YES
  - Message: `docs: audit existing trigger infrastructure`
  - Files: `docs/services/trigger-audit.md`

---

- [x] **3. Analyze Extension/Plugin Patterns**

  **What to do**:
  - Study how existing extensions integrate with OpenClaw
  - Document plugin SDK patterns for tools, skills, and lifecycle
  - Identify patterns for optional/conditional extension loading

  **Must NOT do**:
  - Don't implement anything yet
  - Don't create new extension infrastructure

  **Recommended Agent Profile**:
  - **Category**: `deep` - pattern analysis
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T5, T6
  - **Blocked By**: None

  **References**:
  - `extensions/lobster/` - Complex optional extension
  - `extensions/llm-task/` - Tool-only extension
  - `extensions/bluebubbles/` - Channel extension
  - `src/plugins/tools.ts` - Tool registration
  - `src/agents/skills/plugin-skills.ts` - Plugin skill loading

  **Acceptance Criteria**:
  - [ ] Document with extension pattern analysis
  - [ ] Code examples for each pattern type
  - [ ] Recommendations for Service implementation

  **QA Scenarios**:

  ```
  Scenario: Verify extension patterns documented
    Tool: Read
    Steps:
      1. Read docs/services/extension-patterns.md
      2. Verify at least 3 extension examples analyzed
      3. Verify integration recommendations present
    Expected Result: Pattern document complete
    Evidence: .sisyphus/evidence/task-3-extension-patterns.md
  ```

  **Commit**: YES
  - Message: `docs: analyze extension and plugin patterns`
  - Files: `docs/services/extension-patterns.md`

---

- [x] **4. Service Architecture Design Document**

  **What to do**:
  - Design Service architecture based on findings from T1, T2, T3
  - Define Service lifecycle, state machine, and integration points
  - Design security model with capability declarations
  - Get user approval before proceeding to implementation

  **Must NOT do**:
  - Don't implement - this is design only
  - Don't bypass existing infrastructure

  **Recommended Agent Profile**:
  - **Category**: `artistry` - architectural design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (final task)
  - **Blocks**: T5, T6, T7
  - **Blocked By**: T1, T2

  **References**:
  - `docs/services/examples.md` (from T1)
  - `docs/services/trigger-audit.md` (from T2)
  - `docs/services/extension-patterns.md` (from T3)
  - `src/agents/skills/types.ts` - Skill metadata patterns

  **Acceptance Criteria**:
  - [ ] Architecture document with component diagrams
  - [ ] Service lifecycle state machine defined
  - [ ] Security model with capability declarations
  - [ ] Integration points with existing infrastructure documented
  - [ ] User approval obtained

  **QA Scenarios**:

  ```
  Scenario: Review architecture design
    Tool: Read
    Steps:
      1. Read docs/services/architecture.md
      2. Verify lifecycle states defined
      3. Verify security model documented
      4. Verify user approval noted
    Expected Result: Architecture approved and ready for implementation
    Evidence: .sisyphus/evidence/task-4-architecture-approved.md
  ```

  **Commit**: YES
  - Message: `docs: Service architecture design`
  - Files: `docs/services/architecture.md`

---

- [x] **5. Service Manifest JSON Schema**

  **What to do**:
  - Create JSON Schema for Service manifest (service.json)
  - Define all required fields: metadata, dependencies, triggers, config
  - Include validation rules and examples

  **Must NOT do**:
  - Don't implement validation code yet
  - Don't add runtime dependencies

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - schema design
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T3, T4)
  - **Parallel Group**: Wave 2
  - **Blocks**: T6
  - **Blocked By**: T3, T4

  **References**:
  - `docs/services/architecture.md` (from T4)
  - `src/agents/skills/types.ts` - Skill metadata types
  - `src/config/types.ts` - Config type patterns

  **Acceptance Criteria**:
  - [ ] JSON Schema file created and validated
  - [ ] Schema validates against 4 example Services from T1
  - [ ] Examples included in schema documentation

  **QA Scenarios**:

  ```
  Scenario: Validate manifest schema
    Tool: Bash
    Steps:
      1. Run `bun test src/services/schema.test.ts`
      2. Verify schema validates example manifests
      3. Verify invalid manifests are rejected
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-5-schema-tests.txt
  ```

  **Commit**: YES
  - Message: `feat: Service manifest JSON Schema`
  - Files: `src/services/schema.ts`, `src/services/schema.test.ts`

---

- [x] **6. Service Core Infrastructure (Lifecycle Manager)**

  **What to do**:
  - Implement Service class with lifecycle management
  - Implement state machine: installing → installed → enabled → disabled → uninstalling
  - Implement atomic installation with rollback
  - Integrate with existing CronService, plugin tools, skill loading

  **Must NOT do**:
  - Don't create parallel infrastructure - use existing patterns
  - Don't implement CLI yet (that's T8)

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` - complex state machine logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (after T5)
  - **Parallel Group**: Wave 2
  - **Blocks**: T7, T8, T9, T10, T11
  - **Blocked By**: T3, T4, T5

  **References**:
  - `docs/services/architecture.md` (from T4)
  - `src/services/schema.ts` (from T5)
  - `src/cron/service.ts` - Cron job management patterns
  - `src/agents/skills/workspace.ts` - Skill loading patterns
  - `src/plugins/tools.ts` - Tool registration patterns

  **Acceptance Criteria**:
  - [ ] Service class implements all lifecycle states
  - [ ] Atomic installation with rollback on failure
  - [ ] Integration tests for install/uninstall
  - [ ] Unit tests for state transitions

  **QA Scenarios**:

  ```
  Scenario: Test Service lifecycle
    Tool: Bash
    Steps:
      1. Run `bun test src/services/lifecycle.test.ts`
      2. Verify install → enable → disable → uninstall flow
      3. Verify rollback on failed install
    Expected Result: All lifecycle tests pass
    Evidence: .sisyphus/evidence/task-6-lifecycle-tests.txt
  ```

  **Commit**: YES
  - Message: `feat: Service lifecycle manager with atomic operations`
  - Files: `src/services/lifecycle.ts`, `src/services/lifecycle.test.ts`

---

- [x] **7. Service Registry & State Management**

  **What to do**:
  - Implement Service registry for tracking installed Services
  - Implement state persistence across Gateway restarts
  - Implement resource tracking (which resources belong to which Service)

  **Must NOT do**:
  - Don't use external databases - use existing config patterns
  - Don't implement complex queries

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - data management
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6)
  - **Parallel Group**: Wave 2
  - **Blocks**: T8, T12-14
  - **Blocked By**: T4, T6

  **References**:
  - `src/config/types.ts` - Config storage patterns
  - `src/persist/` - Persistence utilities
  - `src/agents/skills/config.ts` - Skill config patterns

  **Acceptance Criteria**:
  - [ ] Registry tracks all installed Services
  - [ ] State persists across Gateway restarts
  - [ ] Resource ownership tracked
  - [ ] Unit tests for registry operations

  **QA Scenarios**:

  ```
  Scenario: Test registry persistence
    Tool: Bash
    Steps:
      1. Install test Service
      2. Verify registry entry created
      3. Restart Gateway (simulate)
      4. Verify Service state persisted
    Expected Result: State survives restart
    Evidence: .sisyphus/evidence/task-7-registry-tests.txt
  ```

  **Commit**: YES
  - Message: `feat: Service registry and state management`
  - Files: `src/services/registry.ts`, `src/services/registry.test.ts`

---

- [x] **8. Service CLI Commands**

  **What to do**:
  - Implement CLI commands for Service management
  - Commands: list, install, remove, enable, disable, status, logs
  - Include progress indicators and error handling

  **Must NOT do**:
  - Don't implement complex UI - CLI only for MVP
  - Don't add interactive prompts yet (can be enhancement)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - CLI implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6, T7)
  - **Parallel Group**: Wave 3
  - **Blocks**: T12-14
  - **Blocked By**: T6, T7

  **References**:
  - `src/cli/` - Existing CLI structure
  - `src/services/lifecycle.ts` (from T6)
  - `src/services/registry.ts` (from T7)
  - `src/cli/progress.ts` - Progress indicators

  **Acceptance Criteria**:
  - [ ] All CLI commands implemented
  - [ ] Help text for each command
  - [ ] Error handling with clear messages
  - [ ] Integration tests for CLI

  **QA Scenarios**:

  ```
  Scenario: Test CLI commands
    Tool: Bash
    Steps:
      1. Run `serviceclaw service list`
      2. Run `serviceclaw service install ./test-service`
      3. Run `serviceclaw service status test-service`
      4. Run `serviceclaw service remove test-service`
    Expected Result: All commands work correctly
    Evidence: .sisyphus/evidence/task-8-cli-test.txt
  ```

  **Commit**: YES
  - Message: `feat: Service CLI commands`
  - Files: `src/cli/service.ts`, `src/cli/service.test.ts`

---

- [x] **9. CronService Integration for Service Triggers**

  **What to do**:
  - Integrate Services with existing CronService for scheduled triggers
  - Implement Service ownership for cron jobs
  - Implement bulk disable/enable for Service crons

  **Must NOT do**:
  - Don't modify CronService core - extend it
  - Don't build new scheduler

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - integration
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T2, T6)
  - **Parallel Group**: Wave 3
  - **Blocks**: T12-14
  - **Blocked By**: T2, T6

  **References**:
  - `src/cron/service.ts` - CronService
  - `docs/services/trigger-audit.md` (from T2)
  - `src/services/lifecycle.ts` (from T6)

  **Acceptance Criteria**:
  - [ ] Services can register cron triggers
  - [ ] Cron jobs have Service ownership metadata
  - [ ] Disabling Service disables its cron jobs
  - [ ] Integration tests for cron triggers

  **QA Scenarios**:

  ```
  Scenario: Test Service cron triggers
    Tool: Bash
    Steps:
      1. Install Service with cron trigger
      2. Verify cron job registered with Service ownership
      3. Disable Service
      4. Verify cron job disabled
    Expected Result: Cron integration works correctly
    Evidence: .sisyphus/evidence/task-9-cron-integration.txt
  ```

  **Commit**: YES
  - Message: `feat: CronService integration for Service triggers`
  - Files: `src/services/triggers/cron.ts`, `src/services/triggers/cron.test.ts`

---

- [x] **10. Security Model (Capability Declarations)**

  **What to do**:
  - Implement capability declarations in Service manifest
  - Implement user confirmation for privileged operations
  - Implement audit logging for Service actions
  - Ensure Services respect existing tool policy

  **Must NOT do**:
  - Don't bypass existing tool policy
  - Don't implement complex sandboxing

  **Recommended Agent Profile**:
  - **Category**: `deep` - security implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6)
  - **Parallel Group**: Wave 3
  - **Blocks**: T12-14, T18
  - **Blocked By**: T6

  **References**:
  - `src/agents/tools/tool-policy-pipeline.ts` - Tool policy
  - `docs/services/architecture.md` - Security design
  - `src/logging/` - Logging infrastructure

  **Acceptance Criteria**:
  - [ ] Capability declarations in manifest
  - [ ] User confirmation for privileged tools
  - [ ] Audit logging for all Service operations
  - [ ] Security tests (privilege escalation attempts)

  **QA Scenarios**:

  ```
  Scenario: Test Service security
    Tool: Bash
    Steps:
      1. Install Service with privileged tool (bash)
      2. Verify user confirmation required
      3. Attempt privilege escalation
      4. Verify blocked by tool policy
    Expected Result: Security controls work
    Evidence: .sisyphus/evidence/task-10-security-tests.txt
  ```

  **Commit**: YES
  - Message: `feat: Service security model with capabilities and audit`
  - Files: `src/services/security.ts`, `src/services/security.test.ts`

---

- [x] **11. Error Handling & Rollback**

  **What to do**:
  - Implement comprehensive error handling for Service operations
  - Implement rollback on failed installation
  - Implement cleanup verification for uninstall

  **Must NOT do**:
  - Don't leave partial state on failure
  - Don't ignore errors

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - error handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6)
  - **Parallel Group**: Wave 3
  - **Blocks**: T12-14
  - **Blocked By**: T6

  **References**:
  - `src/services/lifecycle.ts` (from T6)
  - `src/infra/errors.ts` - Error handling patterns

  **Acceptance Criteria**:
  - [ ] Rollback on installation failure
  - [ ] Cleanup verification on uninstall
  - [ ] Clear error messages for all failure modes
  - [ ] Error handling tests

  **QA Scenarios**:

  ```
  Scenario: Test error handling and rollback
    Tool: Bash
    Steps:
      1. Attempt install with malformed Service
      2. Verify rollback - no partial state
      3. Verify clear error message
    Expected Result: Clean rollback, good error messages
    Evidence: .sisyphus/evidence/task-11-error-handling.txt
  ```

  **Commit**: YES
  - Message: `feat: Service error handling and rollback`
  - Files: `src/services/errors.ts`, `src/services/errors.test.ts`

---

- [x] **12. Example Service 1 - Daily Briefing**

  **What to do**:
  - Implement Daily Briefing Service as reference implementation
  - Cron trigger (8am daily)
  - Fetches weather/news/calendar, generates summary, delivers to channel

  **Must NOT do**:
  - Don't over-engineer - keep it simple
  - Don't add features beyond the example spec

  **Recommended Agent Profile**:
  - **Category**: `artistry` - creating reference implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6-11)
  - **Parallel Group**: Wave 4
  - **Blocks**: T16
  - **Blocked By**: T1, T6, T7, T8, T9, T10, T11

  **References**:
  - `docs/services/examples.md` (from T1)
  - `src/services/lifecycle.ts` (from T6)
  - `src/services/triggers/cron.ts` (from T9)

  **Acceptance Criteria**:
  - [ ] Service manifest created
  - [ ] Service installs and runs correctly
  - [ ] Cron trigger fires at scheduled time
  - [ ] Automated lifecycle test passes

  **QA Scenarios**:

  ```
  Scenario: Test Daily Briefing Service
    Tool: Bash
    Steps:
      1. Install example service: `serviceclaw service install examples/daily-briefing`
      2. Enable service
      3. Trigger manually: `serviceclaw service trigger daily-briefing`
      4. Verify output
      5. Uninstall service
    Expected Result: Full lifecycle works
    Evidence: .sisyphus/evidence/task-12-example-1.txt
  ```

  **Commit**: YES
  - Message: `feat: Daily Briefing example Service`
  - Files: `examples/daily-briefing/*`, `examples/daily-briefing/service.json`

---

- [x] **13. Example Service 2 - Webhook Receiver**

  **What to do**:
  - Implement Webhook Receiver Service
  - Webhook trigger (HTTP POST)
  - Receives payload, processes via skills, stores/acts on data

  **Must NOT do**:
  - Don't implement complex webhook authentication yet
  - Don't add webhook replay functionality

  **Recommended Agent Profile**:
  - **Category**: `artistry` - reference implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6-11)
  - **Parallel Group**: Wave 4
  - **Blocks**: T16
  - **Blocked By**: T1, T6, T7, T8, T9, T10, T11

  **References**:
  - `docs/services/examples.md` (from T1)
  - `src/services/lifecycle.ts` (from T6)
  - `src/web/routes.ts` - Webhook routing

  **Acceptance Criteria**:
  - [ ] Service manifest created
  - [ ] Webhook endpoint registered
  - [ ] Payload processing works
  - [ ] Automated lifecycle test passes

  **QA Scenarios**:

  ```
  Scenario: Test Webhook Receiver Service
    Tool: Bash (curl)
    Steps:
      1. Install example service
      2. Send test webhook: `curl -X POST http://localhost:18789/services/webhook-receiver/test`
      3. Verify payload processed
      4. Uninstall service
    Expected Result: Webhook trigger works
    Evidence: .sisyphus/evidence/task-13-example-2.txt
  ```

  **Commit**: YES
  - Message: `feat: Webhook Receiver example Service`
  - Files: `examples/webhook-receiver/*`, `examples/webhook-receiver/service.json`

---

- [x] **14. Example Service 3 - Message Processor**

  **What to do**:
  - Implement Message Processor Service
  - Message trigger (channel messages)
  - Watches channel, processes attachments/commands, responds

  **Must NOT do**:
  - Don't implement complex NLP
  - Don't add multi-channel support yet

  **Recommended Agent Profile**:
  - **Category**: `artistry` - reference implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6-11)
  - **Parallel Group**: Wave 4
  - **Blocks**: T16
  - **Blocked By**: T1, T6, T7, T8, T9, T10, T11

  **References**:
  - `docs/services/examples.md` (from T1)
  - `src/services/lifecycle.ts` (from T6)
  - `src/auto-reply/` - Message handling

  **Acceptance Criteria**:
  - [ ] Service manifest created
  - [ ] Message trigger registered
  - [ ] Command processing works
  - [ ] Automated lifecycle test passes

  **QA Scenarios**:

  ```
  Scenario: Test Message Processor Service
    Tool: Bash
    Steps:
      1. Install example service
      2. Send test message to channel
      3. Verify Service processes message
      4. Uninstall service
    Expected Result: Message trigger works
    Evidence: .sisyphus/evidence/task-14-example-3.txt
  ```

  **Commit**: YES
  - Message: `feat: Message Processor example Service`
  - Files: `examples/message-processor/*`, `examples/message-processor/service.json`

---

- [x] **15. Example Service 4 - Data Dashboard**

  **What to do**:
  - Implement Data Dashboard Service as UI-focused example
  - Web UI showing real-time data (weather, tasks, etc.)
  - Auto-refresh, configurable widgets
  - Demonstrates Service Web UI capabilities

  **Must NOT do**:
  - Don't implement complex chart libraries - use simple HTML/CSS
  - Don't add real-time WebSocket updates (polling is fine)

  **Recommended Agent Profile**:
  - **Category**: `artistry` - reference implementation with UI
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T6-11)
  - **Parallel Group**: Wave 4
  - **Blocks**: T16
  - **Blocked By**: T1, T6, T7, T8, T9, T10, T11

  **References**:
  - `docs/services/examples.md` (from T1)
  - `src/services/lifecycle.ts` (from T6)
  - `src/web/routes.ts` - Web serving
  - `ui/src/ui/` - Existing UI components

  **Acceptance Criteria**:
  - [ ] Service manifest created with web UI config
  - [ ] Dashboard page auto-refreshes data
  - [ ] Configurable widgets (user can choose what to display)
  - [ ] Accessible at `/services/dashboard/view`
  - [ ] Automated lifecycle test passes

  **QA Scenarios**:

  ```
  Scenario: Test Data Dashboard Service
    Tool: interactive_bash (tmux)
    Steps:
      1. Install service: `serviceclaw service install examples/data-dashboard`
      2. Open browser to `http://localhost:18789/services/dashboard/view`
      3. Verify dashboard displays data
      4. Wait for auto-refresh
      5. Verify data updates
    Expected Result: Dashboard displays and updates data
    Evidence: .sisyphus/evidence/task-15-example-4.png
  ```

  **Commit**: YES
  - Message: `feat: Data Dashboard example Service with Web UI`
  - Files: `examples/data-dashboard/*`, `examples/data-dashboard/service.json`

---

- [x] **16. Configuration Wizard UI**

  **What to do**:
  - Implement visual configuration wizard for Service setup
  - Interactive forms based on Service config schema
  - Step-by-step guided configuration (user selected Option B)
  - Integrate with existing Control UI (Lit components)

  **Must NOT do**:
  - Don't use React/Vue - use existing Lit patterns
  - Don't implement complex validation UI yet

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` - UI implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T5)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: T5

  **References**:
  - `src/services/schema.ts` (from T5) - Config schema
  - `src/web/` - Control UI structure
  - `ui/src/ui/` - Existing Lit components

  **Acceptance Criteria**:
  - [ ] Config wizard component implemented
  - [ ] Renders forms from JSON schema
  - [ ] Works with all 4 example Services
  - [ ] Integrated into Control UI

  **QA Scenarios**:

  ```
  Scenario: Test config wizard
    Tool: interactive_bash (tmux)
    Steps:
      1. Open Control UI
      2. Navigate to Service installation
      3. Select Daily Briefing Service
      4. Verify wizard shows config form
      5. Fill in values and submit
    Expected Result: Service configured via wizard
    Evidence: .sisyphus/evidence/task-16-wizard-ui.png
  ```

  **Commit**: YES
  - Message: `feat: Service configuration wizard UI`
  - Files: `ui/src/ui/services/config-wizard.ts`, `ui/src/ui/services/config-wizard.test.ts`

---

- [x] **17. Documentation & Developer Guide**

  **What to do**:
  - Write comprehensive documentation
  - Developer guide for creating Services
  - API reference for Service manifest
  - Troubleshooting guide
  - Configuration wizard user guide

  **Must NOT do**:
  - Don't write generic docs - focus on practical examples
  - Don't duplicate existing OpenClaw docs

  **Recommended Agent Profile**:
  - **Category**: `writing` - documentation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T12-16)
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: T12, T13, T14, T15, T16

  **References**:
  - `examples/` - Reference implementations
  - `docs/services/` - Existing docs
  - `docs/tools/skills.md` - Skill documentation pattern
  - `ui/src/ui/services/config-wizard.ts` (from T15)

  **Acceptance Criteria**:
  - [ ] Developer guide complete
  - [ ] API reference documented
  - [ ] Troubleshooting guide included
  - [ ] Configuration wizard guide included
  - [ ] Examples well-documented

  **QA Scenarios**:

  ```
  Scenario: Review documentation
    Tool: Read
    Steps:
      1. Read docs/services/development.md
      2. Verify all sections complete
      3. Follow guide to create test Service
    Expected Result: Documentation is complete and usable
    Evidence: .sisyphus/evidence/task-16-documentation.md
  ```

  **Commit**: YES
  - Message: `docs: Service development guide and API reference`
  - Files: `docs/services/development.md`, `docs/services/api.md`, `docs/services/troubleshooting.md`, `docs/services/configuration-wizard.md`

---

- [x] **18. Integration Tests (Full lifecycle)**

  **What to do**:
  - Implement comprehensive integration tests
  - Test full lifecycle: install → trigger → verify → uninstall
  - Test all 3 example Services
  - Test error scenarios

  **Must NOT do**:
  - Don't skip edge cases
  - Don't rely on mocks for critical paths

  **Recommended Agent Profile**:
  - **Category**: `deep` - integration testing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T12-14)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4
  - **Blocked By**: T12, T13, T14

  **References**:
  - `examples/` - Test subjects
  - `src/services/` - Components under test
  - `src/test/` - Existing test patterns

  **Acceptance Criteria**:
  - [ ] Integration tests for all 4 examples
  - [ ] Full lifecycle tests (install → trigger → verify → uninstall)
  - [ ] Error scenario tests
  - [ ] All tests pass

  **QA Scenarios**:

  ```
  Scenario: Run integration tests
    Tool: Bash
    Steps:
      1. Run `bun test src/services/integration.test.ts`
      2. Verify all tests pass
      3. Check coverage report
    Expected Result: 100% of integration tests pass
    Evidence: .sisyphus/evidence/task-18-integration-tests.txt
  ```

  **Commit**: YES
  - Message: `test: Service integration tests`
  - Files: `src/services/integration.test.ts`

---

- [x] **19. Performance Testing**

  **What to do**:
  - Implement performance benchmarks
  - Test installation time (<30 seconds)
  - Test startup time (<5 seconds)
  - Test with multiple concurrent Services

  **Must NOT do**:
  - Don't optimize prematurely
  - Don't test unrealistic scenarios

  **Recommended Agent Profile**:
  - **Category**: `unspecified-medium` - performance testing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T12-14)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4
  - **Blocked By**: T12, T13, T14

  **References**:
  - `examples/` - Test subjects
  - `src/services/lifecycle.ts` - Performance critical code

  **Acceptance Criteria**:
  - [ ] Installation time <30 seconds
  - [ ] Service startup time <5 seconds
  - [ ] 10 concurrent Services run without degradation
  - [ ] Benchmark tests documented

  **QA Scenarios**:

  ```
  Scenario: Run performance tests
    Tool: Bash
    Steps:
      1. Run `bun test src/services/performance.test.ts`
      2. Verify all benchmarks meet criteria
    Expected Result: Performance requirements met
    Evidence: .sisyphus/evidence/task-19-performance.txt
  ```

  **Commit**: YES
  - Message: `test: Service performance benchmarks`
  - Files: `src/services/performance.test.ts`, `docs/services/performance.md`

---

- [x] **20. Security Audit**

  **What to do**:
  - Conduct security audit of Service implementation
  - Test privilege escalation prevention
  - Test tool policy enforcement
  - Test audit logging
  - Document security model

  **Must NOT do**:
  - Don't skip security testing
  - Don't assume security "just works"

  **Recommended Agent Profile**:
  - **Category**: `deep` - security audit
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after T10, T12-15)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1-F4
  - **Blocked By**: T10, T12, T13, T14, T15

  **References**:
  - `src/services/security.ts` (from T10)
  - `src/agents/tools/tool-policy-pipeline.ts`
  - `examples/` - Test subjects

  **Acceptance Criteria**:
  - [ ] Privilege escalation tests pass
  - [ ] Tool policy enforcement verified
  - [ ] Audit logging verified
  - [ ] Security documentation complete

  **QA Scenarios**:

  ```
  Scenario: Run security audit
    Tool: Bash
    Steps:
      1. Run `bun test src/services/security.test.ts`
      2. Run manual security check: `serviceclaw service security-check`
      3. Review audit logs
    Expected Result: All security tests pass
    Evidence: .sisyphus/evidence/task-20-security-audit.txt
  ```

  **Commit**: YES
  - Message: `security: Service security audit and hardening`
  - Files: `src/services/security.test.ts`, `docs/services/security.md`

---

## Final Verification Wave (MANDATORY - after ALL implementation tasks)

> **4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.**

- [x] **F1. Plan Compliance Audit** — `oracle`

  **What to do**:
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command, check tests). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.

  **Acceptance Criteria**:
  - [ ] All "Must Have" items implemented
  - [ ] No "Must NOT Have" items found in code
  - [ ] All evidence files present
  - [ ] Example Services work correctly

  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

---

- [x] **F2. Code Quality Review** — `unspecified-high`

  **What to do**:
  Run `tsc --noEmit` + `pnpm check` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] Linting passes
  - [ ] All tests pass
  - [ ] No critical code quality issues

  **Output**: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

---

- [x] **F3. Real Manual QA** — `unspecified-high`

  **What to do**:
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.

  **Acceptance Criteria**:
  - [ ] All QA scenarios pass
  - [ ] Integration tests pass
  - [ ] Edge cases handled correctly

  **Output**: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

---

- [x] **F4. Scope Fidelity Check** — `deep`

  **What to do**:
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.

  **Acceptance Criteria**:
  - [ ] All tasks compliant with spec
  - [ ] No scope creep detected
  - [ ] No cross-task contamination

  **Output**: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

**Atomic commits by wave**:

- Wave 1 (Docs): `docs: Service examples, trigger audit, extension patterns, architecture`
- Wave 2 (Core): `feat: Service schema, lifecycle, registry`
- Wave 3 (Integration): `feat: Service CLI, triggers, security, error handling`
- Wave 4 (Examples): `feat: 4 example Services + config wizard + documentation`
- Wave 5 (Quality): `test: Integration tests, performance, security audit`
- Wave FINAL: `review: Final verification and fixes`

**Per-task commits**:

- Use Conventional Commits format: `type(scope): description`
- Include test file in same commit as implementation
- Run tests before commit: `bun test <pattern>`

---

## Success Criteria

### Verification Commands

```bash
# Type check
pnpm tsgo

# Lint
pnpm check

# Run all tests
bun test src/services/

# Test example Service
serviceclaw service install examples/daily-briefing
serviceclaw service enable daily-briefing
serviceclaw service status daily-briefing
serviceclaw service trigger daily-briefing
serviceclaw service remove daily-briefing

# Performance benchmark
bun test src/services/performance.test.ts

# Security audit
bun test src/services/security.test.ts
```

### Final Checklist

- [ ] All "Must Have" present and working
- [ ] All "Must NOT Have" absent from code
- [ ] All 4 example Services pass lifecycle tests
- [ ] Performance criteria met (install <30s, startup <5s)
- [ ] Security audit passed
- [ ] All F1-F4 reviews APPROVE
- [ ] Documentation complete and reviewed

---

## Key Decisions Made

### Architecture Decisions

1. **Services extend existing infrastructure** - NOT a parallel architecture
2. **Reuse CronService** - Don't build new scheduler
3. **Atomic installation with rollback** - No partial state on failure
4. **Capability-based security** - Declarations in manifest, user confirmation
5. **No custom UI frameworks** - Extend existing Control UI

### Scope Boundaries

**IN MVP**:

- Service manifest and validation
- Lifecycle management
- Cron/webhook/message triggers
- 3 example Services
- CLI commands
- Security model

**OUT OF MVP**:

- Service marketplace/registry
- Service-to-Service dependencies
- Custom UI components
- Hot-reload
- Auto-updates

---

## Risks and Mitigations

| Risk                 | Likelihood | Impact | Mitigation                                                      |
| -------------------- | ---------- | ------ | --------------------------------------------------------------- |
| Scope creep          | High       | High   | Strict guardrails, "Must NOT" list                              |
| Security issues      | Medium     | High   | Capability declarations, audit logging, tool policy enforcement |
| Dependency conflicts | Medium     | Medium | Atomic installation, version constraints                        |
| Resource leaks       | Medium     | Medium | Cleanup verification, resource tracking                         |
| Performance issues   | Low        | Medium | Performance benchmarks, <30s install target                     |

---

## Notes for Executor

1. **Follow the waves** - Don't skip ahead. Each wave builds on previous.
2. **Test first** - Write tests before implementation (TDD).
3. **Don't reinvent** - Use existing patterns from `src/cron/`, `src/plugins/`, `src/agents/skills/`.
4. **Security first** - Never bypass tool policy. Always get user confirmation for privileged operations.
5. **Document as you go** - Don't leave docs for the end.
6. **Commit often** - Small, atomic commits with clear messages.
7. **Evidence matters** - Capture evidence for every QA scenario.

---

_Plan generated by Prometheus. Consult Metis for gap analysis. Ready for execution via `/start-work service-implementation`._
