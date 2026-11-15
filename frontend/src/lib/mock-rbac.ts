/**
 * DEMO ONLY (mock mode). Sample deals and the visibility rules, so the RBAC story can be shown
 * without the backend. In real mode the BACKEND applies these rules; the frontend never filters.
 *
 * Rules (same as the backend):
 * - System admin sees every deal.
 * - Sales admin sees all deals in the regions of their profile; with no region, all regions.
 * - Sales rep sees a deal only if its region is in their profile AND they own it or are on its deal team.
 *   (An owner whose profile does not include the deal's region cannot see it.)
 */
import type { DemoUser } from "@/lib/demo-users";
import { findMockUser } from "@/lib/mock-users";
import type { ResultChartSpec, ResultTableData } from "@/lib/result-data";

export interface MockDeal {
  id: string;
  name: string;
  region: string;
  owner_id: string;
  /** Users added to the deal team. They must have the deal's region in their profile. */
  team: string[];
  /** Month the deal was created, YYYY-MM. */
  created: string;
}

export const MOCK_DEALS: MockDeal[] = [
  // Indore. Rahul is on Priya's deal team for the Acme renewal.
  {
    id: "d1",
    name: "Acme renewal",
    region: "Indore",
    owner_id: "seed-u-5",
    team: ["seed-u-12"],
    created: "2026-08",
  },
  {
    id: "d2",
    name: "Beta rollout",
    region: "Indore",
    owner_id: "seed-u-5",
    team: [],
    created: "2026-09",
  },
  // Owned by Priya, but in a region that is not in her profile: hidden from her.
  {
    id: "d3",
    name: "Gamma expansion",
    region: "East",
    owner_id: "seed-u-5",
    team: [],
    created: "2026-09",
  },
  {
    id: "d4",
    name: "Delta pilot",
    region: "Indore",
    owner_id: "seed-u-12",
    team: [],
    created: "2026-10",
  },
  // East.
  {
    id: "d5",
    name: "Echo contract",
    region: "East",
    owner_id: "seed-u-6",
    team: [],
    created: "2026-07",
  },
  {
    id: "d6",
    name: "Foxtrot upsell",
    region: "East",
    owner_id: "seed-u-6",
    team: [],
    created: "2026-10",
  },
  // Japan.
  {
    id: "d7",
    name: "Kaizen supply",
    region: "Japan",
    owner_id: "seed-u-15",
    team: [],
    created: "2026-08",
  },
  {
    id: "d8",
    name: "Sakura rollout",
    region: "Japan",
    owner_id: "seed-u-15",
    team: [],
    created: "2026-09",
  },
  // Neha works in two regions (Indore and Australia).
  {
    id: "d9",
    name: "Outback mining",
    region: "Australia",
    owner_id: "seed-u-30",
    team: [],
    created: "2026-10",
  },
  {
    id: "d10",
    name: "Harbour logistics",
    region: "Indore",
    owner_id: "seed-u-30",
    team: [],
    created: "2026-08",
  },
  // Owned by the system admin; Neha is on the team (Australia is in her profile).
  {
    id: "d11",
    name: "Koala analytics",
    region: "Australia",
    owner_id: "seed-u-1",
    team: ["seed-u-30"],
    created: "2026-09",
  },
  // Only admins can see LATAM: nobody in the demo has it in their profile.
  {
    id: "d12",
    name: "Samba retail",
    region: "LATAM",
    owner_id: "seed-u-1",
    team: [],
    created: "2026-10",
  },
];

export function canSeeDeal(user: DemoUser, deal: MockDeal): boolean {
  if (user.role === "System_Admin") return true;
  if (user.role === "Sales_Admin") {
    return user.all_regions || user.profile_regions.includes(deal.region);
  }
  // Sales rep (and any role the mock does not know: the most restrictive rule applies).
  if (!user.profile_regions.includes(deal.region)) return false;
  return deal.owner_id === user.user_id || deal.team.includes(user.user_id);
}

export function visibleDeals(user: DemoUser): MockDeal[] {
  return MOCK_DEALS.filter((deal) => canSeeDeal(user, deal));
}

export interface MockAnswer {
  answer: string;
  table?: ResultTableData;
  chart?: ResultChartSpec;
}

/** Mock answer for "deals by owner", limited to what this user can see. */
export function dealsByOwner(user: DemoUser): MockAnswer {
  const deals = visibleDeals(user);
  if (deals.length === 0) return { answer: `No deals are visible to ${user.name}.` };

  const counts = new Map<string, number>();
  for (const deal of deals) {
    const owner = findMockUser(deal.owner_id)?.name ?? "Unknown";
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner, n]) => [owner, n]);

  const answer = `${user.name} can see ${deals.length} ${deals.length === 1 ? "deal" : "deals"}.`;
  const table: ResultTableData = { columns: ["Owner", "Deals"], rows, truncated: false };
  if (rows.length < 2) return { answer, table };
  return {
    answer,
    table,
    chart: { type: "bar", x: "Owner", series: ["Deals"], title: "Deals by owner" },
  };
}

/** Mock answer for "monthly trend": new deals per month among the deals this user can see. */
export function dealsPerMonth(user: DemoUser): MockAnswer {
  const deals = visibleDeals(user);
  if (deals.length === 0) return { answer: `No deals are visible to ${user.name}.` };

  const counts = new Map<string, number>();
  for (const deal of deals) counts.set(deal.created, (counts.get(deal.created) ?? 0) + 1);
  const rows = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, n]) => [`${month}-01`, n]);

  const answer = `Here are the new deals per month among the ${deals.length} deals ${user.name} can see.`;
  const table: ResultTableData = { columns: ["Month", "New deals"], rows, truncated: false };
  if (rows.length < 2) return { answer, table };
  return {
    answer,
    table,
    chart: { type: "line", x: "Month", series: ["New deals"], title: "New deals per month" },
  };
}

/** The scoped mock answers: "trend"/"month" and "owner"/"deal" questions. Anything else returns null. */
export function scopedMockAnswer(question: string, user: DemoUser): MockAnswer | null {
  const q = question.toLowerCase();
  if (/trend|month/.test(q)) return dealsPerMonth(user);
  if (/owner|deal/.test(q)) return dealsByOwner(user);
  return null;
}
