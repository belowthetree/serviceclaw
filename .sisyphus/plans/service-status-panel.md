# Service Status Panel - Control UI

## TL;DR

> **Quick Summary**: Create a new independent Service Status view in the Control Panel that displays currently installed services with their states (enabled, disabled, error, etc.) and allows users to enable or disable services.
>
> **Deliverables**:
>
> - New WebSocket methods: `services.status`, `services.enable`, `services.disable`
> - New UI view: `services-status.ts` (function-based Lit component)
> - New controller: `services-status.ts` (data fetching and state management)
> - Protocol schemas for type-safe WebSocket communication
> - Navigation integration (new tab alongside existing "Services" config wizard)
> - Playwright E2E tests with specific selectors
>
> **Estimated Effort**: Medium (2-3 days)
> **Parallel Execution**: YES - 3 waves (backend → controller → UI)
> **Critical Path**: Backend handlers → Protocol schemas → Controller → View → Navigation

---

## Context

### Original Request

用户希望在控制面板的 service 面板展示当前服务信息，支持查看服务状态和启用/禁用操作。

### Interview Summary

**Key Discussions**:

- **View Strategy**: Create a NEW independent view (not modifying existing `services.ts`)
- **Data Loading**: Load once on page load (no real-time updates)
- **Actions**: Support enable and disable only (no install/remove/configure)
- **Navigation**: Coexist with existing "Services" config wizard (to be clarified as separate tabs)

**Research Findings**:

- Existing `services.ts` view is UI-only with hardcoded example data and a config wizard
- ServiceRegistry in `src/services/registry.ts` provides `list()`, `enable()`, `disable()` methods
- 11 service states defined: enabled, disabled, error, pending, validating, installing, installed, validation_error, install_error, uninstalling
- Gateway protocol uses WebSocket with camelCase dot notation (e.g., `services.status`)
- UI pattern: Function-based views with separate controllers for data fetching

### Metis Review

**Identified Gaps** (addressed in plan):

- **Navigation conflict**: Resolved - new view as separate tab "Service Status" alongside existing "Service Config"
- **Authorization**: Documented as TODO for MVP - no role checks initially
- **State transitions**: Handled with loading states and optimistic UI
- **Error handling**: Defined per-service inline errors and global error banner
- **Performance**: Use lightweight `ServiceIndexEntry` for list, full `ServiceInstance` only for details

---

## Work Objectives

### Core Objective

Create a new Service Status panel in the Control UI that displays all installed services with their current states, execution statistics, and timing information, allowing users to enable or disable services directly from the UI.

### Concrete Deliverables

- `src/gateway/server-methods/services.ts` - WebSocket handlers for status, enable, disable
- `src/gateway/protocol/schema/services.ts` - TypeBox schemas for request/response types
- `ui/src/ui/controllers/services-status.ts` - Controller for data fetching and actions
- `ui/src/ui/views/services-status.ts` - Lit view component for rendering service list
- `ui/src/ui/navigation.ts` - Add "service-status" tab (update: rename existing to "service-config")
- `ui/src/ui/app.ts` & `app-render.ts` - Integrate new view into app state and rendering
- `ui/src/ui/types.ts` - Add ServiceStatus-related type definitions

### Definition of Done

- [ ] User can navigate to "Service Status" tab and see list of all installed services
- [ ] Each service displays: name, state badge, trigger type, last updated time
- [ ] Services in "disabled" state show "Enable" button
- [ ] Services in "enabled" state show "Disable" button
- [ ] Clicking enable/disable triggers action and updates UI on success
- [ ] Errors display inline per service or in global banner
- [ ] Playwright tests verify rendering and actions with data-testid selectors
- [ ] All TypeScript compiles without errors (`pnpm tsgo`)

### Must Have

- Display service list with id, name, state, triggerType, category, updatedAt
- Show execution stats (totalRuns, successfulRuns, failedRuns) where available
- Show timing info (createdAt, lastRunAt, nextRunAt) where available
- Enable action for services in "disabled" state
- Disable action for services in "enabled" state
- Loading states during actions
- Error handling for failed actions
- Responsive design following existing patterns

