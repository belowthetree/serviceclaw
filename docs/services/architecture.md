---
summary: "Service Architecture Design - Core design document for the Service Concept MVP"
read_when:
  - Implementing Service infrastructure
  - Designing Service lifecycle management
  - Planning Service security model
  - Building Service registry
title: "Service Architecture"
---

# Service Architecture Design

> **Version**: 1.0  
> **Status**: Design Phase - Pending Approval  
> **Depends On**: T1 (Examples), T2 (Trigger Audit), T3 (Extension Patterns)  
> **Blocks**: T5 (Schema), T6 (Core Infrastructure), T7 (Registry)

---

## Executive Summary

This document defines the complete architecture for **Services** in OpenClaw - a declarative automation system that enables non-technical users to create "set and forget" automations by bundling existing skills, tools, and triggers.

**Core Philosophy**: Services are **NOT** a new runtime. They are metadata-driven configurations that leverage existing OpenClaw infrastructure (CronService, plugin tools, skill loading, webhook registry) to provide a user-friendly abstraction layer.

**Key Design Principles**:

1. **Reuse, Don't Reinvent**: Services use existing CronService, webhook registry, and tool system
2. **Security First**: Capability declarations with user confirmation for privileged operations
3. **Atomic Operations**: Installation is all-or-nothing with automatic rollback on failure
4. **Declarative Configuration**: JSON/YAML manifests define what, not how

---

## 1. Service Definition

### 1.1 What is a Service?

A **Service** is a user-facing automation that combines:

- **Trigger Configuration**: When to run (cron, webhook, message, web UI)
- **Capability Requirements**: What skills/tools/environment it needs
- **User Configuration**: Customizable parameters via JSON Schema
- **Execution Logic**: References to existing tools/skills (no custom code)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SERVICE COMPOSITION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                │
│   │   Trigger   │ +  │   Config    │ +  │  Capabilities│                │
│   │  (when)     │    │  (params)   │    │   (needs)    │                │
│   └──────┬──────┘    └─────────────┘    └─────────────┘                │
│          │                                                              │
│          ▼                                                              │
│   ┌─────────────────────────────────────────────────────────────┐      │
│   │              REFERENCES (not implementation)                 │      │
│   │  • Cron job in CronService                                   │      │
│   │  • Webhook route in HTTP registry                           │      │
│   │  • Agent session for execution                               │      │
│   │  • Tool invocations (weather.fetch, message.send, etc.)     │      │
│   └─────────────────────────────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Service vs Extension

| Aspect           | Extension (Plugin)       | Service                      |
| ---------------- | ------------------------ | ---------------------------- |
| **Code**         | Contains implementation  | References existing tools    |
| **Runtime**      | May have its own runtime | Uses existing infrastructure |
| **Audience**     | Developers               | Non-technical users          |
| **Distribution** | NPM packages             | Service manifests + config   |
| **Installation** | `npm install`            | Atomic install via registry  |
| **Lifecycle**    | Manual enable/disable    | Full state machine           |

---

## 2. Service Manifest Format

### 2.1 Core Schema (service.json)

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "daily-briefing",
  "name": "Daily Briefing",
  "description": "Your personalized morning briefing with weather, calendar, news, and tasks",
  "version": "1.0.0",
  "author": "OpenClaw",
  "category": "productivity",

  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *",
    "timezone": "auto"
  },

  "config": {
    "weatherLocation": {
      "type": "string",
      "description": "City or location for weather",
      "default": "New York",
      "required": true
    },
    "newsSources": {
      "type": "array",
      "items": { "type": "string" },
      "description": "News RSS feeds or keywords",
      "default": ["tech", "world"],
      "required": false
    },
    "delivery": {
      "type": "object",
      "required": true,
      "properties": {
        "channel": {
          "type": "string",
          "enum": ["slack", "discord", "telegram"],
          "description": "Where to send the briefing"
        }
      }
    }
  },

  "requires": {
    "skills": ["weather"],
    "optionalSkills": ["gog", "apple-reminders"],
    "tools": ["message.send", "web_fetch"],
    "optionalTools": ["calendar.fetch"],
    "env": ["OPENWEATHER_API_KEY"],
    "config": ["channels.slack"]
  },

  "capabilities": {
    "privilegedTools": ["message.send"],
    "requiresConfirmation": ["message.send"],
    "network": true,
    "filesystem": false
  },

  "execution": {
    "agentId": "service:daily-briefing",
    "sessionTarget": "isolated",
    "timeout": 30000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential"
    }
  }
}
```

### 2.2 Schema Reference

#### Top-Level Fields

| Field         | Type   | Required | Description                    |
| ------------- | ------ | -------- | ------------------------------ |
| `$schema`     | string | Yes      | Schema URL for validation      |
| `id`          | string | Yes      | Unique identifier (kebab-case) |
| `name`        | string | Yes      | Human-readable name            |
| `description` | string | Yes      | What the service does          |
| `version`     | string | Yes      | Semver version                 |
| `author`      | string | No       | Creator/organization           |
| `category`    | string | No       | Category for grouping          |

#### Trigger Types

```typescript
type ServiceTrigger = CronTrigger | WebhookTrigger | MessageTrigger | WebUITrigger;

