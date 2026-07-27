import { Schema, model, Types, InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorRole: { type: String, default: '' },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    at: { type: Date, default: () => new Date() },
    ip: { type: String, default: '' }
  },
  { versionKey: false }
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLog = model('AuditLog', auditLogSchema);
