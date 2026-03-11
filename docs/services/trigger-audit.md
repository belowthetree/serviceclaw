# Trigger Infrastructure Audit

> **Document Version**: 1.0  
> **Date**: 2025-03-11  
> **Scope**: Complete audit of all trigger mechanisms in the OpenClaw codebase  
> **Status**: Wave 1 - Foundation Research

---

## Executive Summary

This document provides a comprehensive audit of all existing trigger mechanisms in the OpenClaw codebase. It maps the cron system, webhook handlers, message triggers, and identifies extension points for Service trigger integration.

**Key Findings**:

- 4 major trigger categories identified
- Centralized `CronService` for scheduled triggers
- Plugin-based webhook routing system
- Event-driven hook system for message triggers
- Clear extension points for Service integration

---

## 1. Trigger Categories Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    OPENCLAW TRIGGER ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   CRON/      │  │   WEBHOOK    │  │   MESSAGE    │  │   SYSTEM    │ │
│  │  SCHEDULED   │  │   RECEIVERS  │  │   TRIGGERS   │  │   EVENTS    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                 │        │
│         ▼                 ▼                 ▼                 ▼        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                     CronService (src/cron/)                       │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │  • Job scheduling & execution                                     │ │
│  │  • Timer management                                               │ │
│  │  • State persistence                                              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                   Gateway Request Handlers                        │ │
│  │            (src/gateway/server-methods/*.ts)                      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│         │                                                             │
│         ▼                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                   Agent Execution Pipeline                        │ │
│  │          (src/auto-reply/, src/agents/pi-embedded/)               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Category 1: Cron/Scheduled Triggers

### 2.1 Core Files

| File                        | Purpose                                        | Lines |
| --------------------------- | ---------------------------------------------- | ----- |
| `src/cron/service.ts`       | Main CronService class - public API            | 60    |
| `src/cron/types.ts`         | Type definitions for jobs, schedules, delivery | 159   |
| `src/cron/types-shared.ts`  | Base CronJob type definition                   | 18    |
| `src/cron/service/state.ts` | CronService state management & deps            | 143   |
| `src/cron/service/ops.ts`   | Core operations (add, update, remove, run)     | 569   |
| `src/cron/service/jobs.ts`  | Job creation, scheduling, next-run computation | -     |
| `src/cron/service/timer.ts` | Timer management & job execution               | -     |
| `src/cron/service/store.ts` | Persistence layer for cron jobs                | -     |
| `src/cron/schedule.ts`      | Schedule parsing & next-run calculation        | -     |
| `src/cron/webhook-url.ts`   | Webhook URL validation                         | 22    |

### 2.2 CronService API

```typescript
// src/cron/service.ts
export class CronService {
  async start(); // Initialize and start scheduler
  stop(); // Stop scheduler
  async status(); // Get scheduler status
  async list(opts?); // List all jobs
  async listPage(opts?); // Paginated job listing
  async add(input: CronJobCreate); // Create new scheduled job
  async update(id, patch); // Modify existing job
  async remove(id); // Delete job
  async run(id, mode?); // Execute job immediately
  async enqueueRun(id, mode?); // Queue job for execution
  getJob(id); // Retrieve single job
  wake(opts); // Trigger wake event
}
```

### 2.3 Schedule Types

```typescript
// src/cron/types.ts
export type CronSchedule =
  | { kind: "at"; at: string } // One-time at specific time
  | { kind: "every"; everyMs: number; anchorMs?: number } // Interval-based
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number }; // Cron expression
```

### 2.4 Job Structure

```typescript
// Simplified from src/cron/types.ts & types-shared.ts
interface CronJob {
  id: string;
  agentId?: string; // Target agent
  sessionKey?: string; // Target session
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean; // One-shot jobs
  schedule: CronSchedule;
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payload: CronPayload; // What to execute
  delivery?: CronDelivery; // Where to send results
  failureAlert?: CronFailureAlert | false;
  state: CronJobState; // Runtime state
}

type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string /* ... */ };
```

### 2.5 Gateway Protocol Methods

```typescript
// src/gateway/server-methods/cron.ts
export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params }) => {
    /* Trigger immediate wake */
  },
  "cron.list": async ({ params }) => {
    /* List jobs */
  },
  "cron.status": async ({ params }) => {
    /* Get status */
  },
  "cron.add": async ({ params }) => {
    /* Create job */
  },
  "cron.update": async ({ params }) => {
    /* Update job */
  },
  "cron.remove": async ({ params }) => {
    /* Delete job */
  },
  "cron.run": async ({ params }) => {
    /* Execute job */
  },
  "cron.runs": async ({ params }) => {
    /* Get run history */
  },
};
```

### 2.6 CronService Dependencies (Extension Points)

```typescript
// src/cron/service/state.ts
export type CronServiceDeps = {
  // Core
  nowMs?: () => number;
  log: Logger;
  storePath: string;
  cronEnabled: boolean;
  cronConfig?: CronConfig;

  // Agent/Session resolution
  defaultAgentId?: string;
  resolveSessionStorePath?: (agentId?: string) => string;
  sessionStorePath?: string;

  // Startup behavior
  missedJobStaggerMs?: number;
  maxMissedJobsPerRestart?: number;

  // Execution hooks (KEY EXTENSION POINT)
  enqueueSystemEvent: (text: string, opts?) => void;
  requestHeartbeatNow: (opts?) => void;
  runHeartbeatOnce?: (opts?) => Promise<HeartbeatRunResult>;
  runIsolatedAgentJob: (params) => Promise<CronRunOutcome>;
  sendCronFailureAlert?: (params) => Promise<void>;

  // Event notification
  onEvent?: (evt: CronEvent) => void;
};
```

---

## 3. Category 2: Webhook Triggers

### 3.1 Core Files

| File                                       | Purpose                             | Lines |
| ------------------------------------------ | ----------------------------------- | ----- |
| `src/plugins/http-registry.ts`             | Plugin HTTP route registration      | 92    |
| `src/plugin-sdk/webhook-targets.ts`        | Webhook target resolution & routing | 281   |
| `src/plugin-sdk/webhook-request-guards.ts` | Rate limiting & in-flight guards    | -     |
| `src/plugin-sdk/webhook-memory-guards.ts`  | Memory protection guards            | -     |
| `src/plugin-sdk/webhook-path.ts`           | Path normalization utilities        | -     |
| `src/cron/webhook-url.ts`                  | Webhook URL validation              | 22    |

### 3.2 Webhook Registration System

```typescript
// src/plugins/http-registry.ts
export function registerPluginHttpRoute(params: {
  path?: string | null;
  fallbackPath?: string | null;
  handler: PluginHttpRouteHandler;
  auth: PluginHttpRouteRegistration["auth"]; // "none" | "token" | "hmac"
  match?: "exact" | "prefix";
  replaceExisting?: boolean;
  pluginId?: string;
  source?: string;
  accountId?: string;
}): () => void; // Returns unregister function
```

### 3.3 Webhook Target Resolution

```typescript
// src/plugin-sdk/webhook-targets.ts
export function registerWebhookTarget<T extends { path: string }>(
  targetsByPath: Map<string, T[]>,
  target: T,
  opts?: RegisterWebhookTargetOptions<T>,
): RegisteredWebhookTarget<T>;

