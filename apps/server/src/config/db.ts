import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

let connected = false;

export async function connectDb(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongodb connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongodb reconnected'));

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000
  });

  connected = true;
  logger.info('mongodb connected');
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
