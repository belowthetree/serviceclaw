export type CronJobMetadata = {
  serviceId?: string;
  triggerId?: string;
  triggerType?: "cron" | "webhook" | "message" | "event";
  managedBy?: string;
  [key: string]: unknown;
};

export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: TSchedule;
    sessionTarget: TSessionTarget;
    wakeMode: TWakeMode;
    payload: TPayload;
    delivery?: TDelivery;
    failureAlert?: TFailureAlert;
    metadata?: CronJobMetadata;
  };
