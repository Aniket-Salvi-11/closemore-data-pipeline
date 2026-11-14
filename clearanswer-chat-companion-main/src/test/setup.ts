import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Tests must behave the same whatever is in your .env.local. Without this, VITE_USE_MOCK_API=true
// (used to demo the app) would make the "real backend" tests talk to the built-in fake instead.
vi.stubEnv("VITE_USE_MOCK_API", "false");

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
