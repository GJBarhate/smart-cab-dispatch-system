import { AuditLog } from '../models/AuditLog';

export interface AuditEntry {
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export const AuditService = {
  async log(entry: AuditEntry): Promise<void> {
    await AuditLog.create({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? ''
    });
  }
};
