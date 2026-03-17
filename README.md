# 🦞 ServiceClaw — Service-Based AI Agent Platform

<p align="center">
  <strong>Long-running Services. Bidirectional Communication. Stateful Intelligence.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a> | English
</p>

**ServiceClaw** is a service-based AI agent platform built on the **Service Communication Protocol (SCP)**. Unlike traditional function-call skills, Services are long-running components that maintain state, provide custom UIs, and communicate bidirectionally with the Agent.

> **Relationship to OpenClaw**: ServiceClaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw) that replaces the skill-centric model with a **service-centric architecture**. While OpenClaw focuses on short-lived tool invocations, ServiceClaw treats Services as first-class citizens — persistent, stateful, and interactive.

---

## What is a Service?

A **Service** in ServiceClaw is a long-running component that can:

| Capability                         | Description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| 🖥️ **Custom UI**                   | Provide a dedicated WebView modal via `ui/`                   |
| 🔄 **Bidirectional Communication** | Real-time WebSocket communication with the Agent via SCP      |
| ⏰ **Scheduled Tasks**             | Execute cron-based background jobs                            |
| 📡 **Webhook Events**              | Listen to and process external HTTP callbacks                 |
| 💬 **Message Channels**            | Subscribe to and respond on messaging channels                |
| 💾 **Stateful**                    | Maintain state across interactions (enabled/disabled/running) |

### Service vs Skill

| Feature           | Service                        | Skill                           |
| ----------------- | ------------------------------ | ------------------------------- |
| **Runtime**       | Long-running process           | Short function execution        |
| **UI**            | Has independent modal          | No independent UI               |
| **Communication** | Bidirectional WebSocket (SCP)  | Unidirectional request-response |
| **Trigger**       | User start / scheduled / event | Tool invocation                 |
| **State**         | Stateful                       | Stateless                       |

---

## Quick Start

### 1. Install ServiceClaw (Local Build)

```bash
git clone https://github.com/serviceclaw/serviceclaw.git
cd serviceclaw

pnpm install
pnpm build

# The CLI is now available at ./dist/cli.js
# You can link it globally or use ./dist/cli.js directly
pnpm link --global
```

### 2. Start the Gateway

```bash
serviceclaw gateway --port 18789 --verbose
```

### 3. Create Your First Service

```bash
mkdir -p services/hello-service/{script,ui}
```

**`services/hello-service/manifest.json`:**

```json
{
  "id": "hello-service",
  "name": "Hello Service",
  "description": "A simple welcome service demonstrating SCP integration",
  "version": "1.0.0",
  "entry": "script/entry.ts",
  "ui": {
    "entry": "ui/index.html"
  },
  "capabilities": {
    "network": true,
    "filesystem": true
  },
  "category": "custom"
}
```

**`services/hello-service/script/entry.ts`:**

```typescript
import { ServiceClient } from "@serviceclaw/service-sdk";

const SERVICE_ID = "hello-service";
const AGENT_URL = "ws://localhost:18789/__serviceclaw__/scp";

async function main() {
  const client = new ServiceClient(SERVICE_ID, {
    name: "Hello Service",
    version: "1.0.0",
  });

  client.on("connected", () => {
    console.log("[hello-service] Connected to Agent");
  });

  client.on("ui.event", async (event) => {
    console.log("[hello-service] UI event:", event.type);

    // Respond back to UI
    client.emitEvent("ui.response", {
      messageId: event.messageId,
      payload: { status: "received", data: event.payload },
    });
  });

  await client.connect(AGENT_URL);
  console.log("[hello-service] Service started");
}

main().catch(console.error);
```

### 4. Enable and Run

```bash
# The Gateway auto-discovers services in ./services/
serviceclaw services list

# Enable your service
serviceclaw services enable hello-service

# Open the service UI
serviceclaw services run hello-service
```

---

## Service Communication Protocol (SCP)

SCP is the heart of ServiceClaw — a WebSocket-based protocol enabling rich bidirectional communication between Services and the Agent.

### WebSocket Endpoint

```
ws://localhost:18789/__serviceclaw__/scp?serviceId={service-id}
```

### Message Types

**Service → Agent:**

```typescript
// Service started
{ type: "service.started", payload: { name, version } }

// Service stopped
{ type: "service.stopped", payload: { reason } }

// Service event (to UI or Agent)
{ type: "service.event", payload: { event, data } }

// Action request
{ type: "service.action", requestId, payload: { action, params } }
```

**Agent → Service:**

```typescript
// Agent response
{ type: "agent.response", requestId, payload: { success, data, error } }

// Stop request
{ type: "agent.stop-request", payload: { reason, force } }

// UI event (forwarded from UI postMessage)
{ type: "ui.event", payload: { type, messageId, payload } }
```

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ServiceClaw Gateway                    │
│                    (Control Plane + SCP Server)             │
└──────────────┬──────────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────┐         ┌──────────┐
│ Service │◄───────►│   Agent  │
│  (SCP)  │ WebSocket         │
└────┬────┘         └──────────┘
     │
     ▼
