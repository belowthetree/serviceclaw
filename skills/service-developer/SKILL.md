---
name: service-developer
description: Create, develop, and debug ServiceClaw services. Use when: (1) creating a new service from scratch, (2) implementing SCP protocol communication, (3) building service UIs with WebSocket/postMessage, (4) setting up cron tasks or webhooks, (5) troubleshooting service lifecycle issues, (6) registering action handlers for API proxy. NOT for: simple one-file edits (use edit tool), general TypeScript questions (no service-specific context), or working with skills (use skill-creator instead).
---

# Service Developer

Guidance for building services in the ServiceClaw platform using the Service Communication Protocol (SCP).

## Quick Reference

### Service Structure

```
services/{service-id}/
├── manifest.json          # Service metadata (required)
├── script/
│   ├── entry.ts          # Service entry point (required)
│   └── ...               # Other modules
├── ui/
│   ├── index.html        # UI entry (if UI needed)
│   └── ...               # UI assets
└── cron/                 # Optional: cron task configs
    └── *.json
```

### Minimal manifest.json

```json
{
  "id": "my-service",
  "name": "My Service",
  "description": "Service description",
  "version": "1.0.0",
  "entry": "script/entry.ts",
  "capabilities": {
    "network": true,
    "filesystem": true
  },
  "category": "custom"
}
```

### Inline SCP Client Pattern

```typescript
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

function createSCPClient(serviceId: string, options: { name: string; version: string }) {
  let ws: WebSocket | null = null;
  let connected = false;
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  const actionHandlers = new Map<string, (params: unknown) => unknown>();

  function send(type: string, payload: unknown, requestId?: string): void {
    if (!ws || !connected) return;
    ws.send(
      JSON.stringify({
        type,
        serviceId,
        requestId: requestId ?? randomUUID(),
        timestamp: new Date().toISOString(),
        payload,
      }),
    );
  }

  function on(event: string, handler: (data: unknown) => void): void {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
  }

  function emit(event: string, data?: unknown): void {
    handlers.get(event)?.forEach((h) => h(data));
  }

  function emitEvent(event: string, data?: unknown): void {
    send("service.event", { event, data });
  }

  function registerActionHandler(action: string, handler: (params: unknown) => unknown): void {
    actionHandlers.set(action, handler);
  }

  function callAction(action: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Action '${action}' timed out`));
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve: (data: unknown) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      send("service.action", { action, params }, requestId);
    });
  }

  async function connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`${url}?serviceId=${serviceId}`);
      const timeout = setTimeout(() => {
        ws?.close();
        reject(new Error("Timeout"));
      }, 10000);

      ws.on("open", () => {
        clearTimeout(timeout);
        connected = true;
        send("service.started", { name: options.name, version: options.version });
        emit("connected");
        resolve();
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "agent.response") {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              pendingRequests.delete(msg.requestId);
              const payload = msg.payload as {
                success: boolean;
                data?: unknown;
                error?: { message: string };
              };
              payload.success
                ? pending.resolve(payload.data)
                : pending.reject(new Error(payload.error?.message ?? "Unknown error"));
            }
          } else if (msg.type === "agent.stop-request") {
            emit("stop-requested", msg.payload);
          } else if (msg.type === "ui.event") {
            emit("ui.event", msg.payload);
          } else if (msg.type === "cron.execute") {
            emit("cron.execute", msg.payload);
          } else if (msg.type === "service.action") {
            // Handle API proxy action requests
            const action = msg.payload?.action;
            const params = msg.payload?.params;
            const requestId = msg.requestId;

            if (action && actionHandlers.has(action)) {
              try {
                const result = actionHandlers.get(action)!(params);
                send("agent.response", { success: true, data: result }, requestId);
              } catch (err) {
                send(
                  "agent.response",
                  { success: false, error: { code: 3001, message: String(err) } },
                  requestId,
                );
              }
            } else {
              send(
                "agent.response",
                { success: false, error: { code: 3000, message: `Unknown action: ${action}` } },
                requestId,
              );
            }
          }
        } catch (err) {
          console.error(`[${serviceId}] Error parsing message:`, err);
        }
      });

      ws.on("close", (code, reason) => {
        connected = false;
        emit("disconnected", { code, reason: reason.toString() });
      });

      ws.on("error", (err) => reject(err));
    });
  }

  function disconnect(): void {
    if (ws && connected) send("service.stopped", { reason: "shutdown" });
    ws?.close();
    connected = false;
  }

  return {
    connect,
    disconnect,
    on,
    emitEvent,
    callAction,
    registerActionHandler,
    isConnected: () => connected,
  };
}

// Usage
const SERVICE_ID = "my-service";
const AGENT_URL = "ws://localhost:18789/__serviceclaw__/scp";

