# Task 1: Define 4 Example Services - Evidence Document

**Task ID:** Atlas Wave 1 - Task 1 (Service Examples)
**Completed:** March 11, 2026
**Document Location:** `docs/services/examples.md`

## Summary

Created comprehensive design documentation for 4 example Services that will guide the Service Concept MVP architecture. This is a **design phase** document only - no implementation was performed.

## What Was Delivered

### 1. Document Created: `docs/services/examples.md`

**Size:** ~700 lines of design documentation
**Format:** Markdown with YAML frontmatter (Mintlify-compatible)

### 2. Four Service Examples Defined

#### Service 1: Daily Briefing Service

- **Trigger:** Cron-based (8am daily)
- **Purpose:** Generates and delivers morning briefings with weather, calendar, news, tasks
- **Skills Used:** weather, summarize, gog (calendar), apple-reminders/things, slack/discord
- **Config Schema:** Complete JSON schema with weather location, news sources, calendars, task sources, delivery channel, format options
- **UI Description:** 6-step wizard (Welcome → Location → Content Selection → Delivery → Schedule → Preview)

#### Service 2: Webhook Receiver Service

- **Trigger:** Webhook-based (HTTP POST)
- **Purpose:** Receives webhooks from external services and processes through skills
- **Skills Used:** webhook (built-in), github, notion, slack/discord
- **Config Schema:** Hook name, secret/signature validation, source type, action rules (condition → action), rate limiting
- **UI Description:** 5-step wizard with visual workflow builder for actions

#### Service 3: Message Processor Service

- **Trigger:** Message-based (channel monitoring)
- **Purpose:** Watches channels for patterns, processes attachments/commands
- **Skills Used:** slack/discord, summarize, nano-pdf, openai-whisper, notion
- **Config Schema:** Watches (channels/DMs), Rules (match → process → respond), Commands (prefix), Rate limits
- **UI Description:** Visual rule builder with condition-action chains

#### Service 4: Data Dashboard Service

- **Trigger:** Web UI (HTTP endpoint)
- **Purpose:** Serves dashboard with real-time widgets
- **Skills Used:** canvas, weather, gog, apple-reminders/things, github
- **Config Schema:** Title, layout, theme, refresh interval, widgets array (with positions), access control
- **UI Description:** Widget gallery + drag-drop configuration

### 3. Configuration Schemas

Each Service includes:

- Complete `service.json` manifest example
- Config field definitions (type, description, default, required)
- Validation rules (enums, min/max, patterns)
- Secret handling for sensitive fields

### 4. UI Mockup Descriptions

For each Service:

- Wizard flow (step-by-step setup)
- Configuration panel layout
- Management dashboard view
- Key UI components described

### 5. Cross-Cutting Concerns

Document also includes:

- **Security considerations:** Capability gating, sandboxing, secrets, rate limiting, audit logging
- **Configuration validation:** JSON Schema validation approach
- **Error handling:** Retry policy, dead letter queue, notifications
- **Shared components:** Service Runner, Config Store, Scheduler, Webhook Router, etc.
- **Service Manifest Format:** Common schema for all Services
- **Service Storage:** Locations (`~/.openclaw/services/`, workspace, plugins)
- **Service Lifecycle:** Created → Validated → Enabled → Running → Paused → Deleted

## Design Decisions Made

1. **Services bundle skills, don't create them** - Each Service uses existing OpenClaw skills
2. **JSON Schema for config** - Declarative, type-safe configuration
3. **Required vs Optional skills** - Services declare both; required blocks startup, optional enables features
4. **Trigger types:** cron, webhook, message, web (UI), manual
5. **Security-first:** Capability requirements, secrets store, rate limiting
6. **User-friendly:** Wizard-based setup, sensible defaults

## Research Performed

### Files Read:

- `docs/tools/skills.md` - Skill structure, gating, metadata
- `src/cron/service.ts` - Cron service implementation
- `extensions/lobster/README.md` - Complex extension example
- `skills/weather/SKILL.md` - Example skill
- `skills/summarize/SKILL.md` - Example skill
- `skills/slack/SKILL.md` - Example skill

### Key Findings:

- Skills are AgentSkills-compatible with YAML frontmatter
- Skills can require binaries, env vars, or config via `metadata.openclaw.requires`
- Cron service supports add, update, remove, run, enqueue operations
- Extensions can add tools without core changes via plugin system
- Skills live in 3 places: bundled, managed (`~/.openclaw/skills`), workspace

## Validation Checklist

- [x] Document exists at `docs/services/examples.md`
- [x] All 4 Services have: purpose, trigger type, skills/tools list
- [x] Each Service has complete configuration schema
- [x] Each Service has UI mockup description
- [x] Example `service.json` manifests included for all 4 Services
- [x] Cross-cutting concerns documented (security, validation, errors)
- [x] Common Service manifest format defined
- [x] Service lifecycle and storage documented
- [x] Requirements are simple and MVP-appropriate
- [x] No implementation code was written (design only)

## Architecture Implications

Based on these examples, the Service runtime will need:

1. **Trigger Registry** - Manage different trigger types (cron, webhook, message, web)
2. **Config Store** - Persist and validate Service configurations
3. **Skill Resolver** - Check if required skills are available
4. **Execution Engine** - Run Service logic with proper context
5. **UI Components:**
   - Service wizard framework
   - Rule builder (condition-action chains)
   - Widget gallery and layout editor
   - Dashboard renderer
6. **Security Layer** - Capability checking, secret management, rate limiting

## Next Steps (Blocked Until Approved)

1. Get user approval on these Service examples
2. Proceed to Task 4: Architecture Design (defines how Services fit into OpenClaw)
3. Task 5: Service Manifest Schema (formalize the service.json format)
4. Task 8: User Stories (derive from these examples)

## Notes for Reviewer

- These are **MVP examples** - intentionally simple, can be extended later
- The Data Dashboard Service is the most complex example; may be deferred to post-MVP
- Webhook Receiver uses action rules that could be generalized for other Services
- All examples assume existing OpenClaw infrastructure (channels, skills, web UI)
- The "Message Processor" overlaps with some existing OpenClaw routing - need to clarify distinction