export function withResolvedWebhookRequestPipeline<T>(params: {
  req: IncomingMessage;
  res: ServerResponse;
  targetsByPath: Map<string, T[]>;
  allowMethods?: readonly string[];
  rateLimiter?: FixedWindowRateLimiter;
  inFlightLimiter?: WebhookInFlightLimiter;
  handle: (args: { path: string; targets: T[] }) => Promise<boolean | void>;
}): Promise<boolean>;
```

### 3.4 Channel-Specific Webhook Implementations

| Channel  | File                      | Description                        |
| -------- | ------------------------- | ---------------------------------- |
| Telegram | `src/telegram/webhook.ts` | gramY webhook callback integration |
| LINE     | `src/line/webhook.ts`     | LINE messaging API webhook handler |
| Discord  | Built into monitor        | Discord.js gateway events          |
| WhatsApp | Web + polling hybrid      | Baileys-based                      |

### 3.5 Telegram Webhook Example

```typescript
// src/telegram/webhook.ts
export async function startTelegramWebhook(opts: {
  token: string;
  accountId?: string;
  config?: OpenClawConfig;
  path?: string; // Default: "/telegram-webhook"
  port?: number; // Default: 8787
  host?: string;
  secret?: string; // Required for webhook auth
  publicUrl?: string; // URL advertised to Telegram
  webhookCertPath?: string;
}): Promise<{ server; bot; stop }>;
```

---

## 4. Category 3: Message Triggers

### 4.1 Core Files

| File                                            | Purpose                                | Lines |
| ----------------------------------------------- | -------------------------------------- | ----- |
| `src/auto-reply/dispatch.ts`                    | Inbound message dispatch orchestration | 97    |
| `src/auto-reply/reply/get-reply.ts`             | Main reply generation entry point      | -     |
| `src/auto-reply/reply/dispatch-from-config.ts`  | Config-driven dispatch                 | -     |
| `src/auto-reply/reply/reply-dispatcher.ts`      | Reply dispatch coordination            | -     |
| `src/web/auto-reply/monitor.ts`                 | Web channel message monitor            | -     |
| `src/web/auto-reply/monitor/process-message.ts` | Message processing pipeline            | -     |

### 4.2 Message Dispatch Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    MESSAGE TRIGGER FLOW                         │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Channel Webhook/Polling                                        │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────┐                                        │
│  │  Channel Monitor    │  (src/telegram/monitor.ts, etc.)       │
│  │  (per-channel)      │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                        │
│  │  dispatchInbound    │  (src/auto-reply/dispatch.ts)          │
│  │  Message()          │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                        │
│  │  getReplyFromConfig │  (src/auto-reply/reply/get-reply.ts)   │
│  │  / dispatchReply    │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                        │
│  │  Agent Execution    │  (src/agents/pi-embedded-runner/)      │
│  │  (Pi RPC)           │                                        │
│  └──────────┬──────────┘                                        │
│             │                                                   │
│             ▼                                                   │
│  ┌─────────────────────┐                                        │
│  │  Reply Delivery     │  (src/auto-reply/reply/delivery/*.ts)  │
│  └─────────────────────┘                                        │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### 4.3 Message Context Structure

```typescript
// src/auto-reply/templating.ts
export type MsgContext = {
  Body: string; // Raw message body
  BodyForAgent: string; // Processed body for agent
  BodyForCommands: string; // Body for command parsing
  RawBody: string; // Original raw input
  CommandBody: string; // Command-parsed body
  InputProvenance?: InputProvenance;
  SessionKey: string;
  Provider: string; // Channel provider ID
  Surface: string; // UI surface
  OriginatingChannel: string;
  OriginatingTo?: string;
  ExplicitDeliverRoute: boolean;
  AccountId?: string;
  MessageThreadId?: string | number;
  ChatType: "direct" | "group";
  CommandAuthorized: boolean;
  MessageSid: string; // Unique message ID
  SenderId?: string;
  SenderName?: string;
  SenderUsername?: string;
  GatewayClientScopes?: string[];
};
```

### 4.4 Command Triggers

```typescript
// src/auto-reply/reply/commands-core.ts
export const coreCommands: CommandHandler[] = [
  { command: "/new", handler: handleNewCommand },
  { command: "/reset", handler: handleResetCommand },
  { command: "/compact", handler: handleCompactCommand },
  { command: "/think", handler: handleThinkCommand },
  { command: "/verbose", handler: handleVerboseCommand },
  { command: "/usage", handler: handleUsageCommand },
  { command: "/restart", handler: handleRestartCommand },
  { command: "/activation", handler: handleActivationCommand },
  { command: "/status", handler: handleStatusCommand },
];
```

---

## 5. Category 4: System Event Triggers

### 5.1 Core Files

| File                            | Purpose                 | Lines |
| ------------------------------- | ----------------------- | ----- |
| `src/hooks/internal-hooks.ts`   | Internal hook system    | 421   |
| `src/hooks/hooks.ts`            | Public hook API exports | 14    |
| `src/infra/system-events.ts`    | System event queue      | -     |
| `src/infra/heartbeat-runner.ts` | Heartbeat/wake runner   | -     |
| `src/infra/heartbeat-wake.ts`   | Heartbeat wake triggers | -     |

### 5.2 Hook System Architecture

```typescript
// src/hooks/internal-hooks.ts
export type InternalHookEventType = "command" | "session" | "agent" | "gateway" | "message";