// Cron - Scheduled execution
interface CronTrigger {
  type: "cron";
  schedule: string; // Cron expression
  timezone?: string; // "auto" or IANA timezone
}

// Webhook - HTTP endpoint trigger
interface WebhookTrigger {
  type: "webhook";
  path: string; // URL path (e.g., "/webhooks/github")
  methods?: string[]; // HTTP methods (default: ["POST"])
  auth?: {
    type: "none" | "token" | "hmac" | "signature";
    header?: string; // Auth header name
    secret?: string; // Secret reference (stored securely)
  };
}

// Message - Channel message trigger
interface MessageTrigger {
  type: "message";
  channels: string[]; // Channel types (slack, discord, etc.)
  filters?: {
    patterns?: string[]; // Regex patterns to match
    keywords?: string[]; // Keywords to watch for
    fromUsers?: string[]; // Specific users
    hasAttachments?: boolean;
  };
}

// Web UI - Dashboard/web page trigger
interface WebUITrigger {
  type: "web";
  path: string; // URL path for dashboard
  auth?: "gateway" | "public" | "password";
}
```

#### Configuration Schema

Uses JSON Schema with OpenClaw extensions:

```typescript
interface ServiceConfigField {
  type: "string" | "number" | "boolean" | "array" | "object" | "secret";
  description: string;
  required?: boolean;
  default?: unknown;

  // Type-specific
  enum?: string[]; // For string type
  items?: ServiceConfigField; // For array type
  properties?: Record<string, ServiceConfigField>; // For object type

  // OpenClaw extensions
  "x-openclaw"?: {
    // UI hints
    inputType?: "text" | "select" | "multiselect" | "channel-picker" | "skill-picker";
    // Data source for dynamic options
    dataSource?: {
      skill?: string;
      tool?: string;
      config?: string;
    };
    // Validation
    validateOn?: "blur" | "change" | "submit";
  };
}
```

#### Requirements Block

```typescript
interface ServiceRequirements {
  // Required capabilities (installation fails if unavailable)
  skills?: string[]; // Required skill IDs
  tools?: string[]; // Required tool names
  env?: string[]; // Required environment variables
  config?: string[]; // Required config paths

  // Optional capabilities (service works with degraded functionality)
  optionalSkills?: string[];
  optionalTools?: string[];
}
```

#### Capabilities Block (Security)

```typescript
interface ServiceCapabilities {
  // Tools requiring explicit user confirmation
  requiresConfirmation?: string[];

  // Privileged tool categories
  privilegedTools?: string[];

