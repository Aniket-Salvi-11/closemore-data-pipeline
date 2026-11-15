import { createFileRoute } from "@tanstack/react-router";
import { CopilotWidget } from "@/components/copilot/CopilotWidget";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "CloseMore AI Copilot (development preview)" }],
  }),
  component: Index,
});

/**
 * DEVELOPMENT PREVIEW ONLY. Stands in for a page of the CloseMore website so the Copilot widget can
 * be tried with `npx vite dev`. On the real website the widget comes from dist-widget/closemore-copilot.js.
 */
function Index() {
  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">
            <span className="text-primary">Close</span>
            <span className="text-brand-orange">More</span> CRM
          </span>
          <span className="text-sm text-muted-foreground">Website preview</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-6 py-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="max-w-xl text-muted-foreground">
          This page stands in for the CloseMore website. Click the round CloseMore icon in the
          bottom-right corner to open the AI Copilot.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {["Open deals", "Won this month", "Pipeline value"].map((label) => (
            <div key={label} className="rounded-xl border border-border bg-background p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 h-6 w-24 rounded bg-muted" />
            </div>
          ))}
        </div>
      </main>
      <CopilotWidget />
    </div>
  );
}
