// Not in plan.md §6.4's model list, but needed for GET /api/admin/alerts and
// POST /api/admin/alerts/:id/ack (§9.4) — NotificationService.adminAlert only
// emits a socket event, which a client connected later would never see.
import { Schema, Types, InferSchemaType } from 'mongoose';
import { getModel } from './_shared';

// Real Schema instance — `entity` has a sibling field literally named `type`,
// which collides with Mongoose's own "type key" shorthand otherwise (same
// issue as Driver.vehicle; see the comment there).
const alertEntitySchema = new Schema(
  {
    type: { type: String, default: null },
    id: { type: String, default: null }
  },
  { _id: false }
);

const alertSchema = new Schema(
  {
    level: { type: String, enum: ['info', 'warning', 'critical'], required: true },
    code: { type: String, required: true },
    message: { type: String, required: true },
    entity: { type: alertEntitySchema, default: null },
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: { type: Schema.Types.ObjectId, default: null },
    acknowledgedAt: { type: Date, default: null }
  },
  { timestamps: true, versionKey: false }
);

alertSchema.index({ acknowledged: 1, createdAt: -1 });

export type AlertDoc = InferSchemaType<typeof alertSchema> & { _id: Types.ObjectId };
export const Alert = getModel('Alert', alertSchema);