### Must NOT Have (Guardrails)

- MUST NOT: Modify existing `ui/src/ui/views/services.ts` (config wizard stays separate)
- MUST NOT: Add real-time WebSocket subscriptions (out of scope)
- MUST NOT: Support service installation/removal from this view
- MUST NOT: Support bulk enable/disable operations (single service only)
- MUST NOT: Support service configuration editing (read-only for config)
- MUST NOT: Add pagination or virtual scrolling (defer to v2 if needed)
- MUST NOT: Require authorization/role checks for MVP (document as TODO)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES - Vitest for unit tests, Playwright for E2E
- **Automated tests**: TDD approach - tests written before implementation
- **Framework**: bun test / vitest for unit, Playwright for E2E
- **TDD Flow**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **API/Backend**: Use Bash (curl/WebSocket client) — Send requests, assert status + response fields
- **Unit Tests**: Use Bun test runner — Run tests, assert pass/fail

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - Backend Foundation):
├── Task 1: Create WebSocket handlers (services.status, services.enable, services.disable)
├── Task 2: Create protocol schemas (TypeBox types)
├── Task 3: Register handlers in Gateway
└── Task 4: Write unit tests for handlers

Wave 2 (After Wave 1 - Frontend Controller):
├── Task 5: Create UI types for ServiceStatus
├── Task 6: Create services-status controller
├── Task 7: Write controller unit tests
└── Task 8: Add WebSocket client methods

Wave 3 (After Wave 2 - UI View & Integration):
├── Task 9: Create services-status view component
├── Task 10: Add navigation tab
├── Task 11: Integrate into app state
├── Task 12: Integrate into app rendering
└── Task 13: Write Playwright E2E tests

Wave 4 (After Wave 3 - Verification):
├── Task 14: Run full test suite
├── Task 15: TypeScript check and lint
└── Task 16: Manual QA verification

