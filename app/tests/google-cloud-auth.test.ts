import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ execFile: vi.fn((_command, _args, _options, callback) => {
  callback(null, "synthetic-access-token\n", "");
}) }));
import { execFile } from "node:child_process";
import { getCloudTtsAccessToken } from "../src/server/google-cloud-auth";

it("mints a Cloud token from local ADC and reuses it without exposing it", async () => {
  vi.stubEnv("GOOGLE_CLOUD_TTS_ACCESS_TOKEN", "expired-manual-token");
  vi.stubEnv("GCLOUD_BIN", "/synthetic/gcloud");
  expect(await getCloudTtsAccessToken()).toBe("synthetic-access-token");
  expect(await getCloudTtsAccessToken()).toBe("synthetic-access-token");
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(execFile).mock.calls[0].slice(0, 2)).toEqual(["/synthetic/gcloud", ["auth", "application-default", "print-access-token"]]);
  vi.unstubAllEnvs();
});
