/**
 * Turns the app's stylesheet into one that works inside the widget's Shadow DOM, untouched by the
 * website's own CSS and without changing the website.
 *
 * - `:root` rules (colour tokens) are applied to `:host` (the shadow root's host) instead.
 * - `rem` sizes become `px` (1rem = 16px), so a website that changes its root font size
 *   (e.g. html { font-size: 62.5% }) can't shrink or grow the chat.
 * - `@property` and `@font-face` rules only work at document level, so they are returned
 *   separately to be added to the page head. They define names only (Tailwind's --tw-* variables,
 *   fonts) and change nothing on the website.
 */
export interface PreparedCss {
  shadowCss: string;
  documentCss: string;
}

const AT_RULE_BLOCK = /@(property|font-face)\s*[^{]*\{[^}]*\}/g;

export function prepareCss(raw: string): PreparedCss {
  const documentCss = (raw.match(AT_RULE_BLOCK) ?? []).join("\n");
  const shadowCss = raw
    .replace(AT_RULE_BLOCK, "")
    .replace(/:root\b/g, ":host")
    // Only in values. Inside a class name (e.g. `.sm\:w-\[min\(720px\,calc\(100vw-3rem\)\)\]`) the rem is always
    // followed by an escaped character; converting it there renamed the selector, so the rule matched nothing.
    .replace(
      /(-?\d*\.?\d+)rem\b(?!\\)/g,
      (_, n: string) => `${Number((Number(n) * 16).toFixed(4))}px`,
    );
  return { shadowCss, documentCss };
}
