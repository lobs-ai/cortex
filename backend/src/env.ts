import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT || 9009),
  DATABASE_URL: process.env.DATABASE_URL || "",
  REDIS_URL: process.env.REDIS_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || "dev-secret",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "dev-encryption-key",
  CORTEX_ENV: process.env.CORTEX_ENV || "dev",
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "http://localhost:3030,http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  LLM_MODEL: process.env.LLM_MODEL || "claude-sonnet-4-6",
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "",
  DISCORD_DEFAULT_USER_ID: process.env.DISCORD_DEFAULT_USER_ID || "",
};

export const isPostgres = env.DATABASE_URL.startsWith("postgres");
