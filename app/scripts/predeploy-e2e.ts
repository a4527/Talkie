/** Run local predeployment checks only against fresh, disposable databases. */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";

function databaseUrl(name: "DATABASE_URL" | "TRANSCRIPT_DATABASE_URL") {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  const url = new URL(value);
  if (!/^talkie(_transcripts)?$/.test(url.pathname.slice(1))) throw new Error(`${name}_BASE_DATABASE_REQUIRED`);
  if (!/^127\.0\.0\.1$|^localhost$/.test(url.hostname)) throw new Error(`${name}_LOCAL_ONLY`);
  return url;
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`CHECK_FAILED: ${args.at(-1) ?? "unknown"} (${code})`)));
  });
}

async function main() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const inputs = [databaseUrl("DATABASE_URL"), databaseUrl("TRANSCRIPT_DATABASE_URL")];
  const admins = inputs.map(url => { const admin = new URL(url); admin.pathname = "/postgres"; return new Pool({ connectionString: admin.toString() }); });
  const names = inputs.map((_, i) => `talkie_test_predeploy_${i}_${suffix}`);
  const nextEnvBefore = readFileSync("next-env.d.ts", "utf8");
  const env: NodeJS.ProcessEnv = { ...process.env, APP_ORIGIN: "http://127.0.0.1:3100", TALKIE_STORAGE_E2E: "1", TALKIE_E2E_PRODUCTION: "1", MAILPIT_TEST_ORIGIN: process.env.MAILPIT_TEST_ORIGIN ?? "http://127.0.0.1:8025" };
  for (let i = 0; i < inputs.length; i++) { const url = new URL(inputs[i]); url.pathname = `/${names[i]}`; env[i === 0 ? "DATABASE_URL" : "TRANSCRIPT_DATABASE_URL"] = url.toString(); }
  let created = 0, cleanupFailed = false;
  try {
    for (let i = 0; i < admins.length; i++) { await admins[i].query(`CREATE DATABASE "${names[i]}"`); created++; }
    await run(["--conditions=react-server", "--env-file-if-exists=.env", "--import", "tsx", "scripts/database.ts", "migrate"], env);
    await run(["--conditions=react-server", "--env-file-if-exists=.env", "--import", "tsx", "--test", "tests/server.test.ts"], env);
    await run(["node_modules/next/dist/bin/next", "build"], env);
    await run(["node_modules/@playwright/test/cli.js", "test", "--config", "tests/browser/playwright.config.ts"], env);
    await run(["--conditions=react-server", "--env-file-if-exists=.env", "--import", "tsx", "scripts/smoke-voice.ts"], env);
  } finally {
    const generatedNextEnv = nextEnvBefore.replaceAll("./.next/dev/types/", "./.next/types/");
    try { if (readFileSync("next-env.d.ts", "utf8") === generatedNextEnv) writeFileSync("next-env.d.ts", nextEnvBefore); }
    catch { cleanupFailed = true; console.error("NEXT_ENV_RESTORE_FAILED"); }
    for (let i = 0; i < created; i++) {
      try { await admins[i].query(`DROP DATABASE IF EXISTS "${names[i]}" WITH (FORCE)`); }
      catch { cleanupFailed = true; console.error(`TEST_DATABASE_CLEANUP_FAILED: ${names[i]}`); }
    }
    await Promise.all(admins.map(pool => pool.end()));
  }
  if (cleanupFailed) throw new Error("PREDEPLOY_CLEANUP_FAILED");
  console.log("PREDEPLOY_E2E_PASSED");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "PREDEPLOY_E2E_FAILED"); process.exitCode = 1; });