export interface InternalHookEvent {
  type: InternalHookEventType;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[]; // Hooks can push messages here
}

export type InternalHookHandler = (event: InternalHookEvent) => Promise<void> | void;

// Registration
export function registerInternalHook(eventKey: string, handler: InternalHookHandler): void;
export function unregisterInternalHook(eventKey: string, handler: InternalHookHandler): void;
export async function triggerInternalHook(event: InternalHookEvent): Promise<void>;
```

### 5.3 Hook Event Types

| Event Type | Actions                                           | Context                         |
| ---------- | ------------------------------------------------- | ------------------------------- |
| `command`  | `new`, `reset`, `compact`, `think`, etc.          | Command arguments, session info |
| `session`  | `created`, `reset`, `compacted`                   | Session metadata                |
| `agent`    | `bootstrap`                                       | Workspace files, config         |
| `gateway`  | `startup`                                         | Config, CLI deps                |
| `message`  | `received`, `sent`, `transcribed`, `preprocessed` | Message content, sender info    |

### 5.4 System Events

```typescript
// src/infra/system-events.ts
export function enqueueSystemEvent(
  text: string,
  opts?: {
    sessionKey?: string;
    contextKey?: string;
    priority?: boolean;
  },
): void;
```

---

## 6. Service Integration Extension Points

### 6.1 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SERVICE TRIGGER INTEGRATION                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      ServiceTriggerManager                       │   │
│  │                    (NEW - To be implemented)                     │   │
│  │                                                                  │   │
│  │  • Service registration & lifecycle                              │   │
│  │  • Trigger ownership tracking                                    │   │
│  │  • Service-scoped cron jobs                                      │   │
│  │  • Service webhook endpoints                                     │   │
│  │  • Service-specific hooks                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│          ┌──────────────────┼──────────────────┐                       │
│          ▼                  ▼                  ▼                       │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                  │
│  │   CronService │   │  Webhook    │   │   Hooks     │                  │
│  │   Integration │   │  Registry   │   │   System    │                  │
│  └─────────────┘   └─────────────┘   └─────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Extension Point 1: CronService Integration

**Location**: `src/cron/service/state.ts` - `CronServiceDeps`

```typescript
// Current deps can be extended for Services:
export type CronServiceDeps = {
  // ... existing deps ...

  // NEW: Service-scoped job execution
  resolveServiceAgentId?: (serviceId: string) => string | undefined;

  // NEW: Service-owned job validation
  validateServiceJob?: (job: CronJobCreate, serviceId?: string) => boolean;

  // NEW: Service-scoped event routing
  onServiceEvent?: (serviceId: string, evt: CronEvent) => void;
};
```

**Integration Strategy**:

- Services create jobs via `cron.add()` with `agentId` and metadata
- Jobs can include `serviceId` in metadata for ownership tracking
- `onEvent` callback can route events to appropriate Service

### 6.3 Extension Point 2: Webhook Registry Integration

**Location**: `src/plugins/http-registry.ts` - `registerPluginHttpRoute`

```typescript
// Current signature supports Service integration:
registerPluginHttpRoute({
  path: "/service/:serviceId/webhook",
  handler: async (req, res) => {
    // Route to Service webhook handler
  },
  auth: "token", // Or "hmac" for Service webhooks
  pluginId: "service:my-service-id", // Service identification
  source: "service-trigger",
});
```

**Integration Strategy**:

- Services register webhooks via `registerPluginHttpRoute`
- Use `pluginId` to namespace by service (e.g., `"service:weather"`)
- Auth can be `"token"`, `"hmac"`, or `"none"` per Service needs

### 6.4 Extension Point 3: Hook System Integration

**Location**: `src/hooks/internal-hooks.ts`

```typescript
// NEW: Service-specific hook types
export type ServiceHookEventType =
  | "service:trigger" // Service trigger fired
  | "service:webhook" // Service webhook received
  | "service:cron" // Service cron job executed
  | "service:action"; // Service action requested

