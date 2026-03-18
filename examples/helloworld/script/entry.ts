import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
  const actionHandlers = new Map<string, (params: unknown) => unknown>();

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

  function callAction(action: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Action '${action}' timed out`));
      }, timeoutMs);

      pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      send("service.action", { action, params }, requestId);
    });
  }

  function registerActionHandler(action: string, handler: (params: unknown) => unknown): void {
    actionHandlers.set(action, handler);
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
          } else if (msg.type === "service.action") {
            // Handle action requests from Gateway API Proxy
            const action = msg.payload?.action;
            const params = msg.payload?.params;
            const requestId = msg.requestId;

            if (action && actionHandlers.has(action)) {
              const handler = actionHandlers.get(action)!;
              void Promise.resolve(handler(params))
                .then((result) => {
                  send("agent.response", { success: true, data: result }, requestId);
                })
                .catch((err) => {
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  send(
                    "agent.response",
                    { success: false, error: { code: 3001, message: errorMessage } },
                    requestId,
                  );
                });
            } else {
              send(
                "agent.response",
                { success: false, error: { code: 3000, message: `Unknown action: ${action}` } },
                requestId,
              );
            }
          } else if (msg.type === "ui.event") {
            emit("ui.event", msg.payload);
          }
        } catch (err) {
          console.error("[helloworld] Error parsing message:", err);
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
    callAction,
    registerActionHandler,
    isConnected: () => connected,
  };
}

// ============================================================================
// HelloWorld Service
// ============================================================================
const SERVICE_ID = "helloworld";
const AGENT_URL = "ws://localhost:18789/__openclaw__/scp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICE_ROOT = join(__dirname, "..");

function saveToFile(content: string): { success: boolean; path?: string; error?: string } {
  try {
    const dataDir = join(SERVICE_ROOT, "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    const filePath = join(dataDir, "user-input.txt");
    writeFileSync(filePath, content, "utf-8");
    console.log(`[helloworld] Saved to: ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[helloworld] Save error:", error);
    return { success: false, error };
  }
}

async function main() {
  const client = createSCPClient(SERVICE_ID, { name: "HelloWorld", version: "1.0.0" });

  client.on("connected", () => console.log("[helloworld] Connected to Agent"));

  client.on("disconnected", (data) => {
    const { code, reason } = data as { code: number; reason: string };
    console.log(`[helloworld] Disconnected: ${code} - ${reason}`);
  });

  client.on("stop-requested", (data) => {
    const { reason } = data as { reason: string };
    console.log(`[helloworld] Stop requested: ${reason}`);
    client.disconnect();
    process.exit(0);
  });

  // Register action handler for Gateway API Proxy
  // UI can call: POST /__openclaw__/services/helloworld/api/save
  client.registerActionHandler("save", (params) => {
    const { content } = params as { content: string };
    console.log("[helloworld] Save action called via API proxy");
    return saveToFile(content);
  });

  await client.connect(AGENT_URL);
  console.log("[helloworld] Service started");
  console.log(`[helloworld] Service root: ${SERVICE_ROOT}`);
  console.log("[helloworld] API endpoint: POST /__openclaw__/services/helloworld/api/save");

  process.on("SIGINT", () => {
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