  // System-level permissions
  network?: boolean; // Internet access required
  filesystem?: boolean; // File system access
  shell?: boolean; // Shell command execution
  browser?: boolean; // Browser automation
}
```

---

## 3. Service Lifecycle State Machine

### 3.1 State Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVICE LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                              ┌─────────────┐                                │
│                              │   PENDING   │                                │
│                              │  (created)  │                                │
│                              └──────┬──────┘                                │
│                                     │                                        │
│                        ┌────────────┴────────────┐                          │
│                        │                         │                          │
│                        ▼                         ▼                          │
│              ┌─────────────────┐      ┌─────────────────┐                  │
│              │   VALIDATING    │      │   INSTALL_ERROR │                  │
│              │ (checking deps) │      │   (rollback)    │                  │
│              └────────┬────────┘      └─────────────────┘                  │
│                       │                                                      │
│              ┌────────┴────────┐                                            │
│              │                 │                                            │
│              ▼                 ▼                                            │
│    ┌─────────────────┐ ┌─────────────────┐                                │
│    │   INSTALLING    │ │ VALIDATION_ERROR│                                │
│    │ (creating refs) │ │   (fix & retry) │                                │
│    └────────┬────────┘ └─────────────────┘                                │
│             │                                                                │
│             ▼                                                                │
│    ┌─────────────────┐                                                      │
│    │    INSTALLED    │◄──────────────────────────┐                         │
│    │  (refs created) │                           │                         │
│    └────────┬────────┘                           │                         │
│             │                                    │                         │
│    ┌────────┴────────┐                         │                         │
│    │                 │                         │                         │
│    ▼                 ▼                         │                         │
│ ┌───────┐     ┌─────────────┐                  │                         │
│ │ENABLED│     │   DISABLED  │──────────────────┘                         │
│ │(active)│     │ (installed  │  (can re-enable)                          │
│ └───┬───┘     │  but off)   │                                            │
│     │         └─────────────┘                                            │
│     │                                                                      │
│     │    ┌──────────────────────────────────────────┐                     │
│     │    │                  ERROR                   │                     │
│     └────┤ (runtime error, auto-disabled)           │                     │
│          └──────────────────────────────────────────┘                     │
│                                                                              │
│ ┌────────────────────────────────────────────────────────────────────────┐│
│ │                         UNINSTALLING                                   ││
│ │ (removing refs, cleaning up)                                           ││
│ └────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 State Definitions

| State              | Description                               | Transitions                    |
| ------------------ | ----------------------------------------- | ------------------------------ |
| `pending`          | Service created but not yet validated     | → validating                   |
| `validating`       | Checking requirements, dependencies       | → installing, validation_error |
| `installing`       | Creating cron jobs, webhooks, etc.        | → installed, install_error     |
| `installed`        | All resources created, but not running    | → enabled, disabled            |
| `enabled`          | Service is active and processing triggers | → disabled, error              |
| `disabled`         | Installed but not processing triggers     | → enabled, uninstalling        |
| `error`            | Runtime error occurred                    | → disabled                     |
| `validation_error` | Requirements not met                      | → validating (retry)           |
| `install_error`    | Installation failed, rolled back          | → validating (retry)           |
| `uninstalling`     | Cleaning up resources                     | → (removed)                    |

### 3.3 State Transitions

```typescript
interface ServiceStateMachine {
  // User-initiated transitions
  install(service: ServiceManifest): Promise<void>; // pending → installed
  enable(serviceId: string): Promise<void>; // installed → enabled
  disable(serviceId: string): Promise<void>; // enabled → disabled
  uninstall(serviceId: string): Promise<void>; // any → uninstalling

  // System-initiated transitions
  validate(service: ServiceManifest): Promise<boolean>; // pending → validating
  onRuntimeError(serviceId: string, error: Error): void; // enabled → error
  retryInstallation(serviceId: string): Promise<void>; // error → validating
}
```

---

## 4. Service Class/Interface Design

### 4.1 Service Instance Interface

```typescript
// src/services/types.ts

export interface ServiceInstance {
  // Identity
  readonly id: string;
  readonly manifest: ServiceManifest;

  // State
  state: ServiceState;
  stateHistory: StateTransition[];
  createdAt: Date;
  updatedAt: Date;

  // User configuration
  config: ServiceConfig;
  configSchema: ServiceConfigSchema;

  // Runtime references (created during installation)
  runtimeRefs: ServiceRuntimeRefs;

  // Execution tracking
  executionStats: ServiceExecutionStats;
  lastRunAt?: Date;
  nextRunAt?: Date;

  // Methods
  validate(): Promise<ValidationResult>;
  install(): Promise<InstallResult>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  uninstall(): Promise<void>;
  execute(trigger: TriggerEvent): Promise<ExecutionResult>;
}

export interface ServiceRuntimeRefs {
  // CronService integration
  cronJobIds?: string[];

  // Webhook registry integration
  webhookPaths?: string[];
  webhookUnregisterFns?: Array<() => void>;

  // Message trigger integration
  messageSubscriptions?: Array<{
    channel: string;
    unsubscribe: () => void;
  }>;

  // Agent session
  agentId: string;
  sessionKey?: string;
}

export interface ServiceExecutionStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastError?: {
    message: string;
    timestamp: Date;
    stack?: string;
  };
}
```

### 4.2 Service Manifest Type

```typescript
// src/services/manifest.ts

export interface ServiceManifest {
  // Identity
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: ServiceCategory;

  // Trigger configuration
  trigger: ServiceTrigger;

  // User configuration schema
  config: Record<string, ServiceConfigField>;

  // Requirements
  requires: ServiceRequirements;

  // Security
  capabilities: ServiceCapabilities;

  // Execution settings
  execution?: ServiceExecutionConfig;
}

export type ServiceCategory =
  | "productivity"
  | "communication"
  | "monitoring"
  | "automation"
  | "integration"
  | "custom";

export interface ServiceExecutionConfig {
  agentId?: string; // Auto-generated if not specified
  sessionTarget?: "main" | "isolated";
  timeout?: number; // Milliseconds
  retryPolicy?: {
    maxRetries: number;
    backoff: "fixed" | "linear" | "exponential";
    initialDelayMs?: number;
  };
}
```

### 4.3 ServiceRegistry Interface

```typescript
// src/services/registry.ts

export interface ServiceRegistry {
  // Lifecycle
  register(manifest: ServiceManifest): Promise<ServiceInstance>;
  unregister(serviceId: string): Promise<void>;

