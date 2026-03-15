import type { createSubsystemLogger } from "../logging/subsystem.js";
import { createSCPServer } from "../services/scp-server.js";
import type { SCPServer } from "../services/scp-server.js";

export interface GatewaySCPDeps {
  logger: ReturnType<typeof createSubsystemLogger>;
}

export function createGatewaySCPServer(deps: GatewaySCPDeps): SCPServer {
  return createSCPServer({
    logger: deps.logger,

    onServiceStarted: (serviceId, payload, _connection) => {
      deps.logger.info(`Service started: ${serviceId} (${payload.name} v${payload.version})`);
    },

    onServiceStopped: (serviceId, payload, _connection) => {
      deps.logger.info(`Service stopped: ${serviceId} (${payload.reason})`);
    },

    onServiceEvent: (serviceId, payload, _connection) => {
      deps.logger.debug(`Service event from ${serviceId}: ${payload.event}`);
    },

    onServiceAction: async (serviceId, action, _params, _requestId, _connection) => {
      deps.logger.info(`Service action from ${serviceId}: ${action}`);
      return { success: true, data: { executed: true } };
    },

    onError: (serviceId, error, _connection) => {
      deps.logger.error(`SCP error for ${serviceId}:`, {
        message: error.message,
        stack: error.stack,
      });
    },

    onDisconnect: (serviceId, _connection) => {
      deps.logger.info(`Service disconnected: ${serviceId}`);
    },
  });
}