Wave FINAL (After ALL tasks - Independent Review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: E2E QA verification (unspecified-high + playwright)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 2 → Task 5 → Task 6 → Task 9 → Task 10-12 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Waves 1 & 2)
```

### Dependency Matrix

- **1-4**: — — 5-8, 1
- **5-8**: 1-4 — 9, 2
- **9**: 5-8 — 10-12, 3
- **10-12**: 9 — 13, 4
- **13**: 10-12 — 14, 5
- **14-16**: 13 — F1-F4, 6
- **F1-F4**: 14-16 — (end), 7

### Agent Dispatch Summary

- **1**: **4** - T1-T4 → `quick` (handler implementation + tests)
- **2**: **4** - T5-T8 → `quick` (controller + types)
- **3**: **5** - T9-T13 → `visual-engineering` (Lit UI components)
- **4**: **3** - T14-T16 → `unspecified-high` (verification)
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Create WebSocket handler for services.status

  **What to do**:
  - Create `src/gateway/server-methods/services.ts`
  - Implement `services.status` handler that calls `ServiceRegistry.list()`
  - Return array of service summaries with id, name, state, triggerType, category, updatedAt
  - Handle errors: registry unavailable, permission denied
  - Write unit tests in `src/gateway/server-methods/services.test.ts`

  **Must NOT do**:
  - MUST NOT: Return full ServiceInstance data (use lightweight ServiceIndexEntry)
  - MUST NOT: Add pagination or filtering (out of scope)
  - MUST NOT: Add real-time subscription support

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Backend handler implementation following existing patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-4)
  - **Blocks**: Task 6 (controller needs this handler)
  - **Blocked By**: None

  **References**:
  - Pattern: `src/gateway/server-methods/health.ts:10-36` - handler structure
  - Registry API: `src/services/registry.ts:817-841` - list() method
  - Service types: `src/services/registry.ts:109-116` - ServiceIndexEntry

  **Acceptance Criteria**:
  - [ ] Handler file created with `services.status` method
  - [ ] Unit test: returns array of services when registry has data
  - [ ] Unit test: returns empty array when no services installed
  - [ ] Unit test: handles registry errors gracefully

  **QA Scenarios**:

  ```
  Scenario: Get services list successfully
    Tool: Bun test
    Preconditions: ServiceRegistry has 2 services: "svc-1" (enabled), "svc-2" (disabled)
    Steps:
      1. Import handler from services.ts
      2. Call handler with mock context
      3. Assert response.ok === true
      4. Assert response.payload.services is array with length 2
      5. Assert first service has id, name, state, triggerType, category, updatedAt
    Expected Result: Returns service list with all required fields
    Evidence: .sisyphus/evidence/task-1-services-status-pass.png
  ```

  **Commit**: YES
  - Message: `feat(gateway): add services.status WebSocket handler`
  - Files: `src/gateway/server-methods/services.ts`, `src/gateway/server-methods/services.test.ts`
  - Pre-commit: `bun test src/gateway/server-methods/services.test.ts`

---

- [x] 2. Create WebSocket handlers for services.enable and services.disable

  **What to do**:
  - Add `services.enable` handler that accepts `{ serviceId: string }`
  - Add `services.disable` handler that accepts `{ serviceId: string }`
  - Call `ServiceRegistry.enable(serviceId)` / `disable(serviceId)`
  - Return success confirmation or error details
  - Handle errors: service not found, invalid state transition
  - Write unit tests

  **Must NOT do**:
  - MUST NOT: Add bulk operations (single service only)
  - MUST NOT: Add force/override flags
  - MUST NOT: Implement authorization checks (document as TODO)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 6 (controller needs these handlers)
  - **Blocked By**: None

  **References**:
  - Registry API: `src/services/registry.ts:873-890` - enable/disable methods
  - Error handling: `src/services/errors.ts` - ServiceError types

  **Acceptance Criteria**:
  - [ ] Handler methods created for enable and disable
  - [ ] Unit test: enable transitions service from disabled to enabled
  - [ ] Unit test: disable transitions service from enabled to disabled
  - [ ] Unit test: handles service not found error
  - [ ] Unit test: handles invalid state transition error

  **QA Scenarios**:

  ```
  Scenario: Enable disabled service
    Tool: Bun test
    Preconditions: Service "svc-1" exists in "disabled" state
    Steps:
      1. Call services.enable handler with { serviceId: "svc-1" }
      2. Assert response.ok === true
      3. Assert registry.enable was called with "svc-1"
    Expected Result: Service enabled successfully
    Evidence: .sisyphus/evidence/task-2-enable-pass.txt
  ```

  **Commit**: YES (grouped with Task 1)

---

- [x] 3. Create protocol schemas for services methods

  **What to do**:
  - Create `src/gateway/protocol/schema/services.ts`
  - Define TypeBox schemas:
    - `ServicesStatusRequestSchema` (empty params)
    - `ServicesStatusResponseSchema` (array of ServiceSummary)
    - `ServicesEnableRequestSchema` ({ serviceId: string })
    - `ServicesEnableResponseSchema` (success boolean)
    - Same for disable
  - Export TypeScript types from schemas

  **Must NOT do**:
  - MUST NOT: Define schemas inline in handlers
  - MUST NOT: Skip type exports

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 1, Task 2 (handlers need these schemas)
  - **Blocked By**: None (can start immediately)

  **References**:
  - Pattern: `src/gateway/protocol/schema/health.ts` - schema structure
  - TypeBox: Follow existing patterns using `Type.Object`, `Type.Array`, `Type.String`

  **Acceptance Criteria**:
  - [ ] Schema file created with all request/response types
  - [ ] Schemas compile without TypeScript errors
  - [ ] Types exported for use in handlers and UI

  **QA Scenarios**:

  ```
  Scenario: Schema validation passes
    Tool: Bun test
    Preconditions: Schemas defined
    Steps:
      1. Import schemas from services.ts
      2. Validate sample data against ServicesStatusResponseSchema
      3. Assert validation passes for valid data
      4. Assert validation fails for invalid data
    Expected Result: Schemas correctly validate data shapes
    Evidence: .sisyphus/evidence/task-3-schema-validation.txt
  ```

  **Commit**: YES (grouped with Task 1)

---

- [x] 4. Register service handlers in Gateway

  **What to do**:
  - Update `src/gateway/server-methods.ts`
  - Import and add service handlers to `coreGatewayHandlers` object
  - Map method names: `services.status`, `services.enable`, `services.disable`
  - Verify handlers are reachable via WebSocket

  **Must NOT do**:
  - MUST NOT: Change handler registration pattern
  - MUST NOT: Skip validation registration

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (depends on Tasks 1-3)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 6 (controller needs registered handlers)
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - Registration pattern: `src/gateway/server-methods.ts:68-98`
  - Handler map: `src/gateway/server-methods.ts:120-160`

  **Acceptance Criteria**:
  - [ ] Handlers registered in coreGatewayHandlers
  - [ ] Gateway starts without errors
  - [ ] WebSocket requests to services.\* methods are routed correctly

  **QA Scenarios**:

  ```
  Scenario: WebSocket routes to handler
    Tool: Bun test (integration)
    Preconditions: Gateway started with registered handlers
    Steps:
      1. Create WebSocket connection to Gateway
      2. Send request: { type: "req", method: "services.status", params: {} }
      3. Assert response received within 1000ms
      4. Assert response.id matches request.id
    Expected Result: Request routed to handler and response returned
    Evidence: .sisyphus/evidence/task-4-routing.txt
  ```

  **Commit**: YES (grouped with Task 1)

---

- [x] 5. Add ServiceStatus types to UI types

  **What to do**:
  - Update `ui/src/ui/types.ts` (or create types file)
  - Add TypeScript interfaces:
    - `ServiceSummary` (id, name, state, triggerType, category, updatedAt)
    - `ServiceExecutionStats` (totalRuns, successfulRuns, failedRuns, lastError)
    - `ServicesStatusState` (loading, services, error, selectedServiceId)
  - Follow existing type patterns in codebase

  **Must NOT do**:
  - MUST NOT: Define types inline in components
  - MUST NOT: Use `any` types

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6 (controller needs types)
  - **Blocked By**: Task 4 (to understand service data shape)

  **References**:
  - Pattern: `ui/src/ui/types.ts` or similar existing type files
  - Service types: `src/services/registry.ts:109-116` - ServiceIndexEntry

  **Acceptance Criteria**:
  - [ ] Type definitions added
  - [ ] Types compile without errors
  - [ ] Types match backend response structure

  **QA Scenarios**:

  ```
  Scenario: Types compile correctly
    Tool: pnpm tsgo
    Preconditions: Types defined in types.ts
    Steps:
      1. Run TypeScript compiler
      2. Assert no type errors in new type definitions
    Expected Result: Clean TypeScript compilation
    Evidence: .sisyphus/evidence/task-5-types-compile.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add ServiceStatus type definitions`
  - Files: `ui/src/ui/types.ts`
  - Pre-commit: `pnpm tsgo`

---

- [x] 6. Create services-status controller

  **What to do**:
  - Create `ui/src/ui/controllers/services-status.ts`
  - Implement controller class with:
    - `loadServices()` - fetch services list via WebSocket
    - `enableService(serviceId)` - call services.enable
    - `disableService(serviceId)` - call services.disable
    - State management: loading, services[], error
  - Follow pattern from `skills.ts` controller
  - Write unit tests

  **Must NOT do**:
  - MUST NOT: Put data fetching logic in view component
  - MUST NOT: Use global state (keep controller-local)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 5)
  - **Blocks**: Task 9 (view needs controller)
  - **Blocked By**: Tasks 4, 5 (handlers registered, types defined)

  **References**:
  - Pattern: `ui/src/ui/controllers/skills.ts:46-68` - controller structure
  - WebSocket client: `ui/src/ui/gateway.ts` - request method

  **Acceptance Criteria**:
  - [ ] Controller class created with loadServices method
  - [ ] Controller manages loading, services, error state
  - [ ] enableService and disableService methods implemented
  - [ ] Unit tests for all methods

  **QA Scenarios**:

  ```
  Scenario: Controller loads services successfully
    Tool: Bun test
    Preconditions: Mock WebSocket client returns 2 services
    Steps:
      1. Instantiate controller with mock gateway
      2. Call loadServices()
      3. Assert loading state transitions: false → true → false
      4. Assert services array populated with 2 items
      5. Assert error is null
    Expected Result: Controller fetches and stores services
    Evidence: .sisyphus/evidence/task-6-controller-load.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): add services-status controller`
  - Files: `ui/src/ui/controllers/services-status.ts`, `services-status.test.ts`
  - Pre-commit: `bun test ui/src/ui/controllers/services-status.test.ts`

---

- [x] 7. Write controller unit tests

  **What to do**:
  - Create comprehensive unit tests for services-status controller
  - Test cases:
    - Load services success
    - Load services error
    - Enable service success
    - Enable service error (service not found)
    - Disable service success
    - Disable service error (invalid state)
    - Loading state management
  - Mock WebSocket client and ServiceRegistry

  **Must NOT do**:
  - MUST NOT: Skip error case testing
  - MUST NOT: Use real WebSocket connections in unit tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (depends on Task 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: None (testing task)
  - **Blocked By**: Task 6

  **References**:
  - Pattern: `ui/src/ui/controllers/skills.test.ts` - test patterns
  - Mocking: Use Vitest mocks for WebSocket client

  **Acceptance Criteria**:
  - [ ] All test cases pass
  - [ ] Code coverage >80% for controller
  - [ ] Tests use mocked dependencies

  **QA Scenarios**:

  ```
  Scenario: All controller tests pass
    Tool: Bun test
    Preconditions: Controller implemented
    Steps:
      1. Run controller test suite
      2. Assert all tests pass
      3. Assert coverage report shows >80% for controller file
    Expected Result: Green test suite
    Evidence: .sisyphus/evidence/task-7-controller-tests.txt
  ```

  **Commit**: YES (grouped with Task 6)

---

- [x] 8. Add WebSocket client methods

  **What to do**:
  - Update `ui/src/ui/gateway.ts` (or create extension)
  - Add typed methods:
    - `getServicesStatus(): Promise<ServiceSummary[]>`
    - `enableService(serviceId: string): Promise<void>`
    - `disableService(serviceId: string): Promise<void>`
  - Use existing `request()` method internally
  - Add proper error handling

  **Must NOT do**:
  - MUST NOT: Bypass existing WebSocket client
  - MUST NOT: Skip type safety

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6 (controller uses these methods)
  - **Blocked By**: Task 4 (to know method names)

  **References**:
  - Pattern: `ui/src/ui/gateway.ts` - existing request methods

  **Acceptance Criteria**:
  - [ ] WebSocket client methods added
  - [ ] Methods use correct WebSocket method names
  - [ ] Proper TypeScript return types

  **QA Scenarios**:

  ```
  Scenario: WebSocket methods work correctly
    Tool: Bun test (integration)
    Preconditions: Gateway running with handlers
    Steps:
      1. Call gateway.getServicesStatus()
      2. Assert returns array of ServiceSummary
      3. Call gateway.enableService("test-svc")
      4. Assert no error thrown
    Expected Result: Methods communicate with backend
    Evidence: .sisyphus/evidence/task-8-websocket-methods.txt
  ```

  **Commit**: YES (grouped with Task 6)

---

- [x] 9. Create services-status view component

  **What to do**:
  - Create `ui/src/ui/views/services-status.ts`
  - Implement function-based view (following existing pattern):
    - `renderServicesStatus(props: ServicesStatusProps): TemplateResult`
    - Props: services, loading, error, onEnable, onDisable
  - Render service list with:
    - Service name, state badge, trigger type
    - Enable/Disable buttons (conditional on state)
    - Loading spinner during actions
    - Error display
  - Use existing CSS classes for styling

  **Must NOT do**:
  - MUST NOT: Use class-based component (follow function pattern)
  - MUST NOT: Put data fetching in view
  - MUST NOT: Skip accessibility (add aria-labels)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []
  - Reason: Lit HTML template rendering with CSS styling

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 10-12 (integration needs view)
  - **Blocked By**: Tasks 5, 6 (types and controller ready)

  **References**:
  - Pattern: `ui/src/ui/views/services.ts:323-368` - function-based view
  - Status chips: `ui/src/ui/views/skills-shared.ts:24-52` - badge styling
  - Table/list: `ui/src/ui/views/agents.ts:200-250` - list rendering

  **Acceptance Criteria**:
  - [ ] View function created with proper props interface
  - [ ] Renders service list with all required fields
  - [ ] Shows Enable button only for disabled services
  - [ ] Shows Disable button only for enabled services
  - [ ] Displays loading state
  - [ ] Displays error state
  - [ ] Uses data-testid attributes for testing

  **QA Scenarios**:

  ```
  Scenario: View renders service list
    Tool: Playwright
    Preconditions: Controller provides 2 services: 1 enabled, 1 disabled
    Steps:
      1. Render view with test data
      2. Screenshot: [data-testid="service-list"] exists
      3. Assert: 2 rows with [data-testid^="service-row-"]
      4. Assert: Enabled service has "Disable" button
      5. Assert: Disabled service has "Enable" button
    Expected Result: Service list displays correctly with action buttons
    Evidence: .sisyphus/evidence/task-9-view-render.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add services-status view component`
  - Files: `ui/src/ui/views/services-status.ts`
  - Pre-commit: `pnpm build` (verify no TypeScript errors)

---

- [x] 10. Add navigation tab for service status

  **What to do**:
  - Update `ui/src/ui/navigation.ts`:
    - Add "service-status" to `Tab` union type
    - Add to `TAB_GROUPS` under "agent" group
    - Add path mapping in `TAB_PATHS`
    - Add icon mapping (use `radio` or `activity` icon)
  - Rename existing "services" tab to "service-config" for clarity

  **Must NOT do**:
  - MUST NOT: Remove existing services tab
  - MUST NOT: Change other navigation items

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 11 (app needs navigation)
  - **Blocked By**: None

  **References**:
  - Pattern: `ui/src/ui/navigation.ts:14-28` - Tab type and TAB_GROUPS
  - Icons: `ui/src/ui/navigation.ts:128-161` - iconForTab function

  **Acceptance Criteria**:
  - [ ] "service-status" tab added to navigation
  - [ ] Existing "services" renamed to "service-config"
  - [ ] Both tabs appear in "agent" group
  - [ ] Icons assigned appropriately

  **QA Scenarios**:

  ```
  Scenario: Navigation shows both service tabs
    Tool: Playwright
    Preconditions: Control UI loaded
    Steps:
      1. Navigate to Control UI
      2. Click "Agent" tab group
      3. Assert: "Service Status" tab visible
      4. Assert: "Service Config" tab visible
      5. Click "Service Status"
      6. Assert: URL changes to /service-status
    Expected Result: Both tabs accessible
    Evidence: .sisyphus/evidence/task-10-navigation.png
  ```

  **Commit**: YES (grouped with Task 9)

---

- [ ] 11. Integrate view into app state

  **What to do**:
  - Update `ui/src/ui/app.ts`:
    - Import services-status controller
    - Add controller instance to app state
    - Initialize controller on app startup
    - Add methods: `loadServicesStatus()`, `enableService()`, `disableService()`
  - Follow pattern from skills/agents integration

  **Must NOT do**:
  - MUST NOT: Skip controller initialization
  - MUST NOT: Mix controller logic with view rendering

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (depends on Tasks 6, 10)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 12 (rendering needs app state)
  - **Blocked By**: Tasks 6, 10

  **References**:
  - Pattern: `ui/src/ui/app.ts:300-400` - controller initialization
  - Skills integration: `ui/src/ui/app.ts:150-200` - similar pattern

  **Acceptance Criteria**:
  - [ ] Controller instantiated in app
  - [ ] App methods delegate to controller
  - [ ] State updates trigger re-renders

  **QA Scenarios**:

  ```
  Scenario: App state integrates controller
    Tool: Bun test
    Preconditions: App.ts updated
    Steps:
      1. Create app instance
      2. Assert servicesStatusController exists
      3. Call app.loadServicesStatus()
      4. Assert controller.loadServices() was called
    Expected Result: App delegates to controller
    Evidence: .sisyphus/evidence/task-11-app-state.txt
  ```

  **Commit**: YES (grouped with Task 9)

---

- [ ] 12. Integrate view into app rendering

  **What to do**:
  - Update `ui/src/ui/app-render.ts`:
    - Import `renderServicesStatus` view
    - Add case in render function for "service-status" tab
    - Pass correct props from app state
    - Include view styles
  - Add styles to `app-styles.ts` if needed

  **Must NOT do**:
  - MUST NOT: Skip props passing
  - MUST NOT: Forget to include styles

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (depends on Tasks 9, 11)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 13 (E2E tests need full integration)
  - **Blocked By**: Tasks 9, 11

  **References**:
  - Pattern: `ui/src/ui/app-render.ts:955-970` - view rendering switch
  - Services view: `app-render.ts` - how services view is rendered

  **Acceptance Criteria**:
  - [ ] View renders when "service-status" tab active
  - [ ] Props correctly passed from app state
  - [ ] Styles included

  **QA Scenarios**:

  ```
  Scenario: Full integration renders correctly
    Tool: Playwright
    Preconditions: Gateway running, services installed
    Steps:
      1. Open Control UI
      2. Navigate to /service-status
      3. Assert: [data-testid="service-list"] visible within 5s
      4. Assert: Service rows render with correct data
    Expected Result: End-to-end integration works
    Evidence: .sisyphus/evidence/task-12-integration.png
  ```

  **Commit**: YES (grouped with Task 9)

---

- [ ] 13. Write Playwright E2E tests

  **What to do**:
  - Create `ui/e2e/services-status.spec.ts`
  - Test scenarios:
    - Page loads and displays service list
    - Service states display correctly
    - Enable button appears for disabled services
    - Disable button appears for enabled services
    - Clicking enable updates service state
    - Clicking disable updates service state
    - Error handling displays correctly
  - Use data-testid selectors

  **Must NOT do**:
  - MUST NOT: Use brittle selectors (class names, text content)
  - MUST NOT: Skip error scenario testing

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after integration)
  - **Blocks**: Task 14 (full test suite needs E2E)
  - **Blocked By**: Tasks 10, 11, 12 (full integration)

  **References**:
  - Pattern: `ui/e2e/skills.spec.ts` or similar E2E tests
  - Selectors: Use data-testid attributes from view

  **Acceptance Criteria**:
  - [ ] E2E test file created
  - [ ] All test scenarios pass
  - [ ] Screenshots captured for key states

  **QA Scenarios**:

  ```
  Scenario: E2E test passes
    Tool: Playwright
    Preconditions: Full stack running (Gateway + UI)
    Steps:
      1. Run Playwright test suite
      2. Assert all tests pass
      3. Review screenshots in test-results/
    Expected Result: Green E2E test suite
    Evidence: .sisyphus/evidence/task-13-e2e-results/
  ```

  **Commit**: YES
  - Message: `test(ui): add Playwright E2E tests for services-status`
  - Files: `ui/e2e/services-status.spec.ts`
  - Pre-commit: `pnpm test:e2e services-status`

---

- [ ] 14. Run full test suite

  **What to do**:
  - Run all unit tests: `bun test`
  - Run E2E tests: `pnpm test:e2e`
  - Fix any failing tests
  - Verify no regressions in existing tests

  **Must NOT do**:
  - MUST NOT: Skip failing tests
  - MUST NOT: Merge with failing CI

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 16
  - **Blocked By**: Tasks 7, 13 (all tests written)

  **Acceptance Criteria**:
  - [ ] All unit tests pass
  - [ ] All E2E tests pass
  - [ ] No regressions in existing tests

  **QA Scenarios**:

  ```
  Scenario: Full test suite passes
    Tool: Bun test + Playwright
    Preconditions: All implementation complete
    Steps:
      1. Run pnpm test
      2. Run pnpm test:e2e
      3. Assert 100% pass rate
    Expected Result: All green
    Evidence: .sisyphus/evidence/task-14-full-suite.txt
  ```

  **Commit**: NO (verification task)

---

- [ ] 15. TypeScript check and lint

  **What to do**:
  - Run TypeScript compiler: `pnpm tsgo`
  - Run linter: `pnpm check`
  - Fix any type errors or lint violations
  - Ensure no new warnings introduced

  **Must NOT do**:
  - MUST NOT: Suppress errors with @ts-ignore
  - MUST NOT: Skip strict type checking

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 16
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] Linter passes without violations
  - [ ] No new warnings

  **QA Scenarios**:

  ```
  Scenario: TypeScript and lint clean
    Tool: pnpm tsgo, pnpm check
    Preconditions: All code written
    Steps:
      1. Run pnpm tsgo
      2. Run pnpm check
      3. Assert exit code 0 for both
    Expected Result: Clean type check and lint
    Evidence: .sisyphus/evidence/task-15-ts-lint.txt
  ```

  **Commit**: NO (verification task)

---

- [ ] 16. Manual QA verification

  **What to do**:
  - Start Gateway: `pnpm gateway`
  - Open Control UI: `pnpm openclaw dashboard`
  - Navigate to Service Status tab
  - Verify:
    - Service list displays correctly
    - States show appropriate colors
    - Enable/disable buttons work
    - Errors display correctly
  - Take screenshots of key states

  **Must NOT do**:
  - MUST NOT: Skip manual verification
  - MUST NOT: Deploy without QA

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`playwright`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4 (final verification)
  - **Blocked By**: Tasks 14, 15

  **QA Scenarios**:

  ```
  Scenario: Manual QA passes
    Tool: Playwright (automated), manual verification
    Preconditions: Gateway and UI running
    Steps:
      1. Navigate to Service Status
      2. Verify service list displays
      3. Click Enable on disabled service
      4. Verify state updates to enabled
      5. Click Disable on enabled service
      6. Verify state updates to disabled
      7. Capture screenshots
    Expected Result: All functionality works end-to-end
    Evidence: .sisyphus/evidence/task-16-manual-qa/
  ```

  **Commit**: NO (verification task)

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **E2E QA Verification** — `unspecified-high` (+ `playwright` skill)
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

```
Commit 1: Backend WebSocket handlers + protocol schemas
  - src/gateway/server-methods/services.ts (new)
  - src/gateway/server-methods/services.test.ts (new)
  - src/gateway/protocol/schema/services.ts (new)
  - src/gateway/server-methods.ts (register handlers)

Commit 2: UI types and controller
  - ui/src/ui/types.ts (add ServiceStatus types)
  - ui/src/ui/controllers/services-status.ts (new)
  - ui/src/ui/controllers/services-status.test.ts (new)
  - ui/src/ui/gateway.ts (add WebSocket methods)

Commit 3: UI view component
  - ui/src/ui/views/services-status.ts (new)

Commit 4: Navigation and integration
  - ui/src/ui/navigation.ts (add service-status tab)
  - ui/src/ui/app.ts (integrate controller)
  - ui/src/ui/app-render.ts (render view)

Commit 5: E2E tests
  - ui/e2e/services-status.spec.ts (new)
```

---

## Success Criteria

### Verification Commands

```bash
# Backend tests
bun test src/gateway/server-methods/services.test.ts

# Controller tests
bun test ui/src/ui/controllers/services-status.test.ts

# Full test suite
pnpm test

# TypeScript check
pnpm tsgo

# Lint check
pnpm check

# E2E tests
pnpm test:e2e services-status

# Manual verification
openclaw dashboard
# Navigate to Service Status tab
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] WebSocket handlers respond correctly
- [ ] UI renders service list
- [ ] Enable/disable actions work
- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] Linter passes
- [ ] Evidence files captured
