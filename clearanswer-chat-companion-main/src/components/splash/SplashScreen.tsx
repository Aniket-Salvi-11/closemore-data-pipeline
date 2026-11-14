import { useEffect, useState, type CSSProperties } from "react";
import {
  HAND_BLUE,
  HAND_ORANGE,
  ICON_VIEWBOX,
  KNUCKLES,
  RING_BLUE,
  RING_ORANGE,
  WORDMARK,
  WORDMARK_VIEWBOX,
} from "@/components/splash/logo-paths";
import { cn } from "@/lib/utils";

/** How long the splash stays before it fades out by itself (ms). */
export const SPLASH_DURATION_MS = 3300;
/** Shorter stay for people who ask their system for reduced motion (ms). */
export const SPLASH_REDUCED_MOTION_MS = 1200;
/** Fade-out time (ms). Must match `duration-[400ms]` below plus a small margin. */
export const SPLASH_FADE_MS = 450;

const SEEN_KEY = "closemore-splash-seen";

type Phase = "show" | "leaving" | "done";

/**
 * All motion lives in CSS so it starts on the very first paint, even before React hydrates.
 * Every animated element rests in its FINAL position, so with animations switched off
 * (reduced motion) the static logo is shown.
 *
 * Timeline (seconds): ring draws 0.1-0.85, hands slide in 0.5-1.3, fingers grip 1.1-1.5,
 * handshake 1.5-2.2, letters rise 1.8-2.6, tagline 2.3-2.8.
 */
const CSS = `
.cm-splash__ring-mask{stroke-dasharray:1;stroke-dashoffset:0;animation:cm-ring-draw .75s cubic-bezier(.65,0,.35,1) .1s both}
.cm-splash__hand-l{animation:cm-hand-l .8s cubic-bezier(.22,.9,.3,1) .5s both}
.cm-splash__hand-r{animation:cm-hand-r .8s cubic-bezier(.22,.9,.3,1) .5s both}
.cm-splash__knuckle{transform-box:fill-box;transform-origin:50% 50%;animation:cm-grip .38s cubic-bezier(.3,1.4,.5,1) calc(1.1s + var(--i) * .07s) both}
.cm-splash__shake{transform-origin:160px 175px;animation:cm-shake .7s ease-in-out 1.5s both}
.cm-splash__letter{animation:cm-rise .45s cubic-bezier(.2,.8,.2,1) calc(1.8s + var(--i) * .045s) both}
.cm-splash__tagline{animation:cm-fade .5s ease-out 2.3s both}
@keyframes cm-ring-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes cm-hand-l{from{transform:translateX(-150px);opacity:0}25%{opacity:1}85%{transform:translateX(3px)}to{transform:translateX(0)}}
@keyframes cm-hand-r{from{transform:translateX(150px);opacity:0}25%{opacity:1}85%{transform:translateX(-3px)}to{transform:translateX(0)}}
@keyframes cm-grip{from{opacity:0;transform:translate(26px,-6px) scale(.7)}70%{opacity:1;transform:translate(-2px,1px) scale(1.06)}to{opacity:1;transform:none}}
@keyframes cm-shake{0%,100%{transform:translateY(0) rotate(0)}15%{transform:translateY(-5px) rotate(-1.4deg)}35%{transform:translateY(4px) rotate(1.1deg)}55%{transform:translateY(-4px) rotate(-.9deg)}75%{transform:translateY(2px) rotate(.5deg)}}
@keyframes cm-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes cm-fade{from{opacity:0}to{opacity:1}}
`;

/** Added only when the splash respects the "reduce motion" setting: shows the still logo instead. */
const REDUCED_MOTION_CSS = `@media (prefers-reduced-motion:reduce){.cm-splash *{animation:none!important}}`;

interface SplashScreenProps {
  /** Called once the splash has faded out and been removed. */
  onDone?: () => void;
  /** Show the splash only once per browser tab session. Default: every page load (good for demos). */
  oncePerSession?: boolean;
  /**
   * Default true: people whose system asks for reduced motion (on Windows, "Animation effects" off)
   * get the still logo for about a second. Set false to always play the full animation, e.g. on a demo laptop.
   */
  respectReducedMotion?: boolean;
}

function readSeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage can be blocked; the splash then simply shows every time.
  }
}

