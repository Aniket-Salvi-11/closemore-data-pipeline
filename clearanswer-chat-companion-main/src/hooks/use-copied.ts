import { useCallback, useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/copy-text";

/** Copy helper: `copied` is true for 2 seconds after a successful copy. */
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) return false;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
    return true;
  }, []);

  return { copied, copy };
}
