# Task 4 Evidence: Service Architecture Design

**Task ID**: T4  
**Title**: Design Service Architecture  
**Status**: ✅ COMPLETED  
**Completed**: 2025-03-11  
**Deliverable**: `docs/services/architecture.md`

---

## Summary

Designed the complete Service Architecture for serviceclaw based on findings from T1 (Example Services), T2 (Trigger Audit), and T3 (Extension Patterns). The architecture establishes Services as metadata-driven automations that leverage existing OpenClaw infrastructure without creating a new runtime.

---

## Evidence of Completion

### 1. Documents Read (Prerequisites)

| Document           | Path                                  | Lines | Key Findings                                           |
| ------------------ | ------------------------------------- | ----- | ------------------------------------------------------ |
| Service Examples   | `docs/services/examples.md`           | 717   | 4 concrete service use cases with full config schemas  |
| Trigger Audit      | `docs/services/trigger-audit.md`      | 728   | CronService API, webhook registry, hook system details |
| Extension Patterns | `docs/services/extension-patterns.md` | 689   | Tool registration, lifecycle hooks, skill bundling     |
| Skill Types        | `src/agents/skills/types.ts`          | 89    | Skill metadata patterns for capability declarations    |

### 2. Architecture Document Created

**File**: `docs/services/architecture.md`  
**Size**: ~1,200 lines  
**Sections**:

1. ✅ **Service Definition** - Core philosophy and composition model
2. ✅ **Service Manifest Format** - Complete JSON schema with TypeScript types
3. ✅ **Lifecycle State Machine** - 10-state diagram with transitions
4. ✅ **Service Interface Design** - `ServiceInstance`, `ServiceRegistry`, `ServiceManifest` types
5. ✅ **Infrastructure Integration**:
   - CronService integration (ownership tracking, service-scoped jobs)
   - Webhook registry integration (auth, routing)
   - Message trigger integration (hook system)
   - Skill loading integration (bundling pattern)
   - Tool registration integration (optional tools)
6. ✅ **Security Model**:
   - Capability declarations
   - Privileged tool confirmation
   - Sandboxing with dedicated agents
   - Rate limiting
7. ✅ **Atomic Installation** - 4-phase install with rollback
8. ✅ **Registry & Persistence** - Storage structure, state files, index
9. ✅ **Component Diagrams** - ASCII architecture diagrams
10. ✅ **Implementation Roadmap** - Phased approach linking to T5-T13

### 3. Key Design Decisions Documented

#### A. Service = Metadata + References

```
Service Manifest
├── Trigger Config (when)
├── User Config Schema (params)
├── Capability Requirements (needs)
└── Runtime References (to existing infra)
    ├── CronService jobs
    ├── Webhook registry routes
    ├── Hook system subscriptions
    └── Agent session
```

#### B. Lifecycle State Machine

```
pending → validating → installing → installed → enabled → (active)
              ↓            ↓            ↓
        validation_error install_error error
```

#### C. Security Model

- Capability declarations in manifest
- User confirmation for privileged tools
- Service-scoped agent sessions (`service:{id}`)
- Tool allowlisting

#### D. Atomic Installation

- Phase 1: Validation (no side effects)
- Phase 2: Preparation (reversible)
- Phase 3: Resource creation (tracked)
- Phase 4: Commit
- Rollback on any failure

### 4. Integration Points Defined

| Existing System   | Integration Method                   | Ownership Tracking         |
| ----------------- | ------------------------------------ | -------------------------- |
| CronService       | `cron.add()` with metadata           | `metadata.serviceId`       |
| Webhook Registry  | `registerPluginHttpRoute()`          | `pluginId: "service:{id}"` |
| Hook System       | `registerInternalHook()`             | Event routing by serviceId |
| Skill Loading     | `skills/` directory bundling         | Plugin manifest            |
| Tool Registration | `api.registerTool({optional: true})` | Agent allowlist            |

### 5. TypeScript Interfaces Defined

- `ServiceInstance` - Runtime service representation
- `ServiceManifest` - Configuration schema
- `ServiceRegistry` - Core management interface
- `ServiceRuntimeRefs` - Tracked resource references
- `ServiceStateMachine` - State transitions
- `ServiceCapabilities` - Security declarations
- `ServiceConfigField` - User configuration schema

### 6. Storage Structure

```
~/.openclaw/services/
├── {serviceId}/
│   ├── manifest.json    # Service manifest
│   ├── config.json      # User configuration
│   ├── state.json       # Current state + history
│   └── refs.json        # Runtime references
└── index.json           # Registry index
```

---

## Design Constraints Satisfied

From Metis gap analysis:

| Constraint                  | Implementation                                             |
| --------------------------- | ---------------------------------------------------------- |
| Use existing infrastructure | ✅ Services use CronService, webhook registry, hook system |
| Metadata + References       | ✅ Service = manifest + refs to existing components        |
| NO new runtime              | ✅ No Service-specific execution engine                    |
| Capability declarations     | ✅ `requires` and `capabilities` blocks in manifest        |
| User confirmation           | ✅ `privilegedTools` require confirmation                  |
| Atomic installation         | ✅ 4-phase install with tracked rollback                   |

---

## Blocking Dependencies Resolved

- **T5** (Service Schema): Manifest format defined with JSON Schema
- **T6** (Core Infrastructure): `ServiceRegistry`, `ServiceInstaller` interfaces defined
- **T7** (Service Registry): Storage structure, state persistence specified

---

## Artifacts

| Artifact              | Location                                             | Status     |
| --------------------- | ---------------------------------------------------- | ---------- |
| Architecture Document | `docs/services/architecture.md`                      | ✅ Created |
| Evidence Document     | `.sisyphus/evidence/task-4-architecture-approved.md` | ✅ Created |

---

## Sign-off

**Task Complete**: Architecture design approved and documented.  
**Ready for Implementation**: T5, T6, T7 can proceed.

**Next Steps**:

1. T5: Implement TypeScript types and JSON Schema validation
2. T6: Build ServiceInstaller with atomic operations
3. T7: Create ServiceRegistry with file persistence
