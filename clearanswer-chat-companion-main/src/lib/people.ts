/** People (or deals, contacts, products) in an answer that refers to them by letter. */

export type PersonKind = "user" | "contact" | "deal" | "product";

export interface PersonRef {
  letter: string;
  name: string;
  /** e.g. "Sales rep · Indore" */
  label: string;
  /** What the letter stands for. Missing means a person (user). */
  kind?: PersonKind;
}

/** The table column that holds the letters for each kind. */
export const LETTER_COLUMN: Record<PersonKind, string> = {
  user: "Person",
  contact: "Contact",
  deal: "Deal",
  product: "Product",
};

const KINDS: PersonKind[] = ["user", "contact", "deal", "product"];

export function kindOf(ref: PersonRef): PersonKind {
  return ref.kind ?? "user";
}

/** Reads the optional `people` list. Bad entries are skipped. */
export function parsePeople(raw: unknown): PersonRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonRef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const letter = r["letter"];
    const name = r["name"];
    const label = r["label"];
    if (typeof letter !== "string" || !letter.trim()) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    const kind = r["kind"];
    out.push({
      letter: letter.trim(),
      name: name.trim(),
      label: typeof label === "string" ? label.trim() : "",
      ...(typeof kind === "string" && (KINDS as string[]).includes(kind)
        ? { kind: kind as PersonKind }
        : {}),
    });
  }
  // Lists run A–Z; people after the 26th get a number instead of a letter, so allow more than 26.
  return out.slice(0, 60);
}

/**
 * For a table: which columns hold letters, and who each letter is.
 * A column counts only when its name is Person / Deal / Contact / Product AND the key has entries
 * of that kind, so an ordinary "Deal" column of deal names is never turned into badges.
 */
export function letterColumns(
  columns: string[],
  people: PersonRef[] | undefined,
): Map<number, Map<string, PersonRef>> {
  const out = new Map<number, Map<string, PersonRef>>();
  if (!people || people.length === 0) return out;
  for (const kind of KINDS) {
    const refs = people.filter((p) => kindOf(p) === kind);
    if (refs.length === 0) continue;
    const col = columns.indexOf(LETTER_COLUMN[kind]);
    if (col === -1) continue;
    out.set(col, new Map(refs.map((r) => [r.letter, r])));
  }
  return out;
}

/** "A, C": selected letters in A–Z order. */
export function joinLetters(letters: Iterable<string>): string {
  // Letters A–Z first, then the numbered people (27, 28, …) in number order.
  const rank = (x: string) => (/^\d+$/.test(x) ? 1000 + Number(x) : x.toUpperCase().charCodeAt(0));
  return [...letters].sort((a, b) => rank(a) - rank(b)).join(", ");
}

const FOLLOW_UP_TEXT: Record<string, string> = {
  deals: "Show deals of",
  contacts: "Show contacts of",
  everything: "Show everything about",
};

/**
 * A follow-up narrowed to the selected letters, e.g. "Show deals of C".
 * Returns null when nothing is selected or the action is unknown (then the button is used as sent).
 */
export function narrowedFollowUp(action: string | undefined, selected: Set<string>): string | null {
  const prefix = action ? FOLLOW_UP_TEXT[action] : undefined;
  if (!prefix || selected.size === 0) return null;
  return `${prefix} ${joinLetters(selected)}`;
}
