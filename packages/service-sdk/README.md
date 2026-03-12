# @openclaw/service-sdk

TypeScript SDK for OpenClaw Service Communication Protocol (SCP). This SDK provides a client library for services to connect and communicate with the OpenClaw Agent via WebSocket.

## Installation

```bash
npm install @openclaw/service-sdk
```

## Quick Start

Get up and running with a service in minutes:

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

// Create a service client
const client = new ServiceClient("my-service", {
  name: "My Service",
  version: "1.0.0",
});

// Handle events from the Agent
client.on("status-check", (data) => {
  console.log("Received status check:", data);
});

// Connect to the Agent
await client.connect("ws://localhost:8080");

// Emit an event to the Agent
client.emitEvent("task-complete", { taskId: "123", result: "done" });

// Call an action on the Agent
const result = await client.callAction("fetch-data", { url: "https://example.com" });
console.log("Result:", result);

// Disconnect when done
client.disconnect();
```

## API Reference

### ServiceClient

The main class for connecting services to the OpenClaw Agent.

#### Constructor

```typescript
new ServiceClient(serviceId: ServiceId, options?: ServiceClientOptions)
```

**Parameters:**

| Parameter   | Type                   | Description                                 |
| ----------- | ---------------------- | ------------------------------------------- |
| `serviceId` | `string`               | Unique identifier for this service instance |
| `options`   | `ServiceClientOptions` | Optional configuration object               |

**ServiceClientOptions:**

| Option                   | Type      | Default             | Description                                      |
| ------------------------ | --------- | ------------------- | ------------------------------------------------ |
| `name`                   | `string`  | `'unknown-service'` | Service name                                     |
| `version`                | `string`  | `'0.0.0'`           | Service version                                  |
| `actionTimeout`          | `number`  | `30000`             | Timeout for action calls in milliseconds         |
| `reconnect.enabled`      | `boolean` | `true`              | Enable automatic reconnection                    |
| `reconnect.maxRetries`   | `number`  | `5`                 | Maximum reconnection attempts                    |
| `reconnect.initialDelay` | `number`  | `1000`              | Initial delay between reconnection attempts (ms) |
| `reconnect.maxDelay`     | `number`  | `16000`             | Maximum delay between reconnection attempts (ms) |

#### Methods

##### `connect(url: string): Promise<void>`

Connects the service to the OpenClaw Agent.

```typescript
await client.connect("ws://localhost:8080");
```

**Parameters:**

| Parameter | Type     | Description                |
| --------- | -------- | -------------------------- |
| `url`     | `string` | WebSocket URL of the Agent |

**Events emitted:**

- `connected` - When successfully connected
- `reconnecting` - When attempting to reconnect (with `{ attempt, maxRetries, delay }`)

##### `disconnect(): void`

Disconnects the service from the Agent.

```typescript
client.disconnect();
```

**Events emitted:**

- `disconnected` - When disconnected

##### `emitEvent(event: string, payload?: unknown): void`

Emits an event to the Agent.

```typescript
client.emitEvent("progress", { percent: 50 });
```

**Parameters:**

| Parameter | Type      | Description         |
| --------- | --------- | ------------------- |
| `event`   | `string`  | Event name          |
| `payload` | `unknown` | Optional event data |

##### `callAction(action: string, params?: unknown): Promise<unknown>`

Calls an action on the Agent and waits for a response.

```typescript
const result = await client.callAction("fetch-data", { url: "https://api.example.com" });
```

**Parameters:**

| Parameter | Type      | Description                |
| --------- | --------- | -------------------------- |
| `action`  | `string`  | Action name                |
| `params`  | `unknown` | Optional action parameters |

**Returns:** `Promise<unknown>` - Resolves with the action result

**Throws:** `Error` if the action fails or times out

##### `on(event: string, handler: EventHandler): this`

Registers an event handler for events from the Agent.

```typescript
client.on("shutdown", () => {
  console.log("Shutdown requested");
});
```

**Parameters:**

| Parameter | Type           | Description              |
| --------- | -------------- | ------------------------ |
| `event`   | `string`       | Event name to listen for |
| `handler` | `EventHandler` | Handler function         |

##### `off(event: string, handler?: EventHandler): this`

Removes an event handler.

```typescript
// Remove specific handler
client.off("shutdown", myHandler);

