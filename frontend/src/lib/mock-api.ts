/**
 * Simulated answers for development (VITE_USE_MOCK_API=true). Never part of the website build:
 * vite.widget.config.ts swaps this file for widget/no-mock.ts.
 */
import type { DemoUser as MockPerson } from "@/lib/demo-users";
import { findMockUser } from "@/lib/mock-users";
import { scopedMockAnswer } from "@/lib/mock-rbac";
import type { ResultTableData } from "@/lib/result-data";
import type { AnswerScope, AnswerSource, AskResponse } from "@/lib/api-service";

/* ------------------------------------------------------------------ */
/* Mock backend (used while USE_MOCK is true)                          */
/* ------------------------------------------------------------------ */

const MOCK_ANSWERS = [
  "Here's a quick summary: the key idea is to break the problem into smaller, verifiable steps, then check each one against the data you already have. That keeps the answer grounded and easy to follow.",
  "Short answer: yes, with a caveat. It works well for most everyday cases, but you'll want to double-check edge cases where the underlying assumptions change.",
  "Think of it in three parts:\n\n1. What it is — a structured way of turning raw input into a usable result.\n2. Why it matters — it removes manual guesswork and keeps results consistent.\n3. How to start — define your input, define the expected output, then iterate on the middle.",
  "The main factors are cost, speed, and reliability. Cost favors the simple option, speed favors the automated one, and reliability usually comes from combining both with a human review step at the end.",
  "That depends on your setup, but in most configurations the default behavior is the right starting point. Change it only when you have a concrete reason — measure first, then adjust.",
];

const MOCK_OWNER_TABLE: ResultTableData = {
  columns: ["Owner", "Deals", "Won"],
  rows: [
    ["Aman Jain", 12480, 5200],
    ["Raman Mathur", 9300, 4100],
    ["Priya Nair", 7150, 3900],
    ["Karan Shah", 4020, null],
  ],
  truncated: false,
};

const MOCK_TREND_TABLE: ResultTableData = {
  columns: ["Month", "New deals"],
  rows: [
    ["2026-06-01", 14],
    ["2026-07-01", 18],
    ["2026-08-01", 11],
    ["2026-09-01", 23],
    ["2026-10-01", 27],
  ],
  truncated: false,
};

const MOCK_CONTACT_TABLE: ResultTableData = {
  columns: ["Contact", "Company", "Phone", "Active"],
  rows: Array.from({ length: 50 }, (_, i) => [
    `Contact ${i + 1}`,
    i % 4 === 0 ? null : `Company ${(i % 7) + 1}`,
    i % 3 === 0 ? null : `+91 98765 ${String(10000 + i)}`,
    i % 5 !== 0,
  ]),
  truncated: true,
};

/** Canned answer for the case where nobody is selected (not normally reachable: the picker comes first). */
function genericMockAnswer(q: string): AskResponse {
  if (/trend|month/.test(q)) {
    return {
      answer: "New deals have grown from 14 in June to 27 in October, with a dip in August.",
      table: MOCK_TREND_TABLE,
      chart: { type: "line", x: "Month", series: ["New deals"], title: "New deals per month" },
    };
  }
  if (/contact/.test(q)) {
    return {
      answer: "Here are the contacts. Some have no company or phone on record.",
      table: MOCK_CONTACT_TABLE,
    };
  }
  if (/owner|deal/.test(q)) {
    return {
      answer: "Aman Jain has the most deals by value, followed by Raman Mathur.",
      table: MOCK_OWNER_TABLE,
      chart: {
        type: "bar",
        x: "Owner",
        series: ["Deals", "Won"],
        title: "Deal value by owner",
      },
    };
  }
  const answer = MOCK_ANSWERS[Math.floor(Math.random() * MOCK_ANSWERS.length)] ?? MOCK_ANSWERS[0]!;
  return { answer };
}

const MOCK_DOCUMENT_ANSWER =
  "No, the on-prem infrastructure does not use AWS.\nAccording to **Source 2, page 7**, all production workloads run in the company's own data centres.\n\nThings to know:\n- Backups are copied to a second site every night.\n- A *cloud-based* disaster recovery plan is listed as a future option.";

const MOCK_SOURCES: AnswerSource[] = [
  {
    n: 2,
    document: "Security policy",
    page: 7,
    doc_id: null,
    snippet:
      "All production workloads run in the company's own data centres. No public cloud services are used for customer data.",
  },
];

