// `DeckBuilder` (the catalogue-wide /decks/create builder) has no render
// harness in this suite — it needs a full DragDropProvider + catalogue +
// mutation-sink graph to mount, which none of the existing tests attempt.
// These are structural (source-text) assertions instead of a render test —
// legitimate here because every literal this checks is a static className
// string, not something computed per-render (see `game-stack-narrow.test.tsx`
// for the same pattern used elsewhere in this repo). A render-based
// assertion would be strictly stronger; this is the pragmatic substitute.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { poolSurfaceMinHeightPx } from "~/lib/cardSizing";

const SRC = readFileSync(join(__dirname, "..", "deck-builder.tsx"), "utf8");
// Issue #1623 moved the route root, the header band and the chrome treatment
// out of `deck-builder.tsx` into the ONE shared `DeckBuilderShell` both
// builders mount. The literals these tests pin moved with them, so the
// assertions follow — the contract is unchanged, only its home is.
const SHELL_DIR = join(__dirname, "..", "..", "..", "deckbuilder");
const SHELL_SRC = readFileSync(
    join(SHELL_DIR, "deck-builder-shell.tsx"),
    "utf8"
);
const HEADER_SRC = readFileSync(
    join(SHELL_DIR, "deck-builder-header.tsx"),
    "utf8"
);

describe("DeckBuilderShell — root surface height (issue #2056 defect 3)", () => {
    it("the root claims flex-1 min-h-0 (the shell's remaining height), never h-dvh", () => {
        expect(SHELL_SRC).toContain(
            '"flex flex-1 min-h-0 flex-col bg-surface-base text-text"'
        );
        expect(SHELL_SRC).not.toMatch(/"flex h-dvh flex-col/);
    });

    it("DeckBuilder no longer owns a route root of its own — it mounts the shell", () => {
        expect(SRC).toContain("DeckBuilderShell");
        expect(SRC).not.toMatch(/flex flex-1 min-h-0 flex-col/);
    });
});

describe("DeckBuilder — card-size floor (issue #2056 defect 1)", () => {
    it("CARD_BASE routes through the shared cardBase() floor, not a bare min() literal", () => {
        expect(SRC).toContain('import { cardBase } from "~/lib/cardSizing";');
        expect(SRC).toContain(
            'const CARD_BASE = cardBase("8rem", "18vw", "9.5dvh");'
        );
    });
});

describe("DeckBuilderHeader — short-viewport chrome treatment (issue #2056 defect 2)", () => {
    it("the header band and title carry short-viewport overrides", () => {
        expect(HEADER_SRC).toContain("short-viewport:py-1");
        expect(HEADER_SRC).toContain("short-viewport:text-sm");
    });
});

// Issue #2275: the Pool deckbuilder route (`pool-deck-builder-form.tsx`,
// `pool-deckbuilder-surface.tsx`) shares this file's "deckbuilder height"
// topic but not `DeckBuilder`'s own grid — its `PoolDeckbuilderSurface`
// pane carries a hard `minHeight` floor `DeckBuilder`'s `grid-rows-[1fr_1fr]`
// does not. `poolSurfaceMinHeightPx()` (`~/lib/cardSizing.ts`) is a plain-TS
// mirror of that CSS expression (jsdom can't resolve the real `calc()` — see
// `pool-deck-builder-form.test.tsx`) kept here because this file is already
// the height-math home for the deckbuilder surfaces generally. It only
// proves the MATH is unchanged (the card-size floor is explicitly out of
// scope for issue #2275); the actual reachability fix — `SaveDeckBar` pinned
// outside the pane's own scroll wrapper — is proven at the render level in
// `pool-deck-builder-form.test.tsx`, since that structural claim can't be
// verified from source text or arithmetic alone.
describe("Pool deckbuilder surface — minHeight floor sweep (issue #2275)", () => {
    it("is a CONSTANT (156.8px) at every viewport height from a phone-landscape low up through 800px — the card-size floor issue #2275 must NOT change", () => {
        for (const h of [64, 150, 200, 246, 300, 500, 799]) {
            expect(poolSurfaceMinHeightPx(h)).toBeCloseTo(156.8, 5);
        }
    });

    it("grows past the floor once the viewport clears 800px, and keeps growing monotonically up to the 7.5rem ceiling", () => {
        expect(poolSurfaceMinHeightPx(800)).toBeCloseTo(156.8, 5);
        expect(poolSurfaceMinHeightPx(801)).toBeGreaterThan(156.8);
        expect(poolSurfaceMinHeightPx(1000)).toBeGreaterThan(
            poolSurfaceMinHeightPx(801)
        );
        // Saturates at the 7.5rem (120px) card-base ceiling: 120 * 7/5 + 56 = 224.
        expect(poolSurfaceMinHeightPx(1333.34)).toBeCloseTo(224, 1);
        expect(poolSurfaceMinHeightPx(2000)).toBeCloseTo(224, 1);
    });

    // The ~246px figure issue #2275 measures as the crossover where the
    // OLD behaviour broke (the pane's 156.8px floor plus the route's own
    // surrounding chrome — header/basics-bar/save-bar at their
    // short-viewport sizes — stopped fitting in what `<main>` had left,
    // spilling the Save bar into the shell's fallback scroll). The pane
    // minimum itself does not "know" about 246px — it is a CONSTANT clear
    // through this whole band, which is exactly why a fix that only
    // shrinks the pane's floor further (option (a), rejected — the floor
    // is unchanged per the acceptance criteria) was never the intended
    // shape here; the crossover only mattered for what ABSORBS the
    // shortfall, which `pool-deck-builder-form.test.tsx` verifies directly.
    it("the floor at the issue's own ~246px crossover measurement is identical to the floor at the phone-landscape low (64px) — it never varies across the band the crossover sits in", () => {
        expect(poolSurfaceMinHeightPx(246)).toBe(poolSurfaceMinHeightPx(64));
    });
});