  // State management
  install(serviceId: string, config?: ServiceConfig): Promise<void>;
  uninstall(serviceId: string): Promise<void>;
  enable(serviceId: string): Promise<void>;
  disable(serviceId: string): Promise<void>;

  // Configuration
  updateConfig(serviceId: string, config: ServiceConfig): Promise<void>;
  validateConfig(serviceId: string, config: ServiceConfig): Promise<ValidationResult>;

  // Queries
  list(opts?: ListServicesOptions): Promise<ServiceInstance[]>;
  get(serviceId: string): Promise<ServiceInstance | undefined>;
  getByState(state: ServiceState): Promise<ServiceInstance[]>;

  // Execution (called by triggers)
  execute(serviceId: string, event: TriggerEvent): Promise<ExecutionResult>;

  // Event subscriptions
  onStateChange(handler: StateChangeHandler): () => void;
  onExecutionComplete(handler: ExecutionHandler): () => void;
}

export interface ListServicesOptions {
  state?: ServiceState;
  category?: ServiceCategory;
  triggerType?: TriggerType;
  search?: string;
}
```

---

## 5. Integration with Existing Infrastructure

### 5.1 CronService Integration

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SERVICE → CRON INTEGRATION                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Service with Cron Trigger                                              │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ServiceRegistry.install()                                       │   │
│  │                                                                  │   │
│  │  1. Validate cron expression                                     │   │
│  │  2. Generate service-scoped job ID: `service:{id}:cron:0`        │   │
│  │  3. Create CronJob:                                              │   │
│  │     {                                                            │   │
│  │       id: "service:daily-briefing:cron:0",                       │   │
│  │       name: "Daily Briefing",                                    │   │
│  │       agentId: "service:daily-briefing",  // Service agent       │   │
│  │       sessionTarget: "isolated",                                 │   │
│  │       schedule: { kind: "cron", expr: "0 8 * * *" },            │   │
│  │       payload: {                                                 │   │
│  │         kind: "serviceTrigger",                                  │   │
│  │         serviceId: "daily-briefing",                             │   │
│  │         triggerType: "cron"                                      │   │
│  │       },                                                         │   │
│  │       metadata: {                                                │   │
│  │         serviceId: "daily-briefing",                             │   │
│  │         managedBy: "service-registry"                            │   │
│  │       }                                                          │   │
│  │     }                                                            │   │
│  │  4. Call cronService.add(job)                                    │   │
│  │  5. Store job ID in ServiceInstance.runtimeRefs.cronJobIds       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  On Cron Trigger:                                                       │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  CronService → ServiceRegistry                                  │   │
│  │                                                                  │   │
│  │  1. Cron job fires with payload.serviceId                        │   │
│  │  2. Lookup service in registry                                   │   │
│  │  3. Call ServiceRegistry.execute(serviceId, triggerEvent)        │   │
│  │  4. Service executes with full context                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation Notes**:

- Services use dedicated agent IDs: `service:{serviceId}`
- Cron jobs include `metadata.serviceId` for ownership tracking
- `payload.kind: "serviceTrigger"` routes to ServiceRegistry
- Bulk operations: can list all cron jobs with `metadata.managedBy: "service-registry"`

### 5.2 Webhook Registry Integration

```typescript
// src/services/integrations/webhook.ts

export async function installWebhookTrigger(
  service: ServiceInstance,
  trigger: WebhookTrigger,
  registry: ServiceRegistry,
): Promise<void> {
  const path = trigger.path.replace("{serviceId}", service.id);

  // Register with plugin HTTP registry
  const unregister = registerPluginHttpRoute({
    path,
    handler: async (req, res) => {
      // Validate auth if configured
      if (trigger.auth?.type !== "none") {
        const valid = await validateWebhookAuth(req, trigger.auth);
        if (!valid) {
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }
      }

      // Parse payload
      const payload = await parseWebhookPayload(req);

      // Execute service
      const result = await registry.execute(service.id, {
        type: "webhook",
        timestamp: new Date(),
        payload,
        headers: req.headers,
      });

      // Respond
      res.writeHead(result.success ? 200 : 500);
      res.end(JSON.stringify(result));
    },
    auth: trigger.auth?.type === "none" ? "none" : "token",
    pluginId: `service:${service.id}`,
    source: "service-trigger",
  });

  // Store unregister function for cleanup
  service.runtimeRefs.webhookUnregisterFns = [
    ...(service.runtimeRefs.webhookUnregisterFns || []),
    unregister,
  ];
  service.runtimeRefs.webhookPaths = [...(service.runtimeRefs.webhookPaths || []), path];
}
```

### 5.3 Message Trigger Integration

```typescript
// src/services/integrations/message.ts

