// Each integration test file owns its own MongoMemoryServer + connect/
// disconnect lifecycle. vitest.config.ts pins `singleFork: true`, so test
// files run sequentially in one process — safe for repeated connect/
// disconnect cycles against the shared `mongoose` singleton (models are
// process-global via getModel(), but the underlying connection is not).
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer | null = null;

export async function startTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

export async function clearTestDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
