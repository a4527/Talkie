export type GeminiTokenDetail = { modality: string; tokenCount: number };
export type GeminiUsageObservation = {
  provider: "google";
  model: string;
  source: "server_response";
  status: "reported" | "missing" | "invalid" | "unavailable";
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: GeminiTokenDetail[];
  candidatesTokensDetails?: GeminiTokenDetail[];
};

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function details(value: unknown): GeminiTokenDetail[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const result: GeminiTokenDetail[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.modality !== "string" || !/^[A-Z_]{1,32}$/.test(item.modality)) return undefined;
    const count = tokenCount(item.tokenCount);
    if (count === undefined) return undefined;
    result.push({ modality: item.modality, tokenCount: count });
  }
  return result;
}

export function observeGeminiUsage(model: string, response: unknown): GeminiUsageObservation {
  const base = { provider: "google" as const, model, source: "server_response" as const };
  if (!response || typeof response !== "object" || !("usageMetadata" in response)) return { ...base, status: "missing" };
  const usage = response.usageMetadata;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return { ...base, status: "invalid" };
  const counts = ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"] as const;
  const result: GeminiUsageObservation = { ...base, status: "reported" };
  for (const key of counts) {
    const value = (usage as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const count = tokenCount(value);
    if (count === undefined) return { ...base, status: "invalid" };
    result[key] = count;
  }
  for (const key of ["promptTokensDetails", "candidatesTokensDetails"] as const) {
    const value = (usage as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const parsed = details(value);
    if (!parsed) return { ...base, status: "invalid" };
    result[key] = parsed;
  }
  if (counts.every(key => result[key] === undefined) && result.promptTokensDetails === undefined && result.candidatesTokensDetails === undefined) return { ...base, status: "invalid" };
  return result;
}