// Services can register handlers:
registerHook("service:trigger:weather-alert", async (event) => {
  // Handle weather alert trigger
});
```

### 6.5 Extension Point 4: Gateway Methods Integration

**Location**: `src/gateway/server-methods/`

```typescript
// NEW: Service trigger gateway methods
export const serviceTriggerHandlers: GatewayRequestHandlers = {
  "service.trigger.register": async ({ params, context }) => {
    // Register a Service trigger
  },
  "service.trigger.unregister": async ({ params, context }) => {
    // Unregister a Service trigger
  },
  "service.trigger.list": async ({ params, context }) => {
    // List Service triggers
  },
  "service.trigger.fire": async ({ params, context }) => {
    // Manually fire a Service trigger
  },
};
```

---

## 7. Ownership & Metadata Patterns

### 7.1 Current Ownership Patterns

| Resource  | Ownership Field    | Location                                 |
| --------- | ------------------ | ---------------------------------------- |
| Cron Jobs | `agentId`          | `CronJobBase.agentId`                    |
| Sessions  | `agentId` (in key) | `sessionKey` format: `{agentId}:{scope}` |
| Webhooks  | `pluginId`         | `PluginHttpRouteRegistration.pluginId`   |
| Hooks     | None (global)      | Event `sessionKey` provides context      |

### 7.2 Recommended Service Ownership Pattern

```typescript
// Extend CronJobBase for Service ownership
interface ServiceOwnedCronJob extends CronJob {
  metadata?: {
    serviceId?: string;
    triggerId?: string;
    triggerType?: "webhook" | "schedule" | "event";
  };
}