export async function installMessageTrigger(
  service: ServiceInstance,
  trigger: MessageTrigger,
  registry: ServiceRegistry,
): Promise<void> {
  const subscriptions: ServiceRuntimeRefs["messageSubscriptions"] = [];

  for (const channelType of trigger.channels) {
    // Subscribe to message events via hook system
    const unsubscribe = registerInternalHook(`message:received:${channelType}`, async (event) => {
      // Check if message matches filters
      if (!matchesFilters(event.context, trigger.filters)) {
        return;
      }

      // Check if service is enabled
      if (service.state !== "enabled") {
        return;
      }

      // Execute service
      await registry.execute(service.id, {
        type: "message",
        timestamp: new Date(),
        message: event.context,
        channel: channelType,
      });
    });

    subscriptions.push({ channel: channelType, unsubscribe });
  }

  service.runtimeRefs.messageSubscriptions = subscriptions;
}
```

### 5.4 Skill Loading Integration

Services bundle skills just like extensions:

```
extensions/daily-briefing-service/
├── openclaw.plugin.json
├── index.ts
└── skills/
    └── daily-briefing/
        └── SKILL.md
```

The skill provides agent guidance:

```markdown
# Daily Briefing Service

You are the Daily Briefing automation service. When triggered, you should:

## Steps

1. Fetch weather for the configured location
2. Fetch calendar events for today
3. Fetch tasks from configured sources
4. Generate a friendly briefing message
5. Send via the configured delivery channel

## Configuration

- `weatherLocation`: City name for weather
- `newsSources`: Array of news categories
- `calendarIds`: Which calendars to include
- `delivery.channel`: Where to send (slack, discord, etc.)
- `delivery.target`: Specific channel/DM

## Tools

- `weather.fetch` - Get weather data
- `calendar.listEvents` - Get calendar events
- `tasks.list` - Get tasks
- `message.send` - Send the briefing
```

### 5.5 Tool Registration Integration

Services can expose tools for user interaction:

```typescript
// In service extension index.ts
export default function register(api: OpenClawPluginApi) {
  // Register service management tools
  api.registerTool(createServiceControlTool(api), { optional: true });
  api.registerTool(createServiceStatusTool(api), { optional: true });
}

