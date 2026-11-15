/**
 * DEMO ONLY. Types and small helpers for the people shown in the start-screen dropdown.
 * The list itself comes from the backend (GET /demo/users); in mock mode it comes from mock-users.ts.
 * In production this file goes away: identity comes from a real login.
 */

/** The same object that GET /demo/users (each list item) and GET /me return. */
export interface DemoUser {
  user_id: string;
  name: string;
  /** Machine role such as "Sales_Rep". Never used for display. */
  role: string;
  /** Display label: "System admin" | "Sales admin" | "Executive" | "Sales rep" (others are shown as sent). */
  role_label: string;
  /** Regions this user may UPLOAD documents into. */
  regions: string[];
  /** Regions in the user's profile. Use these for display. */
  profile_regions: string[];
  all_regions: boolean;
  /** Ready-made header text describing what this user can see. */
  scope_label: string;
  demo_mode: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** "Sales_Rep" -> "Sales rep". Only used when the backend sends no role_label. */
function labelFromRole(role: string): string {
  const text = role.replace(/_/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "User";
}

/**
 * Reads one untrusted person object. Returns null unless it has a user_id and a name;
 * every other field falls back to a safe default so one odd value never breaks the picker.
 */
export function parseDemoUser(raw: unknown): DemoUser | null {
  if (!isRecord(raw)) return null;
  const { user_id, name, role, role_label, regions, profile_regions, all_regions, scope_label } =
    raw;
  if (typeof user_id !== "string" || !user_id) return null;
  if (typeof name !== "string" || !name) return null;

  const roleText = typeof role === "string" ? role : "";
  return {
    user_id,
    name,
    role: roleText,
    role_label:
      typeof role_label === "string" && role_label.trim()
        ? role_label.trim()
        : labelFromRole(roleText),
    regions: stringList(regions),
    profile_regions: stringList(profile_regions),
    all_regions: all_regions === true,
    scope_label: typeof scope_label === "string" ? scope_label.trim() : "",
    demo_mode: raw["demo_mode"] === true,
  };
}

/** Order of the groups in the picker. Labels not listed here follow, alphabetically. */
export const ROLE_LABEL_ORDER: readonly string[] = [
  "System admin",
  "Sales admin",
  "Executive",
  "Sales rep",
];

export interface RoleGroup {
  label: string;
  users: DemoUser[];
}

/** Groups people by role_label for the picker. An unknown label such as "Auditor" just gets its own group. */
export function groupByRole(users: DemoUser[]): RoleGroup[] {
  const groups = new Map<string, DemoUser[]>();
  for (const user of users) {
    const list = groups.get(user.role_label);
    if (list) list.push(user);
    else groups.set(user.role_label, [user]);
  }

  const rank = (label: string): number => {
    const index = ROLE_LABEL_ORDER.indexOf(label);
    return index === -1 ? ROLE_LABEL_ORDER.length : index;
  };
  const labels = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return labels.map((label) => ({ label, users: groups.get(label) ?? [] }));
}

/** Short region text for the picker and header, from profile_regions. */
export function regionLabel(user: DemoUser): string {
  if (user.profile_regions.length > 0) return user.profile_regions.join(", ");
  return user.all_regions ? "All regions" : "No region";
}
