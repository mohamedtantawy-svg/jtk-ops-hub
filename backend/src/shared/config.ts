import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),

  // PostgreSQL (optional — app serves frontend without it)
  DATABASE_URL: z.string().min(1).optional(),

  // JWT (optional — auth disabled without it)
  JWT_SECRET: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // ── Redis (required for high-throughput queue) ──────────────────────────
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_MAX_RETRIES: z.coerce.number().default(3),

  // ── DB pool tuning ──────────────────────────────────────────────────────
  DB_POOL_MAX: z.coerce.number().default(40),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().default(20_000),
  DB_POOL_CONNECTION_TIMEOUT: z.coerce.number().default(5_000),

  // ── Webhook queue tuning ────────────────────────────────────────────────
  WEBHOOK_QUEUE_CONCURRENCY: z.coerce.number().default(10),
  WEBHOOK_QUEUE_MAX_RETRIES: z.coerce.number().default(12),  // survive ~30min DB outage
  WEBHOOK_QUEUE_BACKOFF_MS: z.coerce.number().default(5_000), // 5s base → 5s,10s,20s,40s,...
  WEBHOOK_BATCH_SIZE: z.coerce.number().default(25),
  WEBHOOK_BATCH_INTERVAL_MS: z.coerce.number().default(500),

  // ── Rate limit tuning ──────────────────────────────────────────────────
  WEBHOOK_RATE_LIMIT_PER_MIN: z.coerce.number().default(600),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().default(300),

  // ── Cluster mode ────────────────────────────────────────────────────────
  CLUSTER_WORKERS: z.coerce.number().default(0), // 0 = auto (os.cpus().length)

  // ── Dedup cache ─────────────────────────────────────────────────────────
  DEDUP_CACHE_TTL_SECS: z.coerce.number().default(3600), // 1 hour

  // Deel Admin API
  DEEL_API_KEY: z.string().optional(),
  DEEL_API_BASE_URL: z.string().default('https://api.deel.com'),

  // Zendesk
  ZENDESK_SUBDOMAIN: z.string().optional(),
  ZENDESK_EMAIL: z.string().optional(),
  ZENDESK_API_TOKEN: z.string().optional(),
  ZENDESK_WEBHOOK_SECRET: z.string().optional(),

  // Jira
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_PROJECT_KEYS: z.string().default('HR,OPS'),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CHANNEL_IDS: z.string().default(''),

  // Gmail / Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GMAIL_LABEL: z.string().default('hr-ops'),

  // Zapier
  ZAPIER_WEBHOOK_SECRET: z.string().optional(),

  // Snowflake (reporting)
  SNOWFLAKE_ACCOUNT: z.string().optional(),
  SNOWFLAKE_USERNAME: z.string().optional(),
  SNOWFLAKE_PASSWORD: z.string().optional(),
  SNOWFLAKE_DATABASE: z.string().optional(),
  SNOWFLAKE_WAREHOUSE: z.string().optional(),
  SNOWFLAKE_SCHEMA: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
