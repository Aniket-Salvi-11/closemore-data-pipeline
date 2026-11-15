import { createContext, useContext, type ReactNode } from "react";

/**
 * Where pop-ups (fullscreen table/chart, tooltips) are attached.
 * Inside the website widget everything lives in a Shadow DOM, so pop-ups must be attached there too,
 * or they would land in the website's page without our styles. Outside the widget: document.body.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
  );
}

/** The element pop-ups should be attached to, or undefined for document.body. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
