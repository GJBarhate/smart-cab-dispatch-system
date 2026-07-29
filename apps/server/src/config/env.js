"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.env = void 0;
require("dotenv/config");
var _zod = require("zod");
const cronField = _zod.z.string().refine(val => val.trim().split(/\s+/).length === 6, 'cron expression must have 6 fields (seconds first)');
const envSchema = _zod.z.object({
  NODE_ENV: _zod.z.enum(['development', 'test', 'production']).default('development'),
  PORT: _zod.z.coerce.number().int().positive().default(4000),
  API_BASE_URL: _zod.z.string().url().default('http://localhost:4000'),
  MONGODB_URI: _zod.z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: _zod.z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: _zod.z.string().default('12h'),
  BCRYPT_ROUNDS: _zod.z.coerce.number().int().min(4).max(15).default(10),
  CORS_ORIGINS: _zod.z.string().default('http://localhost:5173,http://localhost:5174'),
  ROUTING_PROVIDER: _zod.z.enum(['osrm', 'ors', 'haversine']).default('osrm'),
  OSRM_BASE_URL: _zod.z.string().url().default('https://router.project-osrm.org'),
  OSRM_MAX_MATRIX_CELLS: _zod.z.coerce.number().int().positive().default(9000),
  ORS_API_KEY: _zod.z.string().optional().default(''),
  ROUTING_TIMEOUT_MS: _zod.z.coerce.number().int().positive().default(6000),
  ROUTING_CACHE_TTL_SEC: _zod.z.coerce.number().int().positive().default(900),
  HAVERSINE_ROAD_FACTOR: _zod.z.coerce.number().positive().default(1.35),
  HAVERSINE_AVG_SPEED_KMPH: _zod.z.coerce.number().positive().default(32),
  DISPATCH_TICK_CRON: cronField.default('*/30 * * * * *'),
  REOPTIMIZE_CRON: cronField.default('0 */2 * * * *'),
  STARVATION_SWEEP_CRON: cronField.default('0 * * * * *'),
  ARRIVAL_SWEEP_CRON: cronField.default('0 */1 * * * *'),
  ARRIVAL_LOOKAHEAD_MIN: _zod.z.coerce.number().int().positive().default(45),
  BATCH_HORIZON_MIN: _zod.z.coerce.number().int().positive().default(45),
  MAX_DETOUR_MIN: _zod.z.coerce.number().int().positive().default(8),
  STARVATION_THRESHOLD_MIN: _zod.z.coerce.number().int().positive().default(20),
  DRIVER_BREAK_AFTER_TRIPS: _zod.z.coerce.number().int().positive().default(4),
  DRIVER_BREAK_MINUTES: _zod.z.coerce.number().int().positive().default(20),
  DRIVER_MAX_CONTINUOUS_MIN: _zod.z.coerce.number().int().positive().default(180),
  LOCATION_EMIT_THROTTLE_MS: _zod.z.coerce.number().int().positive().default(5000),
  LOCATION_PERSIST_THROTTLE_MS: _zod.z.coerce.number().int().positive().default(15000),
  VAPID_PUBLIC_KEY: _zod.z.string().optional().default(''),
  VAPID_PRIVATE_KEY: _zod.z.string().optional().default(''),
  VAPID_SUBJECT: _zod.z.string().optional().default('mailto:admin@example.com'),
  GEMINI_API_KEY: _zod.z.string().optional().default(''),
  GEMINI_MODEL: _zod.z.string().default('gemini-2.5-flash'),
  AI_DAILY_CALL_BUDGET: _zod.z.coerce.number().int().positive().default(150),
  KEEPALIVE_URL: _zod.z.string().optional().default(''),
  LOG_LEVEL: _zod.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});
function loadEnv() {
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
  const CORS_ORIGIN_LIST = data.CORS_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  return {
    ...data,
    CORS_ORIGIN_LIST
  };
}
const env = loadEnv();
exports.env = env;
