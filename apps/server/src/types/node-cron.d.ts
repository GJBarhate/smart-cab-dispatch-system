declare module 'node-cron' {
  interface ScheduledTask {
    start(): void;
    stop(): void;
  }

  interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }

  interface NodeCron {
    schedule(expression: string, func: () => void, options?: ScheduleOptions): ScheduledTask;
    validate(expression: string): boolean;
  }

  const nodeCron: NodeCron;
  export = nodeCron;
}