// Remove all handlers for an event
client.off("shutdown");
```

**Parameters:**

| Parameter | Type           | Description                                              |
| --------- | -------------- | -------------------------------------------------------- |
| `event`   | `string`       | Event name                                               |
| `handler` | `EventHandler` | Optional handler to remove (removes all if not provided) |

##### `isConnected(): boolean`

Returns whether the client is currently connected.

```typescript
if (client.isConnected()) {
  console.log("Client is connected");
}
```

##### `getReconnectAttempts(): number`

Returns the number of reconnection attempts made.

```typescript
console.log(`Reconnection attempts: ${client.getReconnectAttempts()}`);
```

#### Events

The ServiceClient extends EventEmitter and emits the following events:

| Event            | Payload                          | Description                             |
| ---------------- | -------------------------------- | --------------------------------------- |
| `connected`      | -                                | Service successfully connected to Agent |
| `disconnected`   | `{ code, reason }`               | Service disconnected                    |
| `error`          | `Error`                          | An error occurred                       |
| `reconnecting`   | `{ attempt, maxRetries, delay }` | Attempting to reconnect                 |
| `stop-requested` | `{ reason, force }`              | Agent requested service to stop         |

## Message Types

### Service-to-Agent Messages

Services send these message types to the Agent:

#### `service.started`

Sent when the service connects and is ready to receive commands.

```typescript
{
  type: 'service.started',
  payload: {
    name: string;
    version: string;
    actions?: string[];
    metadata?: Record<string, unknown>;
  }
}
```

#### `service.stopped`

Sent when the service stops or disconnects.

```typescript
{
  type: 'service.stopped',
  payload: {
    reason: 'shutdown' | 'error' | 'disconnected' | 'killed';
    exitCode?: number;
    error?: SCPError;
  }
}
```

#### `service.event`

Used to emit events to the Agent.

```typescript
{
  type: 'service.event',
  payload: {
    event: string;
    data: unknown;
  }
}
```

#### `service.action`

Used to request actions from the Agent.

```typescript
{
  type: 'service.action',
  requestId: string;
  payload: {
    action: string;
    params: unknown;
    timeout?: number;
  }
}
```

### Agent-to-Service Messages

The Agent sends these message types to services:

#### `agent.response`

Response to a `service.action` request.

```typescript
{
  type: 'agent.response',
  requestId: string;
  payload: {
    success: boolean;
    data?: unknown;
    error?: SCPError;
  }
}
```

#### `agent.stop-request`

Request for the service to stop.

```typescript
{
  type: 'agent.stop-request',
  payload: {
    reason: string;
    force?: boolean;
  }
}
```

## Error Handling

### Connection Errors

```typescript
client.on("error", (error) => {
  console.error("Connection error:", error.message);
});
```

### Action Call Errors

Action calls throw errors on failure:

```typescript
try {
  const result = await client.callAction("risky-operation");
} catch (error) {
  console.error("Action failed:", error.message);

  // Access SCP error details
  if ("code" in error) {
    console.error("Error code:", (error as any).code);
    console.error("Error details:", (error as any).details);
  }
}
```

### Error Codes

SCP uses the following error code ranges:

| Range     | Category        |
| --------- | --------------- |
| 1000-1999 | Protocol errors |
| 2000-2999 | Service errors  |
| 3000-3999 | Agent errors    |
| 4000-4999 | System errors   |

## Examples

### Basic Service

A simple service that connects and handles events:

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

async function main() {
  const client = new ServiceClient("basic-service", {
    name: "Basic Service",
    version: "1.0.0",
  });

  // Handle events from Agent
  client.on("ping", (data) => {
    console.log("Ping received:", data);
    client.emitEvent("pong", { timestamp: Date.now() });
  });

  // Handle stop requests
  client.on("stop-requested", ({ reason, force }) => {
    console.log(`Stop requested. Reason: ${reason}, Force: ${force}`);
    client.disconnect();
    process.exit(0);
  });

  // Connect
  await client.connect("ws://localhost:8080");
  console.log("Service connected");
}

main().catch(console.error);
```

### Service with Actions

A service that calls actions on the Agent:

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

class DataService {
  private client: ServiceClient;

  constructor() {
    this.client = new ServiceClient("data-service", {
      name: "Data Service",
      version: "2.0.0",
      actionTimeout: 60000, // 60 second timeout
    });
  }

