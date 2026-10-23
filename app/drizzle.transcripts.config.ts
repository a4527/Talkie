import { defineConfig } from "drizzle-kit";
export default defineConfig({ dialect: "postgresql", schema: "./src/server/db/transcript-schema.ts",
  out: "./drizzle/transcripts", tablesFilter: ["transcript_sessions", "transcript_versions"],
  dbCredentials: { url: process.env.TRANSCRIPT_DATABASE_URL ?? "" } });
