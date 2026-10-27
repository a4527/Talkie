import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/server/db/records-schema.ts",
  out: "./drizzle/records", tablesFilter: ["users", "email_auth_rate_limits", "email_auth_requests", "login_sessions", "learning_sessions", "learning_session_notes", "scheduled_jobs"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" } });