// Webhook route with Service ownership
interface ServiceWebhookRoute {
  path: string;
  pluginId: string; // Format: "service:{serviceId}"
  serviceId: string;
  triggerId: string;
  handler: PluginHttpRouteHandler;
}
```

---

## 8. File Inventory

### 8.1 Cron System Files

```
src/cron/
├── service.ts                    # Main CronService class
├── types.ts                      # Type definitions
├── types-shared.ts               # Shared base types
├── schedule.ts                   # Schedule computation
├── store.ts                      # Persistence
├── run-log.ts                    # Execution logging
├── delivery.ts                   # Result delivery
├── webhook-url.ts                # URL validation
├── normalize.ts                  # Input normalization
├── validate-timestamp.ts         # Timestamp validation
└── service/
    ├── state.ts                  # State management
    ├── ops.ts                    # Core operations
    ├── jobs.ts                   # Job lifecycle
    ├── timer.ts                  # Timer management
    ├── store.ts                  # Store operations
    ├── locked.ts                 # Concurrency control
    └── timeout-policy.ts         # Timeout handling
```

### 8.2 Webhook System Files

```
src/plugins/
├── http-registry.ts              # HTTP route registration
├── http-path.ts                  # Path utilities
└── http-route-overlap.ts         # Route conflict detection

src/plugin-sdk/
├── webhook-targets.ts            # Target resolution
├── webhook-request-guards.ts     # Rate limiting
├── webhook-memory-guards.ts      # Memory protection
└── webhook-path.ts               # Path normalization

src/telegram/
└── webhook.ts                    # Telegram webhook

src/line/
└── webhook.ts                    # LINE webhook
```

### 8.3 Message Trigger Files

```
src/auto-reply/
├── dispatch.ts                   # Main dispatch
├── types.ts                      # Type definitions
├── reply/
│   ├── get-reply.ts             # Reply generation
│   ├── dispatch-from-config.ts  # Config dispatch
│   ├── reply-dispatcher.ts      # Dispatch coordination
│   └── commands-*.ts            # Command handlers
└── reply.triggers.*.ts          # Trigger handling tests

src/web/auto-reply/
├── monitor.ts                    # Web monitor
├── monitor/
│   ├── process-message.ts       # Message processing
│   ├── on-message.ts            # Message handler
│   └── commands.ts              # Web commands
└── mentions.ts                   # Mention handling
```

### 8.4 Hook System Files

```
src/hooks/
├── hooks.ts                      # Public API
├── internal-hooks.ts             # Core implementation
├── loader.ts                     # Hook loader
├── bundled/                      # Built-in hooks
│   ├── session-memory/
│   ├── command-logger/
│   └── boot-md/
└── gmail-ops.ts                  # Gmail Pub/Sub
```

---

## 9. Key Integration Recommendations

### 9.1 For T4 (Architecture Design)

1. **Leverage Existing CronService**: Extend rather than replace
2. **Use Plugin Webhook Registry**: Already supports namespacing
3. **Extend Hook System**: Add `service:*` event types
4. **Metadata for Ownership**: Add `serviceId` to job metadata

### 9.2 For T9 (Cron Integration)

1. **Service Job Creation**: Use `cron.add()` with service metadata
2. **Event Routing**: Extend `onEvent` to route to Services
3. **Agent Resolution**: Ensure Services have dedicated agents
4. **Session Isolation**: Use `sessionTarget: "isolated"` for Services

---

## 10. Appendix: Data Flow Diagrams

### 10.1 Cron Job Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Timer     │────▶│  CronService │────▶│   Job Due   │
│   Tick      │     │   Check     │     │   Check     │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Event     │◀────│   Persist   │◀────│   Execute   │
│   Broadcast │     │   Result    │     │   Job       │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   Delivery  │
                                        │   (announce  │
                                        │   or webhook)│
                                        └─────────────┘
```

### 10.2 Webhook Processing Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   HTTP      │────▶│   Plugin    │────▶│   Target    │
│   Request   │     │   Registry  │     │   Resolve   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Channel   │◀────│   Dispatch  │◀────│   Guards    │
│   Handler   │     │   Message   │     │   (rate,    │
│             │     │             │     │   memory)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

**End of Document**

_This audit provides the foundation for Wave 2 Architecture Design (T4) and Wave 3 Cron Integration (T9)._
