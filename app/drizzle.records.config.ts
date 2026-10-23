import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/server/db/schema.ts",
  out: "./drizzle/records", tablesFilter: ["users", "auth_request_controls", "auth_challenges", "auth_sessions", "deletion_confirmations", "learning_sessions", "session_notes", "scheduled_jobs"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" } });
