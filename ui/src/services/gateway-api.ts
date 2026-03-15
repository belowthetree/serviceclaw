import type { ServiceProcessInstance } from "../../../src/services/lifecycle.js";

// Simple WebSocket client for gateway communication
let ws: WebSocket | null = null;
let messageHandlers = new Map<string, (response: unknown) => void>();
let requestId = 0;

function getWebSocket(): WebSocket {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    // Connect to the gateway WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        const handler = messageHandlers.get(data.requestId);
        if (handler) {
          handler(data);
          messageHandlers.delete(data.requestId);
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.addEventListener("close", () => {
      ws = null;
    });
  }
  return ws;
}

function sendMessage(type: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = getWebSocket();
    const id = String(++requestId);

    messageHandlers.set(id, (response) => {
      resolve(response);
    });

    // Wait for connection if needed
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type, requestId: id, payload }));
      });
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, requestId: id, payload }));
    } else {
      reject(new Error("WebSocket not connected"));
    }

    // Timeout after 30 seconds
    setTimeout(() => {
      if (messageHandlers.has(id)) {
        messageHandlers.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 30000);
  });
}

export async function startService(serviceId: string): Promise<ServiceProcessInstance> {
  const response = (await sendMessage("services.start", { serviceId })) as {
    payload?: { serviceId: string; state: string; pid?: number };
    error?: { message: string };
  };

  if (response.error) {
    throw new Error(response.error.message);
  }

  return {
    serviceId: response.payload!.serviceId,
    state: response.payload!.state as ServiceProcessInstance["state"],
    pid: response.payload!.pid,
    startedAt: new Date(),
  } as ServiceProcessInstance;
}

export async function stopService(serviceId: string): Promise<void> {
  const response = (await sendMessage("services.stop", { serviceId })) as {
    error?: { message: string };
  };

  if (response.error) {
    throw new Error(response.error.message);
  }
}

export async function getServiceState(serviceId: string): Promise<ServiceProcessInstance | null> {
  const response = (await sendMessage("services.state", { serviceId })) as {
    payload?: ServiceProcessInstance;
    error?: { message: string };
  };

  if (response.error) {
    return null;
  }

  return response.payload || null;
}

export function isServiceRunning(_serviceId: string): boolean {
  // This would need to be implemented with state tracking
  // For now, return false and rely on getServiceState
  return false;
}
