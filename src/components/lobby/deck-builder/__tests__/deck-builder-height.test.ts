// Structural (source-text) assertions rather than render assertions —
// legitimate here because every literal this checks is a static className
// string, not something computed per-render (see `game-stack-narrow.test.tsx`
// for the same pattern used elsewhere in this repo). A render-based assertion
// would be strictly stronger; render harnesses for both builders do exist now
// (`deck-builder-zones.test.tsx`, `deckbuilder/__tests__/deck-builder-*`), but
// jsdom evaluates no media query, so the `short-viewport:` treatment below
// still has no render-level observable.
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

// Issue #2275: the Pool deckbuilder route's zone pane carries a hard
// `minHeight` floor. Since issue #1623 that floor lives on the shared
// `DeckBuilderShell` and derives from each variant's declared
// `view.cardBase`, so BOTH builders now have it; the arithmetic swept below
// is the Limited variant's (`cardBase("7.5rem", "17vw", "9dvh")`), which is
// what issue #2275 measured. `poolSurfaceMinHeightPx()` (`~/lib/cardSizing.ts`) is a plain-TS
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

// Issue #2585: the 50/50 `flex-1 basis-0` vertical split caps the deck pane at
// half the free column no matter what else is trimmed — the arithmetic in
// `docs/findings/2585-deck-pane-60-percent-needs-the-pane-split.md` shows even
// a ZERO-height source pane leaves the deck under 60% at 1180×820. The only
// lever that clears the AC is the source panel leaving the vertical axis and
// becoming a bounded-WIDTH side dock at landscape-and-roomy widths, via the
// `deck-source-dock:` custom variant (`src/index.css`). These are source-text
// sweeps, the same legitimate pattern as the rest of this file — a render
// assertion can't see a media-query-gated layout switch under jsdom either.
const INDEX_CSS_SRC = readFileSync(
    join(SHELL_DIR, "..", "..", "index.css"),
    "utf8"
);
const POOL_SRC = readFileSync(
    join(SHELL_DIR, "pool-deck-builder-form.tsx"),
    "utf8"
);

describe("DeckBuilderShell — source-panel dock split (issue #2585)", () => {
    it("the `deck-source-dock` variant is gated on landscape AND a 1024px width floor — not reused from `compact-chrome`'s width-only bucket", () => {
        expect(INDEX_CSS_SRC).toContain(
            "@custom-variant deck-source-dock (@media (orientation: landscape) and (min-width: 1024px) and (min-height: 501px));"
        );
    });

    // Review finding #1 (PR #2653): `deck-source-dock:` and `compact-chrome:`
    // are both `orientation: landscape` — without a height floor they
    // OVERLAPPED at short-landscape-but-wide shapes (1280x480), and in that
    // overlap the zones pane's `compact-chrome:flex-none compact-chrome:basis-auto`
    // sized it along the ROW axis instead of the column, computing a
    // 1459px-wide zones pane inside a 1280px viewport. `min-height: 501px` is
    // one more than `compact-chrome:`'s own `max-height: 500px` ceiling, so
    // the two ranges abut with no shared pixel — this pins that the two
    // custom variants stay mutually exclusive by construction.
    it("the `deck-source-dock` and `compact-chrome` variants never share a pixel — deck-source-dock requires min-height 501px, one more than compact-chrome's max-height 500px landscape branch", () => {
        const dockMatch = INDEX_CSS_SRC.match(
            /@custom-variant deck-source-dock \(@media[\s\S]*?min-height: (\d+)px\)\);/
        );
        const compactLandscapeMatch = INDEX_CSS_SRC.match(
            /@media \(orientation: landscape\) and \(max-height: (\d+)px\)/
        );
        expect(dockMatch).not.toBeNull();
        expect(compactLandscapeMatch).not.toBeNull();
        const dockMinHeight = Number(dockMatch![1]);
        const compactMaxHeight = Number(compactLandscapeMatch![1]);
        expect(dockMinHeight).toBe(compactMaxHeight + 1);
    });

    it("the strip wrapper turns into a real flex ROW under the dock variant, overriding the off-portrait `contents` collapse", () => {
        expect(SHELL_SRC).toContain(
            "contents deck-source-dock:flex deck-source-dock:min-h-0 deck-source-dock:flex-1 deck-source-dock:flex-row"
        );
    });

    it("the source panel keeps its base `flex-1 basis-0` height share (untouched viewports) AND gains a bounded-width `flex-none` override under the dock variant", () => {
        expect(SHELL_SRC).toContain(
            "min-h-0 flex-1 basis-0 overflow-y-auto border-b border-border-subtle/30 deck-source-dock:w-[22rem] deck-source-dock:max-w-[38%] deck-source-dock:flex-none deck-source-dock:self-stretch deck-source-dock:border-b-0 deck-source-dock:border-r"
        );
    });

    // Review finding #4 (PR #2653): the original slice ran from
    // `data-deck-pane="source"` to `{sourcePanel.content}`, which spans BOTH
    // ternary branches of the div's `className` — so the PORTRAIT branch's
    // own `overflow-y-auto` satisfied the assertion even with the dock
    // (non-portrait) branch's copy deleted (proved by mutation: deleting
    // `overflow-y-auto` from the non-portrait branch left this test green).
    // This version captures ONLY the ternary's false branch (the dock/desktop
    // string) via regex group, so it can't be satisfied by the portrait
    // sibling.
    it("the source panel's DOCK (non-portrait) branch stays a scrollable dock — `overflow-y-auto` is never dropped from that branch specifically", () => {
        const classNameMatch = SHELL_SRC.match(
            /data-deck-pane="source"[\s\S]*?className=\{\s*portrait\s*\?\s*"[^"]*"\s*:\s*"([^"]*)"/
        );
        expect(classNameMatch).not.toBeNull();
        const dockBranchClassName = classNameMatch![1];
        expect(dockBranchClassName).toContain("overflow-y-auto");
    });

    it("the Limited builder never supplies a `sourcePanel` — the whole dock branch is absent by construction, no `kind` check needed (ADR 0075)", () => {
        expect(POOL_SRC).not.toMatch(/sourcePanel\s*[:=]/);
    });
});