  async start() {
    // Handle data requests
    this.client.on("fetch-data", async (params) => {
      try {
        // Call Agent action to fetch external data
        const result = await this.client.callAction("http-request", {
          url: params.url,
          method: "GET",
        });

        // Emit success event
        this.client.emitEvent("data-fetched", {
          requestId: params.requestId,
          data: result,
        });
      } catch (error) {
        // Emit error event
        this.client.emitEvent("data-error", {
          requestId: params.requestId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    await this.client.connect("ws://localhost:8080");
  }

  stop() {
    this.client.disconnect();
  }
}

const service = new DataService();
service.start().catch(console.error);

// Graceful shutdown
process.on("SIGTERM", () => service.stop());
process.on("SIGINT", () => service.stop());
```

### Event Emitter Pattern

Using the client as an event emitter for bidirectional communication:

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

class EventDrivenService {
  private client: ServiceClient;

  constructor() {
    this.client = new ServiceClient("event-service", {
      name: "Event-Driven Service",
      version: "1.0.0",
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Listen for Agent events
    this.client.on("task-assign", this.handleTask.bind(this));
    this.client.on("config-update", this.handleConfig.bind(this));
    this.client.on("health-check", this.handleHealthCheck.bind(this));

    // Handle errors
    this.client.on("error", (error) => {
      console.error("Service error:", error);
    });

    // Handle reconnection
    this.client.on("reconnecting", ({ attempt, maxRetries, delay }) => {
      console.log(`Reconnecting... Attempt ${attempt}/${maxRetries} in ${delay}ms`);
    });

    // Handle disconnection
    this.client.on("disconnected", ({ code, reason }) => {
      console.log(`Disconnected: ${code} - ${reason}`);
    });
  }

  private async handleTask(data: { taskId: string; type: string; payload: unknown }) {
    console.log(`Processing task ${data.taskId} of type ${data.type}`);

    try {
      // Process task...
      await this.processTask(data);

      // Emit completion
      this.client.emitEvent("task-complete", {
        taskId: data.taskId,
        status: "success",
      });
    } catch (error) {
      this.client.emitEvent("task-failed", {
        taskId: data.taskId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private handleConfig(data: Record<string, unknown>) {
    console.log("Config updated:", data);
    this.client.emitEvent("config-ack", { updated: true });
  }

  private handleHealthCheck() {
    this.client.emitEvent("health-status", {
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  }

  private async processTask(data: { type: string; payload: unknown }) {
    // Task processing logic here
  }

  async start() {
    await this.client.connect("ws://localhost:8080");
    console.log("Event-driven service started");
  }

  stop() {
    this.client.disconnect();
  }
}

// Run the service
const service = new EventDrivenService();
service.start().catch(console.error);
```

## TypeScript

The SDK includes comprehensive TypeScript definitions. All types are exported from the package:

```typescript
import {
  ServiceClient,
  ServiceClientOptions,
  ServiceId,
  RequestId,
  EventHandler,
  SCPMessage,
  ServiceMessage,
  AgentMessage,
  SCPError,
  ServiceConfig,
  AgentAPI,
  ToolCallParams,
  ToolCallResult,
} from "@openclaw/service-sdk";

// Use types in your code
const handler: EventHandler<{ message: string }> = (data) => {
  console.log(data.message);
};
```

### Type Definitions

Key types available:

| Type              | Description                                     |
| ----------------- | ----------------------------------------------- |
| `ServiceId`       | Unique service identifier (`string`)            |
| `RequestId`       | Unique request identifier (`string`)            |
| `EventHandler<T>` | Event handler function type                     |
| `SCPMessage`      | Union of all SCP message types                  |
| `ServiceMessage`  | Union of service-to-agent messages              |
| `AgentMessage`    | Union of agent-to-service messages              |
| `SCPError`        | Error structure with code, message, and details |
| `ServiceConfig`   | Service configuration interface                 |
| `AgentAPI`        | Interface for Agent tool API                    |

## License

MIT

## Repository

[https://github.com/openclaw/openclaw/tree/main/packages/service-sdk](https://github.com/openclaw/openclaw/tree/main/packages/service-sdk)

## Documentation

For more information about OpenClaw, visit [https://docs.openclaw.ai](https://docs.openclaw.ai)
