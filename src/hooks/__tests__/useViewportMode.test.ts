// `useViewportMode` (#1763) — the widened layout seam: portrait /
// landscape-compact / desktop. Expand step of an expand–contract, so the
// contracts under test are BOTH halves:
//   1. the three modes are selected by the documented media queries, at their
//      boundaries, and update live when the viewport changes;
//   2. `useIsPortrait` keeps its EXACT old semantics for every existing
//      consumer — true iff mode is "portrait", which means landscape-compact
//      must still read as false (landscape phones keep the desktop layout
//      until #1768 / #1769).
//
// jsdom's own `matchMedia` never matches anything, so it cannot distinguish the
// three modes. The mock below evaluates the hook's REAL query strings against a
// synthetic viewport instead of stubbing per-query booleans — that way the
// boundaries (`max-width: 767px`, `max-height: 500px`) are genuinely exercised
// and a future edit to a query string is caught rather than mocked over.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewportMode } from "../useViewportMode";
import { useIsPortrait } from "../useIsPortrait";

type Listener = () => void;

let viewport = { width: 1440, height: 900 };
/** Listeners keyed by query — `getSnapshot` calls `matchMedia` on every read,
 *  so each call returns a FRESH `MediaQueryList` facade while the listener set
 *  behind a given query is shared (exactly how the browser behaves). */
const listeners = new Map<string, Set<Listener>>();
/** Every `addEventListener` ever made, to prove the hook installs one listener
 *  set and does not leak more on re-render. */
let addCount = 0;

/** Evaluate a media query against `viewport`. Supports only the features the
 *  hook actually uses, and THROWS on anything else so a query the mock cannot
 *  faithfully evaluate fails the test instead of silently reading as false. */
function evaluate(query: string): boolean {
    return query.split(" and ").every((raw) => {
        const match = /^\(([a-z-]+):\s*([a-z0-9]+)\)$/.exec(raw.trim());
        if (!match) throw new Error(`unparsable media condition: ${raw}`);
        const [, feature, value] = match;
        switch (feature) {
            case "orientation":
                // CSS: landscape iff width > height (a square viewport is
                // portrait).
                return (
                    value ===
                    (viewport.width > viewport.height
                        ? "landscape"
                        : "portrait")
                );
            case "max-width":
                return viewport.width <= Number.parseInt(value, 10);
            case "max-height":
                return viewport.height <= Number.parseInt(value, 10);
            default:
                throw new Error(`unsupported media feature: ${feature}`);
        }
    });
}

function installMatchMedia() {
    vi.stubGlobal("matchMedia", (query: string) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        const set = listeners.get(query)!;
        return {
            media: query,
            get matches() {
                return evaluate(query);
            },
            addEventListener: (_type: string, cb: Listener) => {
                addCount += 1;
                set.add(cb);
            },
            removeEventListener: (_type: string, cb: Listener) => {
                set.delete(cb);
            },
            addListener: (cb: Listener) => set.add(cb),
            removeListener: (cb: Listener) => set.delete(cb),
            onchange: null,
            dispatchEvent: () => true,
        };
    });
}

/** Resize the synthetic viewport and fire `change` the way a browser would. */
function resize(width: number, height: number) {
    act(() => {
        viewport = { width, height };
        for (const set of listeners.values()) for (const cb of [...set]) cb();
    });
}

function liveListenerCount(): number {
    let n = 0;
    for (const set of listeners.values()) n += set.size;
    return n;
}

beforeEach(() => {
    viewport = { width: 1440, height: 900 };
    listeners.clear();
    addCount = 0;
    installMatchMedia();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useViewportMode — mode boundaries", () => {
    it("returns 'portrait' for a phone held upright (390×844)", () => {
        viewport = { width: 390, height: 844 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "portrait"
        );
    });

    it("returns 'landscape-compact' for a phone held sideways (844×390)", () => {
        viewport = { width: 844, height: 390 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "landscape-compact"
        );
    });

    it("returns 'desktop' for a laptop (1440×900)", () => {
        viewport = { width: 1440, height: 900 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "desktop"
        );
    });

    it("returns 'desktop' for a landscape tablet — wide AND tall (1180×820)", () => {
        viewport = { width: 1180, height: 820 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "desktop"
        );
    });

    it("treats the landscape-compact height bound as inclusive (500 vs 501)", () => {
        viewport = { width: 900, height: 500 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "landscape-compact"
        );
        viewport = { width: 900, height: 501 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "desktop"
        );
    });

    it("keeps the portrait width bound at 767 — a portrait tablet is desktop", () => {
        viewport = { width: 767, height: 1024 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "portrait"
        );
        viewport = { width: 768, height: 1024 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "desktop"
        );
    });

    it("prefers 'portrait' over 'landscape-compact' for a short PORTRAIT viewport", () => {
        // 400×420: portrait (width ≤ height) and short — only the portrait
        // query may match, so the precedence is observable rather than
        // accidental.
        viewport = { width: 400, height: 420 };
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "portrait"
        );
    });
});

describe("useViewportMode — live updates and subscription", () => {
    it("updates when the viewport changes across all three modes", () => {
        viewport = { width: 1440, height: 900 };
        const { result } = renderHook(() => useViewportMode());
        expect(result.current).toBe("desktop");

        resize(390, 844);
        expect(result.current).toBe("portrait");

        resize(844, 390);
        expect(result.current).toBe("landscape-compact");

        resize(1440, 900);
        expect(result.current).toBe("desktop");
    });

    it("installs one listener per query and does not leak on re-render", () => {
        const { rerender, unmount } = renderHook(() => useViewportMode());
        expect(listeners.size).toBe(2); // portrait + landscape-compact
        expect(liveListenerCount()).toBe(2);
        const afterMount = addCount;

        rerender();
        rerender();
        expect(liveListenerCount()).toBe(2);
        expect(addCount).toBe(afterMount);

        unmount();
        expect(liveListenerCount()).toBe(0);
    });

    it("falls back to 'desktop' with no matchMedia (SSR / older env)", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(renderHook(() => useViewportMode()).result.current).toBe(
            "desktop"
        );
    });
});

describe("useIsPortrait — unchanged semantics on top of the new seam (#1763)", () => {
    it("is true ONLY in portrait; landscape-compact still reads as false", () => {
        viewport = { width: 390, height: 844 };
        expect(renderHook(() => useIsPortrait()).result.current).toBe(true);

        viewport = { width: 844, height: 390 };
        expect(renderHook(() => useIsPortrait()).result.current).toBe(false);

        viewport = { width: 1440, height: 900 };
        expect(renderHook(() => useIsPortrait()).result.current).toBe(false);
    });

    it("tracks orientation changes live, as before", () => {
        viewport = { width: 390, height: 844 };
        const { result } = renderHook(() => useIsPortrait());
        expect(result.current).toBe(true);

        // Rotating a phone to landscape must NOT keep the portrait layout,
        // even though it now has a mode of its own.
        resize(844, 390);
        expect(result.current).toBe(false);
    });

    it("defaults to false with no matchMedia (SSR / older env)", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(renderHook(() => useIsPortrait()).result.current).toBe(false);
    });
});
