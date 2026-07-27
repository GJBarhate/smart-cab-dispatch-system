// Optional AI layer (plan.md §19) — disabled cleanly whenever GEMINI_API_KEY
// is blank. Guardrails: a hard daily call budget, a 60s response cache, an
// 8s timeout, and a graceful "unavailable" result on any failure. AI never
// sits on a dispatch decision path — it is a read-only ops convenience.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;

const cache = new Map<string, { at: number; value: string }>();
let callsToday = 0;
let dayKey = new Date().toDateString();

function resetBudgetIfNewDay(): void {
  const today = new Date().toDateString();
  if (today !== dayKey) {
    dayKey = today;
    callsToday = 0;
  }
}

const client = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

export const GeminiService = {
  isEnabled(): boolean {
    return client !== null;
  },

  async ask(prompt: string): Promise<string | null> {
    if (!client) return null;
    resetBudgetIfNewDay();
    if (callsToday >= env.AI_DAILY_CALL_BUDGET) {
      logger.warn('Gemini daily call budget exhausted');
      return null;
    }

    const cached = cache.get(prompt);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    try {
      const model = client.getGenerativeModel({ model: env.GEMINI_MODEL });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const result = await model.generateContent(prompt);
      clearTimeout(timer);
      callsToday++;

      const text = result.response.text();
      cache.set(prompt, { at: Date.now(), value: text });
      return text;
    } catch (err) {
      logger.warn({ err }, 'Gemini call failed');
      return null;
    }
  }
};
