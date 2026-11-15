/** Stand-in for lib/mock-api.ts in the website build: simulated answers are never shipped. */
import type { AskResponse } from "@/lib/api-service";

export async function mockAsk(): Promise<AskResponse> {
  throw new Error("Mock answers are not available in the website build.");
}
