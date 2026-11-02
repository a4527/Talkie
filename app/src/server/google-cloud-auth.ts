import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppError } from "./config";

let cached: { token: string; until: number } | undefined;

/** Local test only: mint an OAuth token from the user's existing ADC login. */
export async function getCloudTtsAccessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const localCli = join(homedir(), "google-cloud-sdk", "bin", "gcloud");
  const command = process.env.GCLOUD_BIN?.trim() || (existsSync(localCli) ? localCli : "gcloud");
  try {
    const stdout = await new Promise<string>((resolve, reject) => execFile(command, ["auth", "application-default", "print-access-token"], {
      timeout: 10000, maxBuffer: 16 * 1024,
      env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1", CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true" },
    }, (error, output) => error ? reject(error) : resolve(output)));
    const token = stdout.trim();
    if (!token || token.length > 10000 || /\s/.test(token)) throw new Error("INVALID_TOKEN");
    cached = { token, until: Date.now() + 45 * 60 * 1000 };
    return token;
  } catch { throw new AppError("VOICE_KEY_REQUIRED", 503); }
}
