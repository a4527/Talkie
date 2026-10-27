import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/server/db/transcripts-schema.ts",
  out: "./drizzle/transcripts", tablesFilter: ["transcript_session_states", "transcript_saves"],
  dbCredentials: { url: process.env.TRANSCRIPT_DATABASE_URL ?? "" } });
