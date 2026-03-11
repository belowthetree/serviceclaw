import {
  getServiceRegistry,
  ServiceNotFoundError,
  InvalidStateTransitionError,
} from "../../services/registry.js";
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

  "services.enable": async ({ params, respond }) => {
    // TODO: Add authorization check before enabling services
    const { serviceId } = params as { serviceId: string };

    if (!serviceId || typeof serviceId !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "serviceId is required and must be a string"),
      );
      return;
    }

    try {
      const registry = getServiceRegistry();
      await registry.enable(serviceId);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      if (err instanceof ServiceNotFoundError) {
        respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Service not found"));
      } else if (err instanceof InvalidStateTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_STATE, err.message));
      } else {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      }
    }
  },

  "services.disable": async ({ params, respond }) => {
    // TODO: Add authorization check before disabling services
    const { serviceId } = params as { serviceId: string };

    if (!serviceId || typeof serviceId !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "serviceId is required and must be a string"),
      );
      return;
    }

    try {
      const registry = getServiceRegistry();
      await registry.disable(serviceId);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      if (err instanceof ServiceNotFoundError) {
        respond(false, undefined, errorShape(ErrorCodes.NOT_FOUND, "Service not found"));
      } else if (err instanceof InvalidStateTransitionError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_STATE, err.message));
      } else {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
      }
    }
  },
};
