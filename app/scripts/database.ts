import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { databases, closeDatabases } from "../src/server/db";
import { maintenance, invalidateRestoredAuthentication } from "../src/server/maintenance";

try {
  switch (process.argv[2]) {
    case "migrate": {
      const db = databases();
      await migrate(db.records, { migrationsFolder: resolve("drizzle/records") });
      await migrate(db.temporary, { migrationsFolder: resolve("drizzle/transcripts") });
      console.log("Both database migrations completed.");
      break;
    }
    case "jobs": {
      const result = await maintenance();
      console.log(JSON.stringify(result));
      if (result.failures) process.exitCode = 1;
      break;
    }
    case "invalidate-restored-auth":
      await invalidateRestoredAuthentication();
      console.log("Restored authentication invalidated. Apply deletion/expiry state before reopening service.");
      break;
    default: throw new Error("UNKNOWN_COMMAND");
  }
} catch {
  console.error("Database command failed. Check local configuration and service availability; no connection details were logged.");
  process.exitCode = 1;
} finally { await closeDatabases(); }