function createServiceControlTool(api: OpenClawPluginApi) {
  return {
    name: "service.control",
    description: "Enable, disable, or configure a service",
    parameters: Type.Object({
      serviceId: Type.String(),
      action: Type.String({ enum: ["enable", "disable", "configure"] }),
      config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const registry = api.runtime.serviceRegistry;

      switch (params.action) {
        case "enable":
          await registry.enable(params.serviceId as string);
          return { success: true, message: `Service ${params.serviceId} enabled` };
        case "disable":
          await registry.disable(params.serviceId as string);
          return { success: true, message: `Service ${params.serviceId} disabled` };
        case "configure":
          await registry.updateConfig(params.serviceId as string, params.config as ServiceConfig);
          return { success: true, message: `Service ${params.serviceId} configured` };
      }
    },
  };
}
```

---

## 6. Security Model

### 6.1 Capability Declaration

Services MUST declare all capabilities upfront:

```json
{
  "requires": {
    "skills": ["weather", "calendar"],
    "tools": ["message.send", "web.fetch"],
    "env": ["WEATHER_API_KEY"]
  },
  "capabilities": {
    "privilegedTools": ["message.send"],
    "requiresConfirmation": ["message.send"],
    "network": true,
    "filesystem": false
  }
}
```

### 6.2 Privilege Escalation Prevention

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SECURITY CHECKPOINTS                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Installation Time:                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Parse manifest capabilities                                  │   │
│  │  2. Check against system policy                                  │   │
│  │  3. Require user confirmation for privileged capabilities        │   │
│  │  4. Block installation if policy denies                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Execution Time:                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Validate service state is "enabled"                          │   │
│  │  2. Check tool against service.capabilities.privilegedTools      │   │
│  │  3. If privileged, require user confirmation                     │   │
│  │  4. Log all privileged tool invocations                          │   │
│  │  5. Rate limit per service                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Runtime Limits:                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  • Max executions per minute per service                         │   │
│  │  • Max concurrent executions per service                         │   │
│  │  • Tool-specific rate limits                                     │   │
│  │  • Network egress limits                                         │   │
│  │  • Execution timeout (default: 30s)                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 User Confirmation Flow

```typescript
// src/services/security/confirmation.ts

export interface ConfirmationRequest {
  serviceId: string;
  serviceName: string;
  toolName: string;
  params: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  description: string;
}

export async function requireConfirmation(request: ConfirmationRequest): Promise<boolean> {
  // Check if user has pre-approved this tool for this service
  const preApproved = await checkPreApproval(request.serviceId, request.toolName);
  if (preApproved) {
    return true;
  }

  // Send confirmation request to user's preferred channel
  const confirmation = await sendConfirmationRequest({
    title: `Service "${request.serviceName}" wants to use ${request.toolName}`,
    description: request.description,
    riskLevel: request.riskLevel,
    timeout: 300000, // 5 minutes
  });

  return confirmation.approved;
}
```

### 6.4 Sandboxing

Services execute in isolated sessions:

```typescript
interface ServiceSandbox {
  // Each service gets its own agent session
  agentId: string;
  sessionKey: string;

  // Tool allowlist based on manifest
  allowedTools: string[];

  // Skill injection based on manifest
  injectedSkills: string[];

  // Config isolation
  config: ServiceConfig;

  // Execution limits
  timeout: number;
  maxRetries: number;
}
```

---

## 7. Atomic Installation with Rollback

### 7.1 Installation Transaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ATOMIC INSTALLATION FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phase 1: VALIDATION (no side effects)                                  │
│  ─────────────────────────────────────                                  │
│  ✓ Parse and validate manifest schema                                   │
│  ✓ Check required skills are available                                  │
│  ✓ Check required tools are registered                                  │
│  ✓ Check required env vars are set                                      │
│  ✓ Validate user configuration against schema                           │
│  ✓ Check for conflicts (duplicate IDs, path collisions)                 │
│  ✗ If any check fails → return validation_error (no cleanup needed)     │
│                                                                         │
│  Phase 2: PREPARATION (reversible)                                      │
│  ─────────────────────────────────                                      │
│  • Create service agent session                                         │
│  • Generate runtime IDs                                                 │
│  • Validate tool permissions                                            │
│  • Load service skill                                                   │
│                                                                         │
│  Phase 3: RESOURCE CREATION (tracked for rollback)                      │
│  ────────────────────────────────────────────────                       │
│  • Create cron jobs → store IDs                                         │
│  • Register webhooks → store unregister fns                             │
│  • Subscribe to message events → store unsubscribe fns                  │
│  • Store configuration                                                  │
│                                                                         │
│  Phase 4: COMMIT                                                        │
│  ────────────                                                           │
│  • Persist service state as "installed"                                 │
│  • Enable triggers                                                      │
│                                                                         │
│  On Failure at any phase:                                               │
│  • Execute rollback using tracked resources                             │
│  • Delete cron jobs                                                     │
│  • Unregister webhooks                                                  │
│  • Unsubscribe from messages                                            │
│  • Delete agent session                                                 │
│  • Return install_error                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Rollback Implementation

```typescript
// src/services/installer.ts

export class ServiceInstaller {
  private rollbackStack: Array<() => Promise<void>> = [];

  async install(service: ServiceManifest, config: ServiceConfig): Promise<void> {
    const phase = new InstallationPhase();

    try {
      // Phase 1: Validation
      phase.step("validate");
      await this.validate(service, config);

      // Phase 2: Preparation
      phase.step("prepare");
      const agentId = await this.createServiceAgent(service);
      this.rollbackStack.push(() => this.deleteAgent(agentId));

      // Phase 3: Resource Creation
      phase.step("create_resources");

      if (service.trigger.type === "cron") {
        const jobId = await this.createCronJob(service, agentId);
        this.rollbackStack.push(() => this.deleteCronJob(jobId));
      }

      if (service.trigger.type === "webhook") {
        const unregister = await this.registerWebhook(service);
        this.rollbackStack.push(async () => unregister());
      }

      if (service.trigger.type === "message") {
        const unsubs = await this.subscribeMessages(service);
        this.rollbackStack.push(async () => {
          for (const unsub of unsubs) await unsub();
        });
      }

      // Phase 4: Commit
      phase.step("commit");
      await this.persistService(service, config, {
        agentId,
        state: "installed",
      });

      // Clear rollback stack on success
      this.rollbackStack = [];
    } catch (error) {
      // Execute rollback
      await this.rollback();
      throw new ServiceInstallError(phase.current, error);
    }
  }

  private async rollback(): Promise<void> {
    // Execute rollback in reverse order
    while (this.rollbackStack.length > 0) {
      const action = this.rollbackStack.pop()!;
      try {
        await action();
      } catch (e) {
        // Log rollback errors but continue
        this.logger.error("Rollback action failed", e);
      }
    }
  }
}
```

---

## 8. Service Registry & State Persistence

### 8.1 Registry Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SERVICE REGISTRY ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    ServiceRegistry                               │   │
│  │  (singleton, manages all service lifecycle)                      │   │
│  │                                                                  │   │
│  │  • In-memory service cache                                       │   │
│  │  • State machine enforcement                                     │   │
│  │  • Event publishing                                              │   │
│  │  • Coordination with external systems                            │   │
│  └────────────────────┬────────────────────────────────────────────┘   │
│                       │                                                  │
│       ┌───────────────┼───────────────┐                                 │
│       ▼               ▼               ▼                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────────┐                         │
│  │Service  │    │Service  │    │  Service    │                         │
│  │Store    │    │Installer│    │  Executor   │                         │
│  │(persist)│    │(setup)  │    │  (runtime)  │                         │
│  └────┬────┘    └─────────┘    └─────────────┘                         │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Storage Layer                                 │   │
│  │  • ~/.openclaw/services/                                         │   │
│  │    ├── {serviceId}/                                              │   │
│  │    │   ├── manifest.json       # Service manifest                │   │
│  │    │   ├── config.json         # User configuration              │   │
│  │    │   ├── state.json          # Current state & history         │   │
│  │    │   └── refs.json           # Runtime references              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Storage Structure

```
~/.openclaw/
├── services/
│   ├── daily-briefing/
│   │   ├── manifest.json       # Original manifest
│   │   ├── config.json         # User's config values
│   │   ├── state.json          # Current state + history
│   │   └── refs.json           # Cron job IDs, webhook paths
│   ├── webhook-receiver/
│   │   ├── manifest.json
│   │   ├── config.json
│   │   ├── state.json
│   │   └── refs.json
│   └── index.json              # Registry index for quick lookup
```

### 8.3 State Persistence Format

```typescript
// ~/.openclaw/services/{id}/state.json
interface ServiceStateFile {
  serviceId: string;
  state: ServiceState;
  stateHistory: Array<{
    from: ServiceState;
    to: ServiceState;
    timestamp: string;
    reason?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  executionStats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    lastError?: {
      message: string;
      timestamp: string;
      stack?: string;
    };
  };
}

// ~/.openclaw/services/{id}/refs.json
interface ServiceRefsFile {
  serviceId: string;
  agentId: string;
  cronJobIds?: string[];
  webhookPaths?: string[];
  messageSubscriptions?: Array<{
    channel: string;
    filter: string;
  }>;
}
```

### 8.4 Registry Index

```typescript
// ~/.openclaw/services/index.json
interface ServiceRegistryIndex {
  version: 1;
  services: Array<{
    id: string;
    name: string;
    state: ServiceState;
    triggerType: TriggerType;
    category?: string;
    updatedAt: string;
  }>;
}
```

---

## 9. Component Diagrams

### 9.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           SERVICE CONCEPT ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                           USER INTERFACE LAYER                               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │   │
│  │  │ Service List │  │ Setup Wizard │  │ Config Panel │  │  Dashboard   │     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │   │
│  └─────────┼────────────────┼────────────────┼────────────────┼───────────────┘   │
│            │                │                │                │                    │
│            └────────────────┴────────────────┴────────────────┘                    │
│                                     │                                                │
│                                     ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                        SERVICE REGISTRY LAYER                                │   │
│  │                                                                              │   │
│  │   ┌─────────────────────────────────────────────────────────────────────┐   │   │
│  │   │                    ServiceRegistry (Core)                            │   │   │
│  │   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │   │
│  │   │  │   Install   │  │    State    │  │   Execute   │  │   Config    │ │   │   │
│  │   │  │   Manager   │  │   Machine   │  │   Engine    │  │   Manager   │ │   │   │
│  │   │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │   │   │
│  │   └─────────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                              │   │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │   │
│  │   │ ServiceStore│  │ServiceInstaller│ │ServiceExecutor│ │SecurityGuard│       │   │
│  │   │ (persist)   │  │ (atomic ops)  │  │ (runtime)   │  │ (confirm)   │       │   │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │   │
│  │                                                                              │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                                │
│            ┌────────────────────────┼────────────────────────┐                      │
│            │                        │                        │                      │
│            ▼                        ▼                        ▼                      │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐             │
│  │   TRIGGER LAYER  │      │  EXECUTION LAYER │      │   STORAGE LAYER  │             │
│  │                  │      │                  │      │                  │             │
│  │ ┌─────────────┐  │      │ ┌─────────────┐  │      │ ┌─────────────┐  │             │
│  │ │ CronService │  │      │ │   Agent     │  │      │ │  Service    │  │             │
│  │ │  (existing) │◄─┘      │ │   Session   │  │      │ │   Store     │  │             │
│  │ └─────────────┘         │ │(service:{id})│  │      │ │ (~/.openclaw)│  │             │
│  │ ┌─────────────┐         │ └─────────────┘  │      │ └─────────────┘  │             │
│  │ │HTTP Registry│         │ ┌─────────────┐  │      │ ┌─────────────┐  │             │
│  │ │  (existing) │◄────────┤ │   Skills    │  │      │ │   Config    │  │             │
│  │ └─────────────┘         │ │  (injected) │  │      │ │   Store     │  │             │
│  │ ┌─────────────┐         │ └─────────────┘  │      │ └─────────────┘  │             │
│  │ │Hook System  │         │ ┌─────────────┐  │      └──────────────────┘             │
│  │ │  (existing) │◄────────┤ │   Tools     │  │                                    │
│  │ └─────────────┘         │ │  (existing) │  │                                    │
│  │                         │ └─────────────┘  │                                    │
│  └─────────────────────────┴──────────────────┘                                    │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SERVICE EXECUTION FLOW                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Trigger Fires (Cron/Webhook/Message)                                   │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────┐                                                    │
│  │ ServiceRegistry │                                                    │
│  │   .execute()    │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│     ┌─────┴─────┐                                                       │
│     ▼           ▼                                                       │
│ ┌───────┐   ┌─────────┐                                                 │
│ │ENABLED│   │DISABLED │ → Return (no-op)                                │
│ └───┬───┘   └─────────┘                                                 │
│     │                                                                   │
│     ▼                                                                   │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 1. SECURITY CHECK                                               │    │
│ │    • Validate service hasn't exceeded rate limits               │    │
│ │    • Check concurrent execution limits                          │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│     │                                                                   │
│     ▼                                                                   │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 2. BUILD EXECUTION CONTEXT                                      │    │
│ │    • Load service config                                        │    │
│ │    • Resolve agent session (service:{id})                       │    │
│ │    • Inject required skills into session                        │    │
│ │    • Build tool allowlist from manifest                         │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│     │                                                                   │
│     ▼                                                                   │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 3. EXECUTE SERVICE SKILL                                        │    │
│ │    • Send prompt to agent with trigger context                  │    │
│ │    • Agent uses available tools to complete task                │    │
│ │    • Privileged tools require confirmation                      │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│     │                                                                   │
│     ▼                                                                   │
│ ┌─────────────────────────────────────────────────────────────────┐    │
│ │ 4. HANDLE RESULT                                                │    │
│ │    • Update execution stats                                     │    │
│ │    • If error → transition to ERROR state                       │    │
│ │    • If success → update lastRunAt                              │    │
│ │    • Schedule next run (for cron)                               │    │
│ └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Roadmap

### Phase 1: Core Infrastructure (T5-T7)

1. **Service Types & Manifest** (T5)
   - TypeScript interfaces for ServiceManifest, ServiceInstance
   - JSON Schema validation
   - Manifest parser

2. **Service Registry** (T7)
   - In-memory registry with CRUD operations
   - File-based persistence
   - State machine implementation

3. **Service Installer** (T6)
   - Atomic installation with rollback
   - Validation pipeline
   - Resource tracking

### Phase 2: Trigger Integration (T8-T9)

4. **CronService Integration** (T9)
   - Service-owned cron jobs
   - Metadata tracking

5. **Webhook Integration** (T8)
   - Service webhook registration
   - Auth handling

6. **Message Integration** (T8)
   - Hook-based message triggers
   - Filter matching

### Phase 3: Execution & Security (T10-T11)

7. **Service Executor** (T10)
   - Agent session management
   - Skill injection
   - Tool filtering

8. **Security Model** (T11)
   - Capability declarations
   - User confirmation flow
   - Rate limiting

### Phase 4: UI & Tools (T12-T13)

9. **Service Tools** (T13)
   - service.list, service.enable, etc.

10. **Configuration Wizard** (T12)
    - CLI wizard for service setup
    - UI components

---

## 11. Appendix

### 11.1 Glossary

| Term                    | Definition                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Service**             | A user-facing automation that bundles triggers, configuration, and capabilities   |
| **Manifest**            | The `service.json` file defining a Service's metadata, triggers, and requirements |
| **ServiceRegistry**     | Central manager for Service lifecycle and state                                   |
| **ServiceInstance**     | A concrete installed Service with user configuration                              |
| **Trigger**             | Event source that causes Service execution (cron, webhook, message, web)          |
| **Capability**          | A declared requirement (skill, tool, env var)                                     |
| **Atomic Installation** | All-or-nothing installation with automatic rollback                               |
| **Service Agent**       | Dedicated agent session for Service execution (format: `service:{id}`)            |

### 11.2 References

- T1: [Service Examples](./examples.md) - 4 concrete Service use cases
- T2: [Trigger Audit](./trigger-audit.md) - Existing trigger infrastructure
- T3: [Extension Patterns](./extension-patterns.md) - How extensions integrate
- OpenClaw Skill Types: `src/agents/skills/types.ts`
- CronService: `src/cron/`
- Webhook Registry: `src/plugins/http-registry.ts`
- Hook System: `src/hooks/`

---

**End of Document**

_This architecture is ready for implementation pending user approval._
