import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ============================================================================
// Inline SCP Client - implements Service Communication Protocol
// ============================================================================
function createSCPClient(serviceId: string, options: { name: string; version: string }) {
  let ws: WebSocket | null = null;
  let connected = false;
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  function send(type: string, payload: unknown, requestId?: string): void {
    if (!ws || !connected) {
      return;
    }
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
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler);
  }

  function emit(event: string, data?: unknown): void {
    handlers.get(event)?.forEach((h) => h(data));
  }

  function emitEvent(event: string, data?: unknown): void {
    send("service.event", { event, data });
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

      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "agent.stop-request") {
            emit("stop-requested", msg.payload);
          } else if (msg.type === "agent.response") {
            const pending = pendingRequests.get(msg.requestId);
            if (pending) {
              pendingRequests.delete(msg.requestId);
              const payload = msg.payload as {
                success: boolean;
                data?: unknown;
                error?: { message: string };
              };
              if (payload.success) {
                pending.resolve(payload.data);
              } else {
                pending.reject(new Error(payload.error?.message ?? "Unknown error"));
              }
            }
          } else if (msg.type === "cron.execute") {
            // Handle cron task execution
            emit("cron.execute", msg.payload);
          } else if (msg.type === "ui.event") {
            emit("ui.event", msg.payload);
          }
        } catch (err) {
          console.error(`[${serviceId}] Error parsing message:`, err);
        }
      });

      ws.on("close", (code, reason) => emit("disconnected", { code, reason: reason.toString() }));
      ws.on("error", (err) => reject(err));
    });
  }

  function disconnect(): void {
    if (ws && connected) {
      send("service.stopped", { reason: "shutdown" });
    }
    ws?.close();
    connected = false;
  }

  return {
    connect,
    disconnect,
    on,
    emitEvent,
    isConnected: () => connected,
  };
}

// ============================================================================
// Execution Log Manager
// ============================================================================
type LogEntry = {
  timestamp: string;
  taskName: string;
  message: string;
  status: "started" | "completed" | "failed";
};

const executionLogs: LogEntry[] = [];

function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

function addLogEntry(taskName: string, message: string, status: LogEntry["status"]): LogEntry {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    taskName,
    message,
    status,
  };
  executionLogs.unshift(entry);

  // Keep only last 100 entries
  while (executionLogs.length > 100) {
    executionLogs.pop();
  }

  return entry;
}

// ============================================================================
// Cron Service
// ============================================================================
const SERVICE_ID = "cron-service";
const AGENT_URL = "ws://localhost:18789/__serviceclaw__/scp";

// Task execution statistics
const taskStats: Record<string, { executions: number; lastRun?: string; lastStatus?: string }> = {
  cleanup: { executions: 0 },
  sync: { executions: 0 },
};

// Task handlers - map command names to handler functions
const taskHandlers: Record<string, (taskName: string, data?: unknown) => void> = {
  "cleanup-temp-files": (taskName: string) => {
    const timestamp = formatTimestamp();
    console.log(`[${SERVICE_ID}] [${timestamp}] Starting cleanup task: removing temporary files`);

    // Simulate cleanup work
    const filesScanned = Math.floor(Math.random() * 50) + 10;
    const filesRemoved = Math.floor(filesScanned * 0.7);

    console.log(
      `[${SERVICE_ID}] [${timestamp}] Cleanup complete: scanned ${filesScanned} files, removed ${filesRemoved}`,
    );

    addLogEntry(
      taskName,
      `Scanned ${filesScanned} files, removed ${filesRemoved} temp files`,
      "completed",
    );

    // Update stats
    taskStats.cleanup.executions++;
    taskStats.cleanup.lastRun = timestamp;
    taskStats.cleanup.lastStatus = "completed";
  },
  "sync-data": (taskName: string, data?: unknown) => {
    const timestamp = formatTimestamp();
    console.log(`[${SERVICE_ID}] [${timestamp}] Starting sync task: synchronizing data`);

    // Simulate sync work
    const payload = data as { source?: string; target?: string } | undefined;
    const source = payload?.source ?? "remote";
    const target = payload?.target ?? "local";
    const recordsSynced = Math.floor(Math.random() * 100) + 20;

    console.log(
      `[${SERVICE_ID}] [${timestamp}] Sync complete: ${recordsSynced} records synced from ${source} to ${target}`,
    );

    addLogEntry(
      taskName,
      `Synced ${recordsSynced} records from ${source} to ${target}`,
      "completed",
    );

    // Update stats
    taskStats.sync.executions++;
    taskStats.sync.lastRun = timestamp;
    taskStats.sync.lastStatus = "completed";
  },
};

