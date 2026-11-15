/**
 * DEMO ONLY (mock mode). The same eight people, ids and regions the real backend returns from
 * GET /demo/users, so mock mode and real mode behave the same. Only used when VITE_USE_MOCK_API=true
 * (and by tests).
 */
import type { DemoUser } from "@/lib/demo-users";

/** Every region of the organization, in the canonical spelling the backend uses. */
export const ORG_REGIONS = ["Australia", "East", "Indore", "Japan", "LATAM"];

function person(
  user_id: string,
  name: string,
  role: string,
  role_label: string,
  profile_regions: string[],
  scope_label: string,
  all_regions = false,
): DemoUser {
  return {
    user_id,
    name,
    role,
    role_label,
    // Where this person may upload: every region for "all regions" users, otherwise their own.
    regions: all_regions ? [...ORG_REGIONS] : [...profile_regions],
    profile_regions,
    all_regions,
    scope_label,
    demo_mode: true,
  };
}

const REP_SCOPE = (regions: string) => `Your deals and deal-team deals in ${regions}`;

export const MOCK_USERS: DemoUser[] = [
  person(
    "seed-u-1",
    "Asha Verma",
    "System_Admin",
    "System admin",
    [],
    "All deals in your organization",
    true,
  ),
  person(
    "u-1786635589299-566",
    "Dev Malhotra",
    "Sales_Admin",
    "Sales admin",
    [],
    "All regions",
    true,
  ),
  person("seed-u-2", "Meera Kapoor", "Sales_Admin", "Sales admin", ["East"], "Deals in East"),
  person("seed-u-5", "Priya Nair", "Sales_Rep", "Sales rep", ["Indore"], REP_SCOPE("Indore")),
  person("seed-u-12", "Rahul Sharma", "Sales_Rep", "Sales rep", ["Indore"], REP_SCOPE("Indore")),
  person(
    "seed-u-30",
    "Neha Joshi",
    "Sales_Rep",
    "Sales rep",
    ["Indore", "Australia"],
    REP_SCOPE("Indore, Australia"),
  ),
  person("seed-u-15", "Kenji Tanaka", "Sales_Rep", "Sales rep", ["Japan"], REP_SCOPE("Japan")),
  person("seed-u-6", "Imran Khan", "Sales_Rep", "Sales rep", ["East"], REP_SCOPE("East")),
];

export function findMockUser(id: string | null | undefined): DemoUser | null {
  if (!id) return null;
  return MOCK_USERS.find((u) => u.user_id === id) ?? null;
}
