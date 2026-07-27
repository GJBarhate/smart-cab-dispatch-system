import { Alert } from '../models/Alert';
import { NotificationService } from './NotificationService';

export type AlertLevel = 'info' | 'warning' | 'critical';

export const AlertService = {
  async raise(level: AlertLevel, code: string, message: string, entity?: { type: string; id: string }): Promise<void> {
    const alert = await Alert.create({ level, code, message, entity: entity ?? null });
    NotificationService.adminAlert({ id: alert._id.toString(), level, code, message, entity });
  }
};