/**
 * Full-screen intro that "builds" the CloseMore logo: the ring draws, two hands slide in,
 * shake, and the name appears. Can be skipped with the Skip button or the Escape key.
 */
export function SplashScreen({
  onDone,
  oncePerSession = false,
  respectReducedMotion = true,
}: SplashScreenProps) {
  const [phase, setPhase] = useState<Phase>("show");

  // Optional "only once per tab" behaviour.
  useEffect(() => {
    if (!oncePerSession) return;
    if (readSeen()) {
      setPhase("done");
      onDone?.();
    } else {
      writeSeen();
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-leave after the animation has played.
  useEffect(() => {
    if (phase !== "show") return;
    const reduced =
      respectReducedMotion &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const timer = setTimeout(
      () => setPhase("leaving"),
      reduced ? SPLASH_REDUCED_MOTION_MS : SPLASH_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, respectReducedMotion]);

  // Remove from the page after the fade.
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = setTimeout(() => {
      setPhase("done");
      onDone?.();
    }, SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, onDone]);

  // Escape skips.
  useEffect(() => {
    if (phase !== "show") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhase("leaving");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div
      role="status"
      aria-label="CloseMore is loading"
      aria-hidden={phase === "leaving" ? true : undefined}
      className={cn(
        "cm-splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background transition-opacity duration-[400ms]",
        phase === "leaving" && "pointer-events-none opacity-0",
      )}
    >
      <style>{respectReducedMotion ? CSS + REDUCED_MOTION_CSS : CSS}</style>

      {/* Emblem: ring, hands, fingers */}
      <svg viewBox={ICON_VIEWBOX} className="w-[clamp(7.5rem,32vw,11rem)]" aria-hidden="true">
        <defs>
          {/* Reveal masks: each half of the ring is "drawn" from the top down to the bottom. */}
          <mask
            id="cm-splash-mask-orange"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="320"
            height="320"
          >
            <path
              d="M160 17A143 143 0 0 0 160 303"
              pathLength={1}
              fill="none"
              stroke="white"
              strokeWidth="28"
              className="cm-splash__ring-mask"
            />
          </mask>
          <mask
            id="cm-splash-mask-blue"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="320"
            height="320"
          >
            <path
              d="M160 17A143 143 0 0 1 160 303"
              pathLength={1}
              fill="none"
              stroke="white"
              strokeWidth="28"
              className="cm-splash__ring-mask"
            />
          </mask>
          {/* Hands slide in from behind the inner edge of the ring. */}
          <clipPath id="cm-splash-clip">
            <circle cx="160" cy="160" r="137.5" />
          </clipPath>
        </defs>

        <g clipPath="url(#cm-splash-clip)">
          <g className="cm-splash__shake">
            <path d={HAND_BLUE} fillRule="evenodd" className="cm-splash__hand-l fill-primary" />
            <path
              d={HAND_ORANGE}
              fillRule="evenodd"
              className="cm-splash__hand-r fill-brand-orange"
            />
            {KNUCKLES.map((d, i) => (
              <path
                key={i}
                d={d}
                fillRule="evenodd"
                className="cm-splash__knuckle fill-brand-orange"
                style={{ "--i": i } as CSSProperties}
              />
            ))}
          </g>
        </g>

        <path
          d={RING_ORANGE}
          fillRule="evenodd"
          mask="url(#cm-splash-mask-orange)"
          className="fill-brand-orange"
        />
        <path
          d={RING_BLUE}
          fillRule="evenodd"
          mask="url(#cm-splash-mask-blue)"
          className="fill-primary"
        />
      </svg>

      {/* Name */}
      <svg viewBox={WORDMARK_VIEWBOX} className="w-[clamp(15rem,76vw,27.5rem)]" aria-hidden="true">
        {WORDMARK.map((letter, i) => (
          <path
            key={i}
            d={letter.d}
            fillRule="evenodd"
            className={cn(
              "cm-splash__letter",
              letter.tone === "blue" ? "fill-primary" : "fill-brand-orange",
            )}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
      </svg>

      <p className="cm-splash__tagline text-sm uppercase tracking-[0.22em] text-muted-foreground">
        Close more deals
      </p>

      <button
        type="button"
        onClick={() => setPhase("leaving")}
        className="absolute bottom-6 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip
      </button>
    </div>
  );
}
