import {
  ServiceLifecycleError,
  ServiceNotFoundError as ServiceLifecycleNotFoundError,
} from "../../services/lifecycle.js";
import { getServiceRegistry } from "../../services/registry.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

export const servicesHandlers: GatewayRequestHandlers = {
  "services.status": async ({ respond }) => {
    try {
      const registry = getServiceRegistry();
      const services = await registry.list();

      respond(true, { services }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "services.start": async ({ params, context, respond }) => {
    try {
      const { serviceId } = params as { serviceId: string };

      if (!context.serviceLifecycleManager) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Service lifecycle manager not initialized"),
        );
        return;
      }

      const instance = await context.serviceLifecycleManager.startService(serviceId);

      respond(
        true,
        {
          serviceId,
          state: instance.state,
          pid: instance.pid,
        },
        undefined,
      );
    } catch (err) {
      if (err instanceof ServiceLifecycleNotFoundError) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, `Service not found: ${err.serviceId}`),
        );
      } else if (err instanceof ServiceLifecycleError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
      } else {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      }
    }
  },

  "services.stop": async ({ params, context, respond }) => {
    try {
      const { serviceId } = params as { serviceId: string };

      if (!context.serviceLifecycleManager) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Service lifecycle manager not initialized"),
        );
        return;
      }

      await context.serviceLifecycleManager.stopService(serviceId);

      respond(
        true,
        {
          serviceId,
          state: "stopped",
        },
        undefined,
      );
    } catch (err) {
      if (err instanceof ServiceLifecycleNotFoundError) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, `Service not found: ${err.serviceId}`),
        );
      } else if (err instanceof ServiceLifecycleError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
      } else {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      }
    }
  },

  "services.state": async ({ params, context, respond }) => {
    try {
      const { serviceId } = params as { serviceId: string };

      if (!context.serviceLifecycleManager) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Service lifecycle manager not initialized"),
        );
        return;
      }

      const instance = context.serviceLifecycleManager.getServiceState(serviceId);

      if (!instance) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.NOT_FOUND, `Service not running: ${serviceId}`),
        );
        return;
      }

      respond(
        true,
        {
          serviceId,
          state: instance.state,
          pid: instance.pid,
          startedAt: instance.startedAt,
          stoppedAt: instance.stoppedAt,
          exitCode: instance.exitCode,
          error: instance.error,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
