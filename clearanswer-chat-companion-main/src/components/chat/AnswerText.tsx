import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";

/**
 * Shows the assistant's text with simple formatting: **bold**, *italic*, lists, `code`, links.
 * DISPLAY ONLY: the message text itself is never changed (it is what goes back to the backend as history).
 * Single line breaks are kept (so "Interpreted as: ..." stays on its own line); raw HTML is never rendered.
 */
const components: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-3">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  // Headings are shown as bold text so a long answer never looks like a page title.
  h1: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-3 font-semibold">{children}</p>,
};

export function AnswerText({ text }: { text: string }) {
  return (
    <div className="max-w-[68ch] text-[15px] leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkBreaks]}
        skipHtml
        components={components}
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
