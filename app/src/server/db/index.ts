import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./records-schema";

const globalDb = globalThis as typeof globalThis & { talkieDatabases?: ReturnType<typeof connect> };
function connect() {
  const recordsDatabaseUrl = process.env.DATABASE_URL;
  const transcriptsDatabaseUrl = process.env.TRANSCRIPT_DATABASE_URL;
  if (!recordsDatabaseUrl || !transcriptsDatabaseUrl) throw new Error("DATABASE_CONFIGURATION_REQUIRED");
  const a = new URL(recordsDatabaseUrl), b = new URL(transcriptsDatabaseUrl);
  if (a.hostname === b.hostname && (a.port || "5432") === (b.port || "5432")) throw new Error("SEPARATE_DATABASE_INSTANCES_REQUIRED");
  const options = { max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10_000,
    statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 };
  const recordsPool = new Pool({ ...options, connectionString: recordsDatabaseUrl });
  const transcriptsPool = new Pool({ ...options, connectionString: transcriptsDatabaseUrl });
  // Never emit driver errors: they may contain SQL, parameters or connection details.
  recordsPool.on("error", () => {});
  transcriptsPool.on("error", () => {});
  return { records: drizzle(recordsPool, { schema }), transcripts: drizzle(transcriptsPool, { schema }), recordsPool, transcriptsPool };
}
export function databases() { return globalDb.talkieDatabases ??= connect(); }
export async function closeDatabases() {
  const db = globalDb.talkieDatabases;
  if (db) await Promise.all([db.recordsPool.end(), db.transcriptsPool.end()]);
  delete globalDb.talkieDatabases;
}
export type RecordsDatabase = ReturnType<typeof databases>["records"];
export type RecordsTransaction = Parameters<Parameters<RecordsDatabase["transaction"]>[0]>[0];