async function main() {
  const client = createSCPClient(SERVICE_ID, { name: "My Service", version: "1.0.0" });

  client.on("connected", () => console.log("[my-service] Connected"));
  client.on("disconnected", ({ code, reason }) =>
    console.log(`[my-service] Disconnected: ${code} - ${reason}`),
  );
  client.on("stop-requested", ({ reason }) => {
    console.log(`[my-service] Stop requested: ${reason}`);
    client.disconnect();
    process.exit(0);
  });

  client.on("ui.event", async (event) => {
    const { type, messageId, payload } = event as {
      type: string;
      messageId?: string;
      payload?: unknown;
    };
    console.log("[my-service] UI event:", type, payload);

    // Handle UI events and respond back
    if (type === "action") {
      const result = await client.callAction("tools.invoke", { skill: "my-skill", input: payload });
      client.emitEvent("ui.response", { messageId, payload: result });
    }
  });

  client.on("cron.execute", (data) => {
    const { taskName, command } = data as { taskName: string; command: string };
    console.log(`[my-service] Cron task: ${taskName} - ${command}`);
    // Handle cron task execution
  });

  // Register action handler for API proxy
  client.registerActionHandler("save", (params) => {
    const { content } = params as { content: string };
    // Process and return result
    return { success: true, saved: content };
  });

  await client.connect(AGENT_URL);
  console.log("[my-service] Service started");

  process.on("SIGINT", () => {
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Service UI (index.html)

```html
<!DOCTYPE html>
<html lang="en">
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
      .btn:hover {
        background: #059669;
      }
      .result {
        margin-top: 20px;
        padding: 12px;
        border-radius: 8px;
      }
      .result.success {
        background: rgba(16, 185, 129, 0.2);
        border: 1px solid #10b981;
        color: #10b981;
      }
      .result.error {
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid #ef4444;
        color: #ef4444;
      }
    </style>
  </head>
  <body>
    <h1>My Service</h1>
    <button id="actionBtn" class="btn">Execute Action</button>
    <div id="result" class="result" style="display: none;"></div>

    <script>
      function generateId() {
        return Math.random().toString(36).substring(2, 9);
      }

      // Listen for messages from service
      window.addEventListener("message", (event) => {
        if (event.data.type === "ui.response") {
          const resultDiv = document.getElementById("result");
          resultDiv.style.display = "block";
          document.getElementById("actionBtn").disabled = false;

          if (event.data.payload?.success) {
            resultDiv.className = "result success";
            resultDiv.textContent = "Success: " + JSON.stringify(event.data.payload);
          } else {
            resultDiv.className = "result error";
            resultDiv.textContent = "Error: " + (event.data.payload?.error || "Unknown error");
          }
        }
      });

      // Send message to service
      document.getElementById("actionBtn").addEventListener("click", () => {
        document.getElementById("actionBtn").disabled = true;
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

      // Notify service that UI is ready
      window.parent.postMessage(
        {
          source: "my-service-ui",
          type: "ui.ready",
          messageId: generateId(),
        },
        "*",
      );
    </script>
  </body>
</html>
```

## Key Concepts

### Service vs Skill

| Feature       | Service                     | Skill                           |
| ------------- | --------------------------- | ------------------------------- |
| Runtime       | Long-running (process)      | Short execution (function call) |
| UI            | Has independent modal       | No independent UI               |
| Communication | Bidirectional WebSocket     | Unidirectional request-response |
| Trigger       | User start/scheduled/event  | Tool invocation                 |
| State         | Stateful (enabled/disabled) | Stateless                       |

### SCP Message Types

**Service → Agent:**

- `service.started` - Handshake after connection
- `service.stopped` - Graceful shutdown
- `service.event` - Events to UI or Agent
- `service.action` - Request Agent action

**Agent → Service:**

- `agent.response` - Response to service.action
- `agent.stop-request` - Request service shutdown
- `ui.event` - Forwarded from UI postMessage
- `cron.execute` - Cron task trigger

### WebSocket Endpoint

```
ws://localhost:18789/__serviceclaw__/scp?serviceId={service-id}
```

### Service API Proxy (HTTP)

For simple request-response patterns:

```javascript
// UI-side
const response = await fetch("/__serviceclaw__/services/my-service/api/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ params: { content: "data" } }),
});
const result = await response.json();
```

```typescript
// Service-side - register action handler
client.registerActionHandler("save", (params) => {
  const { content } = params as { content: string };
  return saveToFile(content);
});
```

## Cron Tasks

### Single Trigger (manifest.json)

```json
{
  "trigger": {
    "type": "cron",
    "schedule": "0 */6 * * *",
    "timezone": "America/New_York"
  }
}
```

### Multiple Tasks (cron/ directory)

Create `cron/*.json` files:

```json
{
  "name": "cleanup",
  "schedule": "0 2 * * *",
  "command": "cleanup-temp-files",
  "enabled": true,
  "timezone": "UTC",
  "description": "Clean up temporary files daily at 2 AM"
}
```

Handle in service:

```typescript
client.on("cron.execute", (data) => {
  const { taskName, command } = data as { taskName: string; command: string };

  switch (command) {
    case "cleanup-temp-files":
      handleCleanup();
      break;
    case "sync-data":
      handleSync();
      break;
  }
});
```

## Capabilities Reference

```json
{
  "capabilities": {
    "network": true, // Network access
    "filesystem": true, // File system access
    "shell": true, // Shell command execution
    "browser": true, // Browser automation
    "webhook": true, // Webhook receiving
    "cron": true, // Scheduled tasks
    "message": true, // Message channel access
    "web": true, // Web UI serving
    "privilegedTools": [], // Privileged tool names
    "requiresConfirmation": [] // Tools requiring confirmation
  }
}
```

## Trigger Types

```json
// Cron trigger
{
  "trigger": {
    "type": "cron",
    "schedule": "0 */6 * * *",
    "timezone": "America/New_York"
  }
}

// Webhook trigger
{
  "trigger": {
    "type": "webhook",
    "path": "/my-webhook",
    "methods": ["POST"],
    "auth": { "type": "token", "secret": "${WEBHOOK_SECRET}" }
  }
}

// Message trigger
{
  "trigger": {
    "type": "message",
    "channels": ["telegram", "discord"],
    "filters": { "keywords": ["todo", "task"] }
  }
}

// Web trigger
{
  "trigger": { "type": "web", "path": "/my-page" }
}
```

## Service Lifecycle States

```
pending → validating → installed → enabled → running
                              ↓         ↓
                        disabled    error
```

Events to handle:

- `connected` - Service connected to Agent
- `disconnected` - Connection lost
- `stop-requested` - Agent requesting shutdown
- `reconnecting` - Attempting reconnection
- `ui.event` - UI sent a message
- `cron.execute` - Cron task fired

## Best Practices

### Error Handling

```typescript
client.on("error", (error) => {
  console.error("[my-service] Error:", error);
  client.emitEvent("ui.response", {
    type: "error",
    payload: { message: error.message },
  });
});
```

### Graceful Shutdown

```typescript
let isShuttingDown = false;

async function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("[my-service] Shutting down...");
  await saveState();
  client.disconnect();
  process.exit(0);
}

client.on("stop-requested", handleShutdown);
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
```

### Reconnection

```typescript
const client = createSCPClient(SERVICE_ID, {
  name: SERVICE_NAME,
  version: SERVICE_VERSION,
  reconnect: {
    enabled: true,
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 16000,
  },
});

client.on("reconnecting", ({ attempt, maxRetries, delay }) => {
  console.log(`[my-service] Reconnecting... ${attempt}/${maxRetries} in ${delay}ms`);
});
```

## Troubleshooting

### Service Won't Start

- Check `manifest.json` is valid JSON
- Verify `entry.ts` path is correct
- Check Gateway logs: `serviceclaw gateway logs`

### UI Won't Load

- Confirm `ui.entry` path exists
- Check browser console for errors
- Verify CSP allows iframe loading

### Communication Fails

- Verify WebSocket URL: `ws://localhost:18789/__serviceclaw__/scp`
- Check `serviceId` matches in URL and client
- Ensure message format is correct JSON

### Common CLI Commands

```bash
# List services
serviceclaw service list

# View service logs
serviceclaw service logs my-service

# Start service manually
serviceclaw service start my-service

# Check service status
curl http://localhost:18789/__serviceclaw__/services
```

## Configuration Schema (manifest.json)

| Field          | Type   | Required | Description                                                              |
| -------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `id`           | string | Yes      | Unique identifier (kebab-case)                                           |
| `name`         | string | Yes      | Display name                                                             |
| `description`  | string | Yes      | Description                                                              |
| `version`      | string | Yes      | Semantic version                                                         |
| `entry`        | string | Yes      | Entry file path (relative)                                               |
| `ui.entry`     | string | No       | UI HTML file path                                                        |
| `capabilities` | object | No       | Capability flags                                                         |
| `category`     | string | No       | productivity, communication, monitoring, automation, integration, custom |
| `config`       | object | No       | User configuration schema                                                |
| `trigger`      | object | No       | Trigger configuration (cron, webhook, message, web)                      |
| `execution`    | object | No       | Execution config (timeout, retries)                                      |
| `requires`     | object | No       | Dependencies (skills, tools, services, env, config)                      |
