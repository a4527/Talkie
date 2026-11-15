import { CascadeAdapter } from "./adapters/cascade";
import { GeminiLiveAdapter, type GeminiLiveCredential } from "./adapters/gemini-live";
import type { CascadeProviders } from "./cascade/providers";
import type { VoiceListener, VoicePort } from "./port";
import type { MissionMode } from "../mission/definitions";
import type { MissionEndingAdvisor } from "../mission/realtime";

export type VoiceConnection =
  | { provider: "gemini-live"; credential: GeminiLiveCredential }
  | { provider: "cascade"; providers: CascadeProviders; learning?: boolean; missionMode?: MissionMode };
/** App composition seam; server credentials must never enter a client-side configuration. */
export function createVoicePort(connection: VoiceConnection, emit: VoiceListener, missionAdvisor?: MissionEndingAdvisor): VoicePort {
  if (connection.provider === "cascade") return new CascadeAdapter(connection.providers, emit, { learning: connection.learning, missionMode: connection.missionMode, missionAdvisor });
  return new GeminiLiveAdapter(connection.credential, emit, undefined, missionAdvisor);
}