function scopeOf(user: MockPerson | null): { scope?: AnswerScope } {
  return user && user.scope_label ? { scope: { label: user.scope_label } } : {};
}

/**
 * Simulates the backend: a short delay, then a canned answer.
 * Demo triggers (VITE_USE_MOCK_API=true): "owner"/"deal" and "trend"/"month" questions are answered from
 * the sample deals the ACTIVE USER may see (same rules as the backend); "contact" gets a long table with
 * empty cells and the truncated notice; anything else gets a text-only answer.
 * Like the real backend, every answer carries `scope` describing whose data it covers.
 */
export async function mockAsk(question: string): Promise<AskResponse> {
  const delay = 900 + Math.random() * 900;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const q = question.toLowerCase();
  // Development only: answer as the sample system admin.
  const user = findMockUser("seed-u-1") ?? null;
  // Demo of a long bar chart: long names and more bars than fit, so it scrolls sideways.
  if (/\btop\b/.test(q)) {
    const companies = [
      "Wonka Industries",
      "Stark Industries",
      "Acme Corp",
      "Wayne Enterprises",
      "Aperture Labs",
      "Umbrella Corp",
    ];
    const rows = Array.from({ length: 12 }, (_, i) => [
      i === 0 ? "TATA DEAL" : `Seed Deal ${40 - i * 3} — ${companies[i % companies.length]}`,
      Math.round((252000 - i * 14700 + (i % 3) * 3100) * 100) / 100,
    ]);
    return {
      answer: "Found 12 deals. The details are in the table.",
      route: "SQL",
      table: { columns: ["Deal Name", "Deal Value"], rows, truncated: false },
      chart: {
        type: "bar",
        x: "Deal Name",
        series: ["Deal Value"],
        title: "Deal Value by Deal Name",
      },
      ...scopeOf(user),
    };
  }

  // Demo of the letters flow: several people share a name; tick some and "Show selected".
  const lettersAsked = q.trim().replace(/^show (deals|contacts) of |^show everything about /, "");
  if (
    /^[a-d](\s*(,|and)\s*[a-d])*$/.test(lettersAsked) &&
    (lettersAsked !== q.trim() || /[,]|and/.test(lettersAsked))
  ) {
    const all = q.trim() === "all";
    const picked = all ? ["A", "B", "C", "D"] : (q.toUpperCase().match(/[A-D]/g) ?? []);
    const names: Record<string, [string, string]> = {
      A: ["Aman Kapoor", "Sales rep · Indore"],
      B: ["Aman Mehta", "Sales rep · Pune"],
      C: ["Aman Shah", "Executive · Japan"],
      D: ["Aman Verma", "Sales admin · East"],
    };
    const deals: Record<string, [string, number][]> = {
      A: [
        ["Alpha Steel", 9000],
        ["Indus Mills", 4200],
      ],
      B: [["Pune Logistics", 3100]],
      C: [
        ["Tokyo Rail", 7500],
        ["Osaka Port", 6100],
      ],
      D: [["East Grid", 8800]],
    };
    return {
      answer: `Showing results for ${picked.length} people: ${picked.map((l) => `${l} = ${names[l]?.[0]}`).join(", ")}.`,
      route: "SQL",
      people_more: ["A", "B", "C", "D"]
        .filter((l) => !picked.includes(l))
        .map((l) => ({
          letter: l,
          name: names[l]?.[0] ?? "",
          label: names[l]?.[1] ?? "",
          kind: "user" as const,
        })),
      people: picked.map((l) => ({
        letter: l,
        name: names[l]?.[0] ?? "",
        label: names[l]?.[1] ?? "",
        kind: "user" as const,
      })),
      choices: [
        {
          label: "Show their deals",
          value: `Show deals of ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "deals",
        },
        {
          label: "Show their contacts",
          value: `Show contacts of ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "contacts",
        },
        {
          label: "Show everything",
          value: `Show everything about ${picked.join(", ")}`,
          kind: "followup" as const,
          action: "everything",
        },
      ],
      table: {
        columns: ["Person", "Deal Name", "Deal Value"],
        rows: picked.flatMap((l) => (deals[l] ?? []).map(([d, v]) => [l, d, v])),
        truncated: false,
      },
      ...scopeOf(user),
    };
  }
  if (/aman/.test(q) && /neha/.test(q)) {
    return {
      answer:
        'I found several matches for 2 names:\nAman\nA. Aman Kapoor · Sales rep · Indore · 1 deal\nB. Aman Mehta · Sales rep · Indore · 1 deal\nNeha Rao\nC. Sales rep · Indore · 0 deals\nD. Sales rep · Pune · 0 deals\n\nWhich ones? Reply with one letter for each name, like "A, C", or all.',
      choice_prompt: "I found several matches for 2 names. Which ones?",
      choices: [
        {
          label: "A. Aman Kapoor · Sales rep · Indore · 1 deal",
          value: "A",
          kind: "option" as const,
          letter: "A",
          group: "Aman",
        },
        {
          label: "B. Aman Mehta · Sales rep · Indore · 1 deal",
          value: "B",
          kind: "option" as const,
          letter: "B",
          group: "Aman",
        },
        {
          label: "C. Sales rep · Indore · 0 deals",
          value: "C",
          kind: "option" as const,
          letter: "C",
          group: "Neha Rao",
        },
        {
          label: "D. Sales rep · Pune · 0 deals",
          value: "D",
          kind: "option" as const,
          letter: "D",
          group: "Neha Rao",
        },
        { label: "All 4", value: "all", kind: "all" as const },
      ],
      route: "SQL",
      ...scopeOf(user),
    };
  }
  if (/aman/.test(q)) {
    const list = [
      ["A", "Aman Kapoor · Sales rep · Indore · 3 deals"],
      ["B", "Aman Mehta · Sales rep · Pune · 2 deals"],
      ["C", "Aman Shah · Executive · Japan · 2 deals"],
      ["D", "Aman Verma · Sales admin · East · 1 deal"],
    ] as const;
    return {
      answer: `I found 4 people named Aman:\n${list.map(([l, t]) => `${l}. ${t}`).join("\n")}\n\nWhich one? Reply A, B, C or D, several like "A, D", or all.`,
      choice_prompt: "I found 4 people named Aman. Which one?",
      choices: [
        ...list.map(([l, t]) => ({
          label: `${l}. ${t}`,
          value: l,
          kind: "option" as const,
          letter: l,
        })),
        { label: "All 4", value: "all", kind: "all" as const },
      ],
      route: "SQL",
      ...scopeOf(user),
    };
  }

  // Demo of the "which one?" flow: a name that two people share, then the reply.
  if (/^(1|2|both|all|the other one)$/.test(q.trim())) {
    return {
      answer: `Showing results for ${q.trim() === "1" ? "Priya Nair (Sales rep · Indore · 4 deals)" : q.trim() === "2" ? "Priya Nair (Executive · Japan · 2 deals)" : "all 2 people named Priya Nair"}.`,
      route: "SQL",
      ...scopeOf(user),
    };
  }
  if (/priya/.test(q) && /all data|everything/.test(q)) {
    return {
      answer:
        "Everything about Priya Nair: 4 owned deals worth 10,000, 1 deal-team deal and 1 contact. Tasks and activities are not available in the Copilot.",
      route: "SQL",
      tables: [
        {
          title: "Profile",
          table: {
            columns: ["Name", "Role", "Region"],
            rows: [["Priya Nair", "Sales rep", "Indore"]],
            truncated: false,
          },
        },
        {
          title: "Deals owned",
          table: {
            columns: ["Deal", "Value"],
            rows: [
              ["Acme renewal", 4000],
              ["Beta rollout", 6000],
            ],
            truncated: false,
          },
        },
        {
          title: "Contacts",
          table: {
            columns: ["Contact", "Company"],
            rows: [["Ravi Menon", "Acme"]],
            truncated: false,
          },
        },
      ],
      ...scopeOf(user),
    };
  }
  if (/priya/.test(q)) {
    return {
      answer:
        "I found 2 people named Priya Nair:\n1. Sales rep · Indore · 4 deals\n2. Executive · Japan · 2 deals\n\nWhich one? Reply 1 or 2, or both.",
      route: "SQL",
      choices: [
        { label: "1. Sales rep · Indore · 4 deals", value: "1" },
        { label: "2. Executive · Japan · 2 deals", value: "2" },
        { label: "Both", value: "all" },
      ],
      ...scopeOf(user),
    };
  }
  if (/document|policy|aws|source|infrastructure/.test(q)) {
    return {
      answer: MOCK_DOCUMENT_ANSWER,
      route: "RAG",
      sources: MOCK_SOURCES,
      ...scopeOf(user),
    };
  }
  const answer = (user ? scopedMockAnswer(q, user) : null) ?? genericMockAnswer(q);
  const route = answer.table ? "SQL" : null;
  return { ...answer, ...(route ? { route } : {}), ...scopeOf(user) };
}