async function main() {
  const client = createSCPClient(SERVICE_ID, { name: "Cron Service", version: "1.0.0" });

  client.on("connected", () => {
    console.log(`[${SERVICE_ID}] Connected to Agent`);

    // Send initial status to UI
    client.emitEvent("service.ready", {
      timestamp: formatTimestamp(),
      message: "Service connected and ready",
      tasks: Object.keys(taskHandlers),
    });
  });

  client.on("disconnected", (data) => {
    const { code, reason } = data as { code: number; reason: string };
    console.log(`[${SERVICE_ID}] Disconnected: ${code} - ${reason}`);
  });

  client.on("stop-requested", (data) => {
    const { reason } = data as { reason: string };
    console.log(`[${SERVICE_ID}] Stop requested: ${reason}`);
    client.disconnect();
    process.exit(0);
  });

  // Handle cron task execution
  client.on("cron.execute", (data) => {
    const payload = data as {
      taskName?: string;
      command?: string;
      source?: string;
      target?: string;
    };
    const taskName = payload.taskName ?? "unknown";
    const command = payload.command ?? taskName;
    const timestamp = formatTimestamp();

    console.log(
      `[${SERVICE_ID}] [${timestamp}] Received cron task: ${taskName} (command: ${command})`,
    );

    // Log task start
    const startEntry = addLogEntry(taskName, "Task execution started", "started");

    // Emit to UI immediately
    client.emitEvent("task.started", {
      timestamp: startEntry.timestamp,
      taskName,
      command,
    });

    const handler = taskHandlers[command];
    if (handler) {
      try {
        handler(taskName, data);

        console.log(
          `[${SERVICE_ID}] [${formatTimestamp()}] Task ${taskName} completed successfully`,
        );

        // Emit completion to UI
        client.emitEvent("task.completed", {
          timestamp: formatTimestamp(),
          taskName,
          command,
          stats: taskStats[taskName] ?? { executions: 0 },
          logs: executionLogs.slice(0, 10), // Send last 10 logs
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[${SERVICE_ID}] [${formatTimestamp()}] Task ${taskName} failed:`, error);

        addLogEntry(taskName, `Failed: ${error}`, "failed");

        // Update stats
        if (taskStats[taskName]) {
          taskStats[taskName].lastStatus = "failed";
          taskStats[taskName].lastRun = formatTimestamp();
        }

        // Emit failure to UI
        client.emitEvent("task.failed", {
          timestamp: formatTimestamp(),
          taskName,
          command,
          error,
          logs: executionLogs.slice(0, 10),
        });
      }
    } else {
      const warning = `No handler for task command: ${command}`;
      console.warn(`[${SERVICE_ID}] [${timestamp}] ${warning}`);

      addLogEntry(taskName, warning, "failed");

      // Emit unknown task to UI
      client.emitEvent("task.unknown", {
        timestamp,
        taskName,
        command,
        availableCommands: Object.keys(taskHandlers),
      });
    }
  });

  // Handle UI requests for logs/stats
  client.on("ui.event", (data) => {
    const event = data as { type?: string; messageId?: string; payload?: unknown };

    if (event.type === "getLogs") {
      const params = event.payload as { taskName?: string; limit?: number } | undefined;
      const limit = params?.limit ?? 50;

      let filteredLogs = executionLogs;
      if (params?.taskName) {
        filteredLogs = executionLogs.filter((log) => log.taskName === params.taskName);
      }

      client.emitEvent("ui.response", {
        messageId: event.messageId,
        type: "logs",
        logs: filteredLogs.slice(0, limit),
        total: executionLogs.length,
      });
    } else if (event.type === "getStats") {
      client.emitEvent("ui.response", {
        messageId: event.messageId,
        type: "stats",
        stats: taskStats,
        timestamp: formatTimestamp(),
      });
    }
  });

  await client.connect(AGENT_URL);
  console.log(`[${SERVICE_ID}] Service started`);
  console.log(`[${SERVICE_ID}] Registered tasks: ${Object.keys(taskHandlers).join(", ")}`);

  process.on("SIGINT", () => {
    console.log(`[${SERVICE_ID}] Shutting down...`);
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
