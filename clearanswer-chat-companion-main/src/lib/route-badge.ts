/**
 * Turns the backend's `route` into a small badge text. Display only.
 * Unknown or missing values give no badge, so a new backend route never breaks the screen.
 */
export function routeBadge(route: string | undefined): string | null {
  if (!route) return null;
  const r = route.trim().toLowerCase();
  if (r === "both") return "From CRM data + documents";
  if (["rag", "doc", "docs", "document", "documents", "pdf"].includes(r)) return "From documents";
  if (["sql", "text_to_sql", "text2sql", "database", "db", "crm", "data"].includes(r)) {
    return "From CRM data";
  }
  return null;
}
