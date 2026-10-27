import "server-only";

export function getLocalConfig() {
  const origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (!local || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("LOCAL_ORIGIN_REQUIRED");
  }
  const smtpHost = process.env.SMTP_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(smtpHost)) throw new Error("LOCAL_SMTP_REQUIRED");
  const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error("INVALID_SMTP_PORT");
  return { origin: origin.origin, secure: origin.protocol === "https:", smtpHost, smtpPort };
}

export class AppError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

export function normalizeTestEmailAddress(input: unknown): string {
  if (typeof input !== "string") throw new AppError("INVALID_EMAIL");
  const email = input.trim();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new AppError("INVALID_EMAIL");
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1).toLowerCase();
  // This first integration accepts synthetic addresses only; no real mail provider is approved.
  if (!domain.endsWith(".test")) throw new AppError("SYNTHETIC_EMAIL_REQUIRED");
  return email.slice(0, at) + "@" + domain;
}
