import 'dotenv/config';
import { z } from 'zod';

const cronField = z
  .string()
  .refine((val) => val.trim().split(/\s+/).length === 6, 'cron expression must have 6 fields (seconds first)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),

  ROUTING_PROVIDER: z.enum(['osrm', 'ors', 'haversine']).default('osrm'),
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_MAX_MATRIX_CELLS: z.coerce.number().int().positive().default(9000),
  ORS_API_KEY: z.string().optional().default(''),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  ROUTING_CACHE_TTL_SEC: z.coerce.number().int().positive().default(900),
  HAVERSINE_ROAD_FACTOR: z.coerce.number().positive().default(1.35),
  HAVERSINE_AVG_SPEED_KMPH: z.coerce.number().positive().default(32),

  DISPATCH_TICK_CRON: cronField.default('*/30 * * * * *'),
  REOPTIMIZE_CRON: cronField.default('0 */2 * * * *'),
  STARVATION_SWEEP_CRON: cronField.default('0 * * * * *'),
  BATCH_HORIZON_MIN: z.coerce.number().int().positive().default(45),
  MAX_DETOUR_MIN: z.coerce.number().int().positive().default(8),
  STARVATION_THRESHOLD_MIN: z.coerce.number().int().positive().default(20),
  DRIVER_BREAK_AFTER_TRIPS: z.coerce.number().int().positive().default(4),
  DRIVER_BREAK_MINUTES: z.coerce.number().int().positive().default(20),
  DRIVER_MAX_CONTINUOUS_MIN: z.coerce.number().int().positive().default(180),

  LOCATION_EMIT_THROTTLE_MS: z.coerce.number().int().positive().default(5000),
  LOCATION_PERSIST_THROTTLE_MS: z.coerce.number().int().positive().default(15000),

  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().optional().default('mailto:admin@example.com'),

  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  AI_DAILY_CALL_BUDGET: z.coerce.number().int().positive().default(150),

  KEEPALIVE_URL: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export type Env = z.infer<typeof envSchema> & { CORS_ORIGIN_LIST: string[] };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('\n❌ Invalid environment configuration:\n');
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nFix apps/server/.env (copy from .env.example) and restart.\n');
    process.exit(1);
  }

  const data = parsed.data;
  const CORS_ORIGIN_LIST = data.CORS_ORIGINS.split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return { ...data, CORS_ORIGIN_LIST };
}

export const env = loadEnv();
