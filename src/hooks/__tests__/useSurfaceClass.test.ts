// `useSurfaceClass` (#2585) — the OVERLAY-shape seam:
// phone / roomy-coarse / roomy-fine. The two roomy classes are named after the
// POINTER capability they test, not after a device (review finding 5): a desktop
// driving a touch monitor is `roomy-coarse` and a touchscreen laptop is not.
//
// It exists because `useViewportMode()` answers a different question and its
// `"desktop"` bucket swallows tablets whole: 820×1180 is 820px wide, above the
// 767px portrait bound, and 1180px tall, above the 500px landscape-compact
// bound — so a tablet in portrait has always read as a desktop. That is the
// documented cause of the deckbuilder's starved card-pile strip at that exact
// viewport (`scripts/ui-gate/budgets.json`, `deck-builder @ 820x1180x2`).
//
// The load-bearing test in this file is therefore the CONTRAST one: at 820×1180
// the two hooks must disagree. If they ever agree again, the new hook has been
// quietly rewritten into an alias of the old one and the bug is back.
//
// Same mock strategy as `useViewportMode.test.ts`: evaluate the hook's REAL
// query strings against a synthetic device rather than stubbing per-query
// booleans, so the boundaries are genuinely exercised and a query-string edit is
// caught rather than mocked over.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSurfaceClass, type SurfaceClass } from "../useSurfaceClass";
import { useViewportMode } from "../useViewportMode";

type Listener = () => void;
type Device = { width: number; height: number; pointer: "fine" | "coarse" };

let device: Device = { width: 1440, height: 900, pointer: "fine" };
const listeners = new Map<string, Set<Listener>>();

/** Evaluate a media query against `device`. THROWS on a feature it cannot
 *  faithfully evaluate, so an unmockable query fails the test rather than
 *  silently reading as false. */
function evaluate(query: string): boolean {
    return query.split(" and ").every((raw) => {
        const match = /^\(([a-z-]+):\s*([a-z0-9]+)\)$/.exec(raw.trim());
        if (!match) throw new Error(`unparsable media condition: ${raw}`);
        const [, feature, value] = match;
        switch (feature) {
            case "orientation":
                return (
                    value ===
                    (device.width > device.height ? "landscape" : "portrait")
                );
            case "max-width":
                return device.width <= Number.parseInt(value, 10);
            case "max-height":
                return device.height <= Number.parseInt(value, 10);
            case "pointer":
                return value === device.pointer;
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
            addEventListener: (_type: string, cb: Listener) => set.add(cb),
            removeEventListener: (_type: string, cb: Listener) =>
                set.delete(cb),
            addListener: (cb: Listener) => set.add(cb),
            removeListener: (cb: Listener) => set.delete(cb),
            onchange: null,
            dispatchEvent: () => true,
        };
    });
}

function setDevice(next: Device) {
    act(() => {
        device = next;
        for (const set of listeners.values()) for (const cb of [...set]) cb();
    });
}

beforeEach(() => {
    device = { width: 1440, height: 900, pointer: "fine" };
    listeners.clear();
    installMatchMedia();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// The five viewports every UI slice is verified at (ADR 0101, and the emulate
// profiles in `.claude/rules/chrome-debug.md`). `mobile,touch` in those profiles
// is what makes the pointer coarse.
const VIEWPORTS: {
    name: string;
    device: Device;
    expected: SurfaceClass;
}[] = [
    {
        name: "desktop 1440×900",
        device: { width: 1440, height: 900, pointer: "fine" },
        expected: "roomy-fine",
    },
    {
        name: "phone portrait 390×844",
        device: { width: 390, height: 844, pointer: "coarse" },
        expected: "phone",
    },
    {
        name: "phone landscape 844×390",
        device: { width: 844, height: 390, pointer: "coarse" },
        expected: "phone",
    },
    {
        name: "tablet portrait 820×1180",
        device: { width: 820, height: 1180, pointer: "coarse" },
        expected: "roomy-coarse",
    },
    {
        name: "tablet landscape 1180×820",
        device: { width: 1180, height: 820, pointer: "coarse" },
        expected: "roomy-coarse",
    },
];

describe("useSurfaceClass — the five verification viewports (#2585)", () => {
    for (const { name, device: d, expected } of VIEWPORTS) {
        it(`classifies ${name} as ${expected}`, () => {
            device = d;
            const { result } = renderHook(() => useSurfaceClass());
            expect(result.current).toBe(expected);
        });
    }
});

describe("useSurfaceClass vs useViewportMode (#2585)", () => {
    // THE regression. `useViewportMode` calls a portrait tablet a desktop —
    // correctly, for LAYOUT — and that is exactly why the overlay-shape question
    // cannot be answered by reading it.
    it("disagrees with useViewportMode on a portrait tablet", () => {
        device = { width: 820, height: 1180, pointer: "coarse" };
        const surface = renderHook(() => useSurfaceClass());
        const layout = renderHook(() => useViewportMode());
        expect(layout.result.current).toBe("desktop");
        expect(surface.result.current).toBe("roomy-coarse");
    });

    it("disagrees with useViewportMode on a landscape tablet too", () => {
        device = { width: 1180, height: 820, pointer: "coarse" };
        const surface = renderHook(() => useSurfaceClass());
        const layout = renderHook(() => useViewportMode());
        expect(layout.result.current).toBe("desktop");
        expect(surface.result.current).toBe("roomy-coarse");
    });

    it("agrees that a fine-pointer desktop is the fine-pointer roomy surface", () => {
        device = { width: 1440, height: 900, pointer: "fine" };
        const surface = renderHook(() => useSurfaceClass());
        const layout = renderHook(() => useViewportMode());
        expect(layout.result.current).toBe("desktop");
        expect(surface.result.current).toBe("roomy-fine");
    });
});

describe("useSurfaceClass — boundaries and liveness (#2585)", () => {
    // The phone queries win over the coarse-pointer one: a phone IS coarse, so
    // an order that tested `pointer: coarse` first would call every phone roomy
    // and hand it an anchored popover on a 390px-wide screen.
    it("a coarse phone is a phone, not a roomy-coarse surface", () => {
        device = { width: 390, height: 844, pointer: "coarse" };
        const { result } = renderHook(() => useSurfaceClass());
        expect(result.current).toBe("phone");
    });

    // A fine-pointer laptop is never `roomy-coarse` however narrow the window gets —
    // it only crosses into "phone" where `useViewportMode` says portrait too,
    // so the two hooks stay consistent about what a phone shape is.
    it("a narrow fine-pointer window stays roomy-fine until it is phone-shaped", () => {
        device = { width: 900, height: 700, pointer: "fine" };
        const { result } = renderHook(() => useSurfaceClass());
        expect(result.current).toBe("roomy-fine");
        setDevice({ width: 700, height: 900, pointer: "fine" });
        expect(result.current).toBe("phone");
    });

    it("follows a live rotation from tablet portrait to tablet landscape", () => {
        device = { width: 820, height: 1180, pointer: "coarse" };
        const { result } = renderHook(() => useSurfaceClass());
        expect(result.current).toBe("roomy-coarse");
        setDevice({ width: 1180, height: 820, pointer: "coarse" });
        expect(result.current).toBe("roomy-coarse");
        setDevice({ width: 390, height: 844, pointer: "coarse" });
        expect(result.current).toBe("phone");
    });

    it("falls back to 'roomy-fine' with no matchMedia (SSR / older env)", () => {
        vi.stubGlobal("matchMedia", undefined);
        const { result } = renderHook(() => useSurfaceClass());
        expect(result.current).toBe("roomy-fine");
    });
});
