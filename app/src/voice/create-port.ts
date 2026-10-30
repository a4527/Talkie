import { CascadeAdapter } from "./adapters/cascade";
import { GeminiLiveAdapter, type GeminiLiveCredential } from "./adapters/gemini-live";
import type { CascadeProviders } from "./cascade/providers";
import type { VoiceListener, VoicePort } from "./port";

export type VoiceConnection =
  | { provider: "gemini-live"; credential: GeminiLiveCredential }
  | { provider: "cascade"; providers: CascadeProviders; learning?: boolean };
/** App composition seam; server credentials must never enter a client-side configuration. */
export function createVoicePort(connection: VoiceConnection, emit: VoiceListener): VoicePort {
  if (connection.provider === "cascade") return new CascadeAdapter(connection.providers, emit, { learning: connection.learning });
  return new GeminiLiveAdapter(connection.credential, emit);
}