┌─────────┐
│   UI    │  (iframe via /__serviceclaw__/services/)
│(WebView)│
└─────────┘
```

### Core Components

| Component                   | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| **ServiceRegistry**         | Manages service state (pending/installed/enabled/disabled/error) |
| **ServiceLifecycleManager** | Starts/stops/monitors service processes                          |
| **SCPServer**               | WebSocket server implementing the SCP protocol                   |
| **ServiceModal**            | Lit-based `<service-modal>` component for UI hosting             |
| **LifecycleSyncManager**    | Synchronizes modal state with service lifecycle                  |

---

## Service Lifecycle

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
          │ Disable      │ Start        │  │
          ▼              ▼              │  │
   ┌─────────────┐  ┌─────────────┐    │  │
   │   disabled  │  │   running   │────┘  │
   └─────────────┘  └──────┬──────┘       │
                           │ Error        │
                           ▼              │
                    ┌─────────────┐      │
                    │    error    │──────┘
                    └─────────────┘
```

---

## Service Capabilities

Define what your service can do in `manifest.json`:

```json
{
  "capabilities": {
    "network": true, // Network access
    "filesystem": true, // File system access
    "shell": true, // Shell command execution
    "browser": true, // Browser automation
    "webhook": true, // Receive webhooks
    "cron": true, // Scheduled tasks
    "message": true, // Message channel access
    "web": true, // Web UI serving
    "privilegedTools": [], // Privileged tool names
    "requiresConfirmation": [] // Tools requiring confirmation
  }
}
```

### Trigger Types

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
    "methods": ["POST"]
  }
}

// Message trigger
{
  "trigger": {
    "type": "message",
    "channels": ["telegram", "discord"],
    "filters": {
      "keywords": ["todo", "task"]
    }
  }
}
```

---

## UI Integration

Services can provide rich UIs that communicate bidirectionally with the backend:

### UI → Service

```javascript
// In your service UI (ui/index.html)
window.parent.postMessage(
  {
    source: "my-service-ui",
    type: "save",
    messageId: generateId(),
    payload: { content: "user input" },
  },
  "*",
);
```

### Service → UI

```typescript
// In your service script
client.emitEvent("ui.response", {
  type: "save.result",
  payload: { success: true, path: "/data/file.txt" },
});
```

### Service API Proxy

For simpler request-response patterns, use the HTTP API proxy:

```javascript
// UI-side
const response = await fetch("/__serviceclaw__/services/my-service/api/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ params: { content } }),
});
```

```typescript
// Service-side
client.registerActionHandler("save", (params) => {
  const { content } = params;
  return saveToFile(content);
});
```

---

## Service SDK

### Installation

```bash
cd services/my-service
npm install @serviceclaw/service-sdk
```

### ServiceClient API

```typescript
const client = new ServiceClient(serviceId, {
  name: "My Service",
  version: "1.0.0",
  actionTimeout: 30000,
  reconnect: {
    enabled: true,
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 16000,
  },
});

// Event handling
client.on("connected", () => {});
client.on("disconnected", ({ code, reason }) => {});
client.on("stop-requested", ({ reason, force }) => {});
client.on("ui.event", (event) => {});

// Actions
await client.connect(url);
client.disconnect();
client.emitEvent(event, data);
const result = await client.callAction(action, params);
```

---

## Development

### From Source

```bash
git clone https://github.com/serviceclaw/serviceclaw.git
cd serviceclaw

pnpm install
pnpm build

# Run with services directory
serviceclaw gateway --services ./services
```

### Service Development Mode

```bash
# Auto-reload service on changes
serviceclaw services dev hello-service

# Watch service logs
serviceclaw services logs hello-service --follow
```

---

## Examples

### HelloWorld Service

A minimal complete service with file persistence:

```
services/helloworld/
├── manifest.json
├── script/
│   └── entry.ts      # SCP client + file operations
└── ui/
    └── index.html    # Styled UI with postMessage
```

See [HelloWorld Example](docs/services/helloworld-example.md) for full code.

### Configuration Wizard

Complex multi-step configuration with form validation:

- Custom UI with form components
- Validation via `service.action` calls
- Settings persistence via Agent storage

### Monitoring Dashboard

Real-time data display service:

- WebSocket pushes from Service to UI
- Background data collection
- Scheduled refresh via cron trigger

---

## Configuration

### Minimal Config

```json
{
  "agent": {
    "model": "anthropic/claude-opus-4-6"
  },
  "services": {
    "directory": "./services",
    "autoEnable": false
  }
}
```

### Service Discovery

Services are auto-discovered from the configured directory:

```bash
~/.serviceclaw/services/     # User services
./services/                   # Workspace services (preferred)
```

---

## Docs

- [Service Development Guide](docs/services/agent-development-guide.md) — Complete guide to building services
- [SCP Protocol Reference](docs/services/scp-protocol.md) — Message types and communication patterns
- [Service SDK API](docs/services/sdk-api.md) — ServiceClient reference
- [UI Integration](docs/services/ui-integration.md) — Building service UIs
- [API Proxy](docs/services/api-proxy.md) — HTTP proxy for service actions
- [Examples](docs/services/examples.md) — Sample services and patterns

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

ServiceClaw is built on the foundation of [OpenClaw](https://github.com/openclaw/openclaw) by Peter Steinberger and the OpenClaw community. The service architecture and SCP protocol represent a fundamental shift from skill-based to service-based AI agent interactions.

<p align="center">
  <strong>Build Services, Not Just Skills.</strong>
</p>
