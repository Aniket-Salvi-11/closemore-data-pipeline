/**
 * DEMO ONLY. Loads the people for the start-screen picker: GET /demo/users (no identity header needed).
 * Each item is the same object GET /me returns. Items without a user_id and name are skipped.
 */
import { API_CONFIG, USE_MOCK } from "@/lib/api-service";
import { parseDemoUser, type DemoUser } from "@/lib/demo-users";
import { DocumentsApiError, kindFromStatus } from "@/lib/documents-types";
import { MOCK_USERS } from "@/lib/mock-users";

export async function listDemoUsers(): Promise<DemoUser[]> {
  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return MOCK_USERS;
  }

  let response: Response;
  try {
    response = await fetch(`${API_CONFIG.baseUrl}/demo/users`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new DocumentsApiError("network");
  }
  if (!response.ok) throw new DocumentsApiError(kindFromStatus(response.status), response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new DocumentsApiError("server");
  }
  if (!Array.isArray(data)) throw new DocumentsApiError("server");
  return data.map(parseDemoUser).filter((user): user is DemoUser => user !== null);
}
