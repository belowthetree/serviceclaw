# OpenClaw Service Development Guide

> This guide helps developers understand and build services for OpenClaw using the Service Communication Protocol (SCP).

## Table of Contents

1. [Service Concepts](#service-concepts)
2. [Architecture Overview](#architecture-overview)
3. [Creating a Service](#creating-a-service)
4. [Service Lifecycle](#service-lifecycle)
5. [SCP Protocol Communication](#scp-protocol-communication)
6. [UI Integration](#ui-integration)
7. [Agent Integration](#agent-integration)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Service Concepts

### What is a Service?

A **Service** in OpenClaw is a long-running component that can:

- Provide a custom UI (via WebView modal)
- Communicate bidirectionally with the Agent (SCP protocol)
- Execute scheduled tasks in the background
- Listen to webhook events
- Subscribe to message channels

### Service vs Skill

| Feature       | Service                     | Skill                           |
| ------------- | --------------------------- | ------------------------------- |
| Runtime       | Long-running (process)      | Short execution (function call) |
| UI            | Has independent modal       | No independent UI               |
| Communication | Bidirectional WebSocket     | Unidirectional request-response |
| Trigger       | User start/scheduled/event  | Tool invocation                 |
| State         | Stateful (enabled/disabled) | Stateless                       |

### Service Use Cases

- **Configuration Wizard**: Complex configuration interface with forms
- **Monitoring Dashboard**: Real-time data display (weather, stocks, system status)
- **Scheduled Tasks**: Periodic checks and notifications
- **Message Processing**: Listen to channel messages and auto-respond
- **Webhook Handling**: Receive external HTTP callbacks

---

## Architecture Overview

### File Structure

```
services/{service-id}/                    # Service directory
├── manifest.json                         # Service metadata (required)
├── script/
│   ├── entry.ts                          # Service entry (required)
│   ├── types.ts                          # Type definitions
│   └── ...                               # Other modules
└── ui/
    ├── index.html                        # UI entry (if UI needed)
    ├── app.js                            # UI logic
    └── styles.css                        # Styles
```

### Core Components

1. **ServiceRegistry** (`src/services/registry.ts`)
   - Manages service state (enabled/disabled/installed)
   - Persists to `~/.openclaw/services/`

2. **ServiceLifecycleManager** (`src/services/lifecycle.ts`)
   - Starts/stops service processes
   - Monitors service health
   - Handles service crash recovery

3. **SCPServer** (`src/services/scp-server.ts`)
   - WebSocket server (`ws://localhost:18789/__openclaw__/scp`)
   - Handles service connections and message routing
   - Implements SCP protocol

4. **ServiceModal** (`ui/src/components/service-modal.ts`)
   - Lit custom element `<service-modal>`
   - Loads service UI in iframe
   - Lifecycle synchronization

5. **LifecycleSyncManager** (`ui/src/services/lifecycle-sync.ts`)
   - Synchronizes modal state with service lifecycle
   - Handles service start/stop events

---

## Creating a Service

### 1. Create Directory Structure

```bash
mkdir -p services/my-service/{script,ui}
touch services/my-service/manifest.json
touch services/my-service/script/entry.ts
touch services/my-service/ui/index.html
```

### 2. Write manifest.json

```json
{
  "id": "my-service",
  "name": "My Service",
  "description": "Service description",
  "version": "1.0.0",
  "entry": "script/entry.ts",
  "ui": {
    "entry": "ui/index.html"
  },
  "capabilities": {
    "network": true,
    "filesystem": true,
    "cron": true
  },
  "category": "productivity",
  "trigger": {
    "type": "cron",
    "schedule": "0 */6 * * *"
  },
  "config": {
    "apiKey": {
      "type": "secret",
      "description": "API Key",
      "required": true
    }
  }
}
```

**Field Reference:**

| Field          | Type   | Description                                                                        |
| -------------- | ------ | ---------------------------------------------------------------------------------- |
| `id`           | string | Unique identifier (kebab-case, required)                                           |
| `name`         | string | Display name                                                                       |
| `description`  | string | Description                                                                        |
| `version`      | string | Semantic version (semver)                                                          |
| `entry`        | string | Entry file path (relative)                                                         |
| `ui.entry`     | string | UI HTML file path (relative)                                                       |
| `capabilities` | object | Capability flags (see below)                                                       |
| `category`     | string | Category: productivity, communication, monitoring, automation, integration, custom |
| `config`       | object | User configuration schema                                                          |
| `trigger`      | object | Trigger configuration (cron, webhook, message, web)                                |
| `execution`    | object | Execution config (timeout, retries, etc.)                                          |
| `requires`     | object | Dependencies (skills, tools, services, env, config)                                |

**Capabilities (Object Format):**

```typescript
{
  "network": true,           // Network access
  "filesystem": true,        // File system access
  "shell": true,             // Shell command execution
  "browser": true,           // Browser automation
  "webhook": true,           // Webhook receiving
  "cron": true,              // Scheduled tasks
  "message": true,           // Message channel access
  "web": true,               // Web UI serving
  "privilegedTools": [],     // Privileged tool names
  "requiresConfirmation": [] // Tools requiring confirmation
}
```

**Trigger Types:**

```typescript
// Cron trigger
{
  "type": "cron",
  "schedule": "0 */6 * * *",
  "timezone": "America/New_York"
}

// Webhook trigger
{
  "type": "webhook",
  "path": "/my-webhook",
  "methods": ["POST"],
  "auth": {
    "type": "token",
    "secret": "${WEBHOOK_SECRET}"
  }
}

// Message trigger
{
  "type": "message",
  "channels": ["telegram", "discord"],
  "filters": {
    "keywords": ["todo", "task"],
    "fromUsers": ["@username"]
  }
}

// Web trigger
{
  "type": "web",
  "path": "/my-page"
}
```

### 3. Write Service Script (entry.ts)

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

const SERVICE_ID = "my-service";
const SERVICE_NAME = "My Service";
const SERVICE_VERSION = "1.0.0";
const AGENT_URL = "ws://localhost:18789/__openclaw__/scp";

async function main() {
  // 1. Create client
  const client = new ServiceClient(SERVICE_ID, {
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    actionTimeout: 30000,
    reconnect: {
      enabled: true,
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 16000,
    },
  });

  // 2. Set up event handlers
  client.on("connected", () => {
    console.log("[my-service] Connected to Agent");
  });

  client.on("disconnected", ({ code, reason }) => {
    console.log(`[my-service] Disconnected: ${code} - ${reason}`);
  });

  client.on("stop-requested", ({ reason, force }) => {
    console.log(`[my-service] Stop requested: ${reason}`);
    handleShutdown();
  });

  // 3. Handle UI events
  client.on("ui.event", async (event) => {
    console.log("[my-service] UI event:", event.type, event.payload);

    switch (event.type) {
      case "action":
        // Call Agent action
        const result = await client.callAction("tools.invoke", {
          skill: "my-skill",
          input: event.payload,
        });

        // Send result back to UI
        client.emitEvent("ui.response", {
          messageId: event.messageId,
          payload: result,
        });
        break;
    }
  });

  // 4. Connect to Agent
  await client.connect(AGENT_URL);
  console.log("[my-service] Service started");

  // 5. Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[my-service] Shutting down...");
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
```

### 4. Write UI (index.html)

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>My Service</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        background: #1a1a2e;
        color: #e4e4e7;
        padding: 20px;
      }
      .btn {
        background: #10b981;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h1>My Service</h1>
    <button id="actionBtn" class="btn">Execute Action</button>
    <div id="status"></div>

    <script>
      // Listen for messages from service
      window.addEventListener("message", (event) => {
        if (event.data.type === "ui.response") {
          document.getElementById("status").textContent =
            "Result: " + JSON.stringify(event.data.payload);
        }
      });

      document.getElementById("actionBtn").addEventListener("click", () => {
        // Send message to parent (service)
        window.parent.postMessage(
          {
            source: "my-service-ui",
            type: "action",
            messageId: generateId(),
            payload: { action: "doSomething" },
          },
          "*",
        );
      });

      function generateId() {
        return Math.random().toString(36).substring(2, 9);
      }
    </script>
  </body>
</html>
```

---

## 5. HelloWorld Service - Complete Example

This is a minimal complete service example that demonstrates the basic structure. The HelloWorld service opens a welcome page and logs "helloworld" when connected to the Agent.

### File Structure

```
services/helloworld/
├── manifest.json
├── script/
│   └── entry.ts
└── ui/
    └── index.html
```

### manifest.json

```json
{
  "id": "helloworld",
  "name": "HelloWorld",
  "description": "A simple welcome service that demonstrates basic SCP integration",
  "version": "1.0.0",
  "entry": "script/entry.ts",
  "ui": {
    "entry": "ui/index.html"
  },
  "capabilities": {
    "network": true
  },
  "category": "custom"
}
```

**Key fields explained:**

- `id`: Unique identifier for the service (must match the directory name)
- `entry`: Path to the main TypeScript file (relative to service root)
- `ui.entry`: Path to the UI HTML file
- `capabilities.network`: Required for WebSocket connection to the Agent

### script/entry.ts

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

const SERVICE_ID = "helloworld";
const SERVICE_NAME = "HelloWorld";
const SERVICE_VERSION = "1.0.0";
const AGENT_URL = "ws://localhost:18789/__openclaw__/scp";

async function main() {
  // Create service client
  const client = new ServiceClient(SERVICE_ID, {
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    actionTimeout: 30000,
    reconnect: {
      enabled: true,
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 16000,
    },
  });

  // Set up event handlers
  client.on("connected", () => {
    console.log("helloworld"); // Logs when SCP connects to agent
  });

  client.on("disconnected", ({ code, reason }) => {
    console.log(`[${SERVICE_ID}] Disconnected: ${code} - ${reason}`);
  });

  client.on("stop-requested", ({ reason, force }) => {
    console.log(`[${SERVICE_ID}] Stop requested: ${reason}`);
    handleShutdown();
  });

  // Handle UI events (if any)
  client.on("ui.event", async (event) => {
    console.log(`[${SERVICE_ID}] UI event:`, event.type);
  });

  // Connect to Agent
  await client.connect(AGENT_URL);
  console.log(`[${SERVICE_ID}] Service started`);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log(`[${SERVICE_ID}] Shutting down...`);
    client.disconnect();
    process.exit(0);
  });
}

async function handleShutdown(): Promise<void> {
  console.log(`[${SERVICE_ID}] Performing cleanup...`);
  process.exit(0);
}

main().catch(console.error);
```

**Key concepts:**

- `ServiceClient`: Manages WebSocket connection to the Agent
- `connected` event: Triggered when SCP successfully connects - this is where we log "helloworld"
- `AGENT_URL`: WebSocket endpoint for SCP protocol
- Graceful shutdown handlers for SIGINT and stop-requested events

### ui/index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HelloWorld</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        background: #1a1a2e;
        color: #e4e4e7;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
      }
      .welcome {
        text-align: center;
        padding: 40px;
      }
      h1 {
        color: #10b981;
        font-size: 2.5rem;
        margin-bottom: 1rem;
      }
      p {
        color: #a1a1aa;
        font-size: 1.1rem;
      }
      .status {
        margin-top: 20px;
        padding: 10px 20px;
        background: #10b981;
        color: white;
        border-radius: 6px;
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <div class="welcome">
      <h1>👋 Hello World!</h1>
      <p>Welcome to your first OpenClaw service.</p>
      <div class="status">Connected to Agent</div>
    </div>

    <script>
      // Listen for messages from the service
      window.addEventListener("message", (event) => {
        if (event.data.type === "ui.response") {
          console.log("Received from service:", event.data);
        }
      });

      // Notify service that UI is ready
      window.parent.postMessage(
        {
          source: "helloworld-ui",
          type: "ui.ready",
          messageId: Math.random().toString(36).substring(2, 9),
        },
        "*",
      );
    </script>
  </body>
</html>
```

**Key concepts:**

- Styled to match OpenClaw's dark theme
- Uses `window.parent.postMessage()` to communicate with the service
- Listens for `message` events from the service via `window.addEventListener`
- Displays connection status to the user

### How to Use

1. **Create the directory structure** in your services folder:

   ```bash
   mkdir -p services/helloworld/{script,ui}
   ```

2. **Copy the files** shown above into their respective locations.

3. **Restart the gateway** to discover the new service:

   ```bash
   openclaw gateway restart
   ```

4. **Enable the service** in the OpenClaw UI and click "Run" to see the welcome page.

5. **Check the logs** to see "helloworld" output when the service connects.

---

## Service Lifecycle

### State Transitions

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │ Install/Validate
                           ▼
                    ┌─────────────┐
       ┌────────────│  validating │────────────┐
       │            └──────┬──────┘            │
       │ Validation failed │ Validation passed │
       ▼                   ▼                   │
┌─────────────┐    ┌─────────────┐            │
│validation_  │    │  installed  │            │
│   error     │    └──────┬──────┘            │
└─────────────┘           │                   │
                          │ Enable            │
                          ▼                   │
                   ┌─────────────┐           │
          ┌───────│   enabled   │───────┐  │
          │       └──────┬──────┘       │  │
          │ Disable      │              │  │
          ▼              │              │  │
   ┌─────────────┐       │              │  │
   │   disabled  │       │              │  │
   └──────┬──────┘       │              │  │
          └──────────────┘              │  │
                                        │  │
          ┌─────────────────────────────┘  │
          │ Error                          │
          ▼                                │
   ┌─────────────┐                        │
   │    error    │────────────────────────┘
   └─────────────┘
```

### Lifecycle Events

Services can listen to lifecycle events:

```typescript
// Service started
client.on("connected", () => {
  console.log("Service connected to Agent");
});

// Service stopped
client.on("disconnected", ({ code, reason }) => {
  console.log(`Service disconnected: ${code} - ${reason}`);
});

// Reconnecting
client.on("reconnecting", ({ attempt, maxRetries, delay }) => {
  console.log(`Reconnecting... ${attempt}/${maxRetries} in ${delay}ms`);
});

// Stop requested
client.on("stop-requested", ({ reason, force }) => {
  console.log(`Stop requested: ${reason}`);
  if (force) {
    process.exit(0);
  }
  // Perform cleanup...
  client.disconnect();
});
```

---

## SCP Protocol Communication

### Protocol Overview

**SCP (Service Communication Protocol)** is the communication protocol between services and the Agent:

- Based on WebSocket
- Bidirectional message passing
- JSON format
- Supports request-response and event patterns

### WebSocket Endpoint

```
ws://localhost:18789/__openclaw__/scp?serviceId={service-id}
```

### Message Types

**Service-to-Agent Messages:**

```typescript
// Service started
{
  type: "service.started",
  payload: {
    name: string;
    version: string;
  }
}

// Service stopped
{
  type: "service.stopped",
  payload: {
    reason: "shutdown" | "error" | "disconnected";
  }
}

// Service event
{
  type: "service.event",
  payload: {
    event: string;
    data: unknown;
  }
}

// Service action request
{
  type: "service.action",
  requestId: string;
  payload: {
    action: string;
    params: unknown;
  }
}
```

**Agent-to-Service Messages:**

```typescript
// Agent response
{
  type: "agent.response",
  requestId: string;
  payload: {
    success: boolean;
    data?: unknown;
    error?: {
      code: number;
      message: string;
      details?: Record<string, unknown>;
    };
  }
}

// Stop request
{
  type: "agent.stop-request",
  payload: {
    reason: string;
    force?: boolean;
  }
}
```

### ServiceClient API

```typescript
// Create client
const client = new ServiceClient(serviceId: string, options?: ServiceClientOptions);

// Connect
await client.connect(url: string): Promise<void>

// Disconnect
client.disconnect(): void

// Emit event
client.emitEvent(event: string, payload?: unknown): void

// Call action
const result = await client.callAction(action: string, params?: unknown): Promise<unknown>

// Event handling
client.on(event: string, handler: EventHandler): this
client.off(event: string, handler?: EventHandler): this

// Status
client.isConnected(): boolean
client.getReconnectAttempts(): number
```

**ServiceClientOptions:**

| Option                   | Type    | Default           | Description                     |
| ------------------------ | ------- | ----------------- | ------------------------------- |
| `name`                   | string  | 'unknown-service' | Service name                    |
| `version`                | string  | '0.0.0'           | Service version                 |
| `actionTimeout`          | number  | 30000             | Action timeout (ms)             |
| `reconnect.enabled`      | boolean | true              | Enable reconnection             |
| `reconnect.maxRetries`   | number  | 5                 | Max reconnection attempts       |
| `reconnect.initialDelay` | number  | 1000              | Initial reconnection delay (ms) |
| `reconnect.maxDelay`     | number  | 16000             | Max reconnection delay (ms)     |

**ServiceClient Events:**

| Event            | Payload                          | Description             |
| ---------------- | -------------------------------- | ----------------------- |
| `connected`      | -                                | Connected to Agent      |
| `disconnected`   | `{ code, reason }`               | Disconnected from Agent |
| `error`          | `Error`                          | Error occurred          |
| `reconnecting`   | `{ attempt, maxRetries, delay }` | Reconnecting            |
| `stop-requested` | `{ reason, force }`              | Stop requested by Agent |

---

## UI Integration

### Service Modal

When the user clicks the service card's "Run" button:

1. **Create Modal**: `<service-modal>` element
2. **Load UI**: iframe loads `/__openclaw__/services/{serviceId}/{ui.entry}`
3. **Start Service**: Automatically starts if not running
4. **Bidirectional Communication**:
   - UI → Service: `window.parent.postMessage`
   - Service → UI: `client.emitEvent("ui.response", ...)`

### From UI to Service

```javascript
// UI code
function callService(action, data) {
  window.parent.postMessage(
    {
      source: "my-service-ui",
      type: action,
      messageId: generateId(),
      payload: data,
    },
    "*",
  );
}

// Listen for service responses
window.addEventListener("message", (event) => {
  if (event.data.type === "ui.response") {
    handleResponse(event.data);
  }
});
```

### From Service to UI

```typescript
// Service code
function notifyUI(event: string, data: any) {
  client.emitEvent("ui.response", {
    type: event,
    payload: data,
  });
}
```

---

## Agent Integration

### Adding Service Handlers

To add service-related functionality to the Agent, modify these locations:

1. **Service HTTP Routes** (`src/gateway/services-http.ts`)
   - Add new service endpoints
   - Handle service static files

2. **Service WebSocket Messages** (`src/services/scp-server.ts`)
   - Add new action handlers
   - Extend SCP protocol

3. **Service Lifecycle** (`src/services/lifecycle.ts`)
   - Add lifecycle hooks
   - Custom start/stop logic

4. **UI Integration** (`ui/src/services/lifecycle-sync.ts`)
   - Add modal event handling
   - Custom UI behavior

### Extending Example

Add a custom action handler:

```typescript
// src/services/scp-server.ts

// Register action handler
server.on("service.action", async (connection, message) => {
  const { action, params } = message.payload;

  if (action === "custom.action") {
    // Execute custom logic
    const result = await doSomething(params);

    // Return result
    connection.send({
      type: "agent.response",
      requestId: message.requestId,
      payload: {
        success: true,
        data: result,
      },
    });
  }
});
```

---

## Best Practices

### 1. Error Handling

```typescript
client.on("error", (error) => {
  console.error("[my-service] Error:", error);

  // Notify UI
  client.emitEvent("ui.response", {
    type: "error",
    payload: { message: error.message },
  });
});

// Wrap action calls in try-catch
try {
  const result = await client.callAction("some-action", params);
} catch (error) {
  console.error("Action failed:", error.message);
  // Handle error...
}
```

### 2. Configuration Validation

```typescript
function validateConfig(config: any): boolean {
  if (!config.apiKey) {
    throw new Error("API Key is required");
  }
  return true;
}
```

### 3. State Management

```typescript
class ServiceState {
  private data = new Map();

  async load() {
    const saved = await client.callAction("storage.get", { key: "state" });
    if (saved) {
      this.data = new Map(Object.entries(saved));
    }
  }

  async save() {
    await client.callAction("storage.set", {
      key: "state",
      value: Object.fromEntries(this.data),
    });
  }
}
```

### 4. Graceful Shutdown

```typescript
let isShuttingDown = false;

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Shutting down...");

  // Save state
  await state.save();

  // Disconnect
  client.disconnect();

  process.exit(0);
}

process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
```

### 5. Debugging Tips

- Use `console.log` for debug output
- Display connection status in UI
- Listen to all events and log them
- Use ServiceClient reconnect options

---

## Troubleshooting

### Common Issues

**1. Service Won't Start**

- Check manifest.json format is valid JSON
- Verify entry.ts path is correct (relative)
- Check Agent logs: `openclaw gateway logs`

**2. UI Won't Load**

- Confirm `ui.entry` path is correct
- Check file exists in service directory
- Check browser console for errors

**3. Communication Fails**

- Verify WebSocket URL: `ws://localhost:18789/__openclaw__/scp`
- Check serviceId matches in URL and client
- Verify message format is correct

**4. Modal Won't Display**

- Check CSP configuration (`frame-ancestors 'self'`)
- Confirm X-Frame-Options is SAMEORIGIN
- Check console for errors

### Debug Commands

```bash
# List services
openclaw service list

# View service logs
openclaw service logs my-service

# Start service manually
openclaw service start my-service

# View Agent logs
openclaw gateway logs

# Check service status
curl http://localhost:18789/__openclaw__/services
```

---

## Reference Resources

- [SCP Protocol Specification](../docs/scp-protocol-v1.md)
- [Service SDK](../packages/service-sdk/)
- [Example Service: HelloWorld](../services/helloworld/)
- [Example Service: Todo](../services/todo-service/)
- [Example Service: Weather Alert](../services/weather-alert-service/)
- [Example Service: Calendar](../services/calendar-service/)

---

## Quick Checklist

Before adding a new service, ensure:

- [ ] manifest.json format is correct (valid JSON)
- [ ] entry.ts uses ServiceClient correctly
- [ ] UI files exist (if needed)
- [ ] Service directory is in `~/.openclaw/services/`
- [ ] Restart gateway to discover new service
- [ ] Enable service in UI
- [ ] Click "Run" to test modal

---

_Last Updated: 2025-03-14_
_Author: OpenClaw Agent_
