import type { TitledTable } from "@/lib/api-service";
import type { CellValue, ResultTableData } from "@/lib/result-data";
import { getRowNumberMode } from "@/lib/row-number-pref";
import { copyViewOf } from "@/lib/table-view";

/** The table as on screen (sorted, filtered, with the # column). */
function onScreen(table: ResultTableData): ResultTableData {
  return copyViewOf(table, getRowNumberMode());
}

/** One cell as plain text. Numbers stay unformatted so they paste into Excel as numbers. */
function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  // A tab or line break inside a cell would break the columns when pasted.
  return String(value).replace(/[\t\r\n]+/g, " ");
}

/** A table as tab-separated text: header line, then every received row. */
export function tableToTsv(table: ResultTableData): string {
  const lines = [table.columns.map(cellText).join("\t")];
  for (const row of table.rows) {
    lines.push(table.columns.map((_, i) => cellText(row[i])).join("\t"));
  }
  return lines.join("\n");
}

/** Every titled table as on screen, one after another: title line, header, rows, blank line between tables. */
export function titledTablesToText(tables: TitledTable[]): string {
  return tables
    .map((t, i) => `${t.title || `Table ${i + 1}`}\n${tableToTsv(onScreen(t.table))}`)
    .join("\n\n");
}

interface CopyableAnswer {
  content: string;
  table?: ResultTableData | undefined;
  tables?: TitledTable[] | undefined;
}

/** The answer text followed by its table(s) as on screen (all matching rows, not only the first 50). */
export function answerToText(message: CopyableAnswer): string {
  if (message.tables && message.tables.length > 0) {
    return `${message.content}\n\n${titledTablesToText(message.tables)}`;
  }
  if (message.table && message.table.rows.length > 0) {
    return `${message.content}\n\n${tableToTsv(onScreen(message.table))}`;
  }
  return message.content;
}

/** Copies text to the clipboard. Returns false when the browser refuses. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
