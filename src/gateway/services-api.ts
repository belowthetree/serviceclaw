/**
 * Gateway Service API Proxy Handler
 *
 * Handles HTTP API requests from service UI to service backend.
 * Routes: POST /__openclaw__/services/{serviceId}/api/{action}
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { SCPError } from "../../packages/service-sdk/src/types.js";
import type { ServiceLifecycleManager } from "../services/lifecycle.js";
import type { SCPServer } from "../services/scp-server.js";
import { SCPErrorCodes } from "../services/scp-server.js";

const SERVICES_BASE_PATH = "/__openclaw__/services";
const API_SEGMENT = "/api/";

/**
 * Parse service API URL to extract serviceId and action
 *
 * @param pathname - URL pathname
 * @returns Parsed components or null if not a valid API path
 */
export function parseServiceApiPath(
  pathname: string,
): { serviceId: string; action: string } | null {
  // Must start with /__openclaw__/services/
  if (!pathname.startsWith(SERVICES_BASE_PATH + "/")) {
    return null;
  }

  // Must contain /api/ segment
  const apiIndex = pathname.indexOf(API_SEGMENT);
  if (apiIndex === -1) {
    return null;
  }

  // Extract serviceId (between /services/ and /api/)
  const afterServices = pathname.slice(SERVICES_BASE_PATH.length + 1);
  const apiPos = afterServices.indexOf(API_SEGMENT);
  if (apiPos === -1 || apiPos === 0) {
    return null;
  }

  const serviceId = afterServices.slice(0, apiPos);
  const action = afterServices.slice(apiPos + API_SEGMENT.length);

  // Validate serviceId and action are non-empty
  if (!serviceId || !action) {
    return null;
  }

  return { serviceId, action };
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Create standardized error response
 */
function createErrorResponse(code: number, message: string): { success: false; error: SCPError } {
  return {
    success: false,
    error: { code, message },
  };
}

/**
 * Dependencies for services API handler
 */
export interface ServicesApiDeps {
  scpServer: SCPServer;
  lifecycleManager: ServiceLifecycleManager;
}

/**
 * Handle service API HTTP requests
 *
 * @param req - HTTP request
 * @param res - HTTP response
 * @param deps - Dependencies (SCP server, lifecycle manager)
 * @returns true if request was handled, false otherwise
 */
export async function handleServicesApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServicesApiDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  const parsed = parseServiceApiPath(pathname);
  if (!parsed) {
    return false;
  }

  const { serviceId, action } = parsed;

  if (req.method !== "POST") {
    sendJson(res, 405, createErrorResponse(1002, "Method Not Allowed. Use POST."));
    return true;
  }

  const serviceState = deps.lifecycleManager.getServiceState(serviceId);
  if (!serviceState || serviceState.state !== "started") {
    sendJson(
      res,
      503,
      createErrorResponse(SCPErrorCodes.SERVICE_NOT_FOUND, `Service '${serviceId}' is not running`),
    );
    return true;
  }

  const body = await readJsonBody(req);
  const params = (body as { params?: unknown })?.params;

  const result = await deps.scpServer.sendActionAndWait(serviceId, action, params, 30000);

  if (result.success) {
    sendJson(res, 200, result);
  } else if (result.error?.code === SCPErrorCodes.TIMEOUT) {
    sendJson(res, 504, result);
  } else {
    sendJson(res, 500, result);
  }

  return true;
}

/**
 * Read JSON body from request
 *
 * @param req - HTTP request
 * @returns Parsed JSON body or null on error
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => {
      resolve(null);
    });
  });
}
