import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const recordsPassword = randomBytes(32).toString("base64url");
const transcriptsPassword = randomBytes(32).toString("base64url");
try {
  writeFileSync(".env", [
    "# Generated local synthetic-test configuration. Never commit this file.",
    `TALKIE_RECORDS_PASSWORD=${recordsPassword}`, `TALKIE_TRANSCRIPTS_PASSWORD=${transcriptsPassword}`,
    `DATABASE_URL=postgresql://talkie:${recordsPassword}@127.0.0.1:5433/talkie`,
    `TRANSCRIPT_DATABASE_URL=postgresql://talkie:${transcriptsPassword}@127.0.0.1:5434/talkie_transcripts`,
    "APP_ORIGIN=http://127.0.0.1:3000", "SMTP_HOST=127.0.0.1", "SMTP_PORT=1025", "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  console.log("Created app/.env with independent local database passwords. Existing files are never overwritten.");
} catch {
  console.error("Configuration was not written. If app/.env already exists, keep it and review app/.env.example.");
  process.exitCode = 1;
}
