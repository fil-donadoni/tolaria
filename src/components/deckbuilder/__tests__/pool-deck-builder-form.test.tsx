// Continuous draft→build seeding tests (ADR 0060, issue #1247): "the
// Arrangement built during the draft carries unchanged into deckbuild."
// Drives `PoolDeckBuilderForm`'s initial working-deck seed for both the
// Sealed path (no Arrangement — the pre-#1247 all-Sideboard default) and the
// Draft path (an Arrangement present, even empty — the continuous
// main-by-default seed via `splitPoolByArrangement`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PoolDeckBuilderForm from "../pool-deck-builder-form";

const navigate = vi.fn();
const createMock = vi.fn().mockResolvedValue("deck-1");
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// Real registry ids — the shared surface groups via the card registry.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
];

function setup() {
    // Neither `create` nor `update` fires during initial render — the exact
    // function returned doesn't matter for these seeding assertions.
    useMutationMock.mockReturnValue(createMock);
}

describe("PoolDeckBuilderForm — continuous draft→build seed (ADR 0060, issue #1247)", () => {
    it("Sealed (eventType 'sealed'): every Pool card still starts in the Sideboard — the pre-#1247 default, unchanged", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 2/)).toBeTruthy();
    });

    it("Draft with an untouched (empty) Arrangement: every Pool card is ALREADY in the Maindeck — the continuous 'Pool IS the working deck' seed", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 2/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 0/)).toBeTruthy();
    });

    it("Draft with a recorded sideboard move: the Arrangement's split carries over exactly", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[{ poolIndex: 1, sideboard: true }]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("an existingDeck always wins regardless of poolArrangement", () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={{
                    kind: "user",
                    userDeckId: "deck-1" as never,
                    presetId: "deck-1",
                    name: "Saved Deck",
                    format: "limited",
                    colors: ["R"],
                    cards: [{ cardId: BOLT_ID, cardName: "Lightning Bolt" }],
                    sideboard: [{ cardId: PLAINS_ID, cardName: "Plains" }],
                    featuredCardId: null,
                    isLegal: true,
                    reasons: [],
                }}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        expect(getByText(/^Maindeck 1/)).toBeTruthy();
        expect(getByText(/^Pool \(Sideboard\) 1/)).toBeTruthy();
    });
});

// Draft-phase manual COLUMN arrangement carries over into the deckbuilder's
// starting layout (issue #1575 AC3) — and, because the form reads the LIVE
// seat Pool Arrangement, the same rendering is what a page reload produces
// (AC2). Bolt is MV 1 by default; the Arrangement pins it to MV 6.
describe("PoolDeckBuilderForm — draft column arrangement carry-over (issue #1575)", () => {
    it("renders a Maindeck card under the manual column its Pool Arrangement recorded, not its auto column", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[{ poolIndex: 0, column: 6 }]}
            />
        );
        const mv6 = container.querySelector(
            '[data-column="mv:6"]'
        ) as HTMLElement;
        const mv1 = container.querySelector(
            '[data-column="mv:1"]'
        ) as HTMLElement;
        expect(mv6).toBeTruthy();
        expect(within(mv6).getByTitle(/Remove Lightning Bolt/)).toBeTruthy();
        // ...and it is NOT in its auto MV 1 column.
        expect(within(mv1).queryByTitle(/Remove Lightning Bolt/)).toBeNull();
    });
});

// All-five-basics-always-offered + autosave wiring (issue #1576).
const MOUNTAIN_ID = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // catalogue Mountain

describe("PoolDeckBuilderForm — Add Basic bar (issue #1576)", () => {
    it("offers all five basics for a Pool with no basics at all (Vintage-Cube-style seat), adds to the Maindeck, and persists through the autosave path", async () => {
        setup();
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={[
                    {
                        scryfallId: "s1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                ]}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );

        // All five buttons render even though the Pool opened no basics.
        for (const subtype of [
            "Plains",
            "Island",
            "Swamp",
            "Mountain",
            "Forest",
        ]) {
            expect(getByText(`+ ${subtype}`)).toBeTruthy();
        }

        expect(getByText(/^Maindeck 0/)).toBeTruthy();
        fireEvent.click(getByText("+ Mountain"));
        expect(getByText(/^Maindeck 1/)).toBeTruthy();

        // Unmount triggers the flush-on-unmount effect cleanup, driving the
        // debounced autosave immediately rather than waiting out the timer.
        cleanup();

        expect(createMock).toHaveBeenCalledTimes(1);
        const payload = createMock.mock.calls[0][0] as {
            cards: { cardId: string; cardName: string }[];
        };
        expect(payload.cards).toEqual([
            { cardId: MOUNTAIN_ID, cardName: "Mountain" },
        ]);
    });
});

// Issue #2056 defect 3: the route-level surface must claim the shell's
// REMAINING height (`flex-1 min-h-0`), not a whole extra viewport (`h-dvh`)
// — the shell (`app-shell.tsx`) already owns `min-h-dvh`, and stacking a
// second full-viewport claim under its header band made the document 112px
// taller than the viewport (measured at 852x303), pushing the Save bar and
// legality panel off-screen.
describe("PoolDeckBuilderForm — root surface height (issue #2056 defect 3)", () => {
    it("claims the remaining flex height (flex-1 min-h-0), never a hard h-dvh", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        const classes = root.className.split(/\s+/);
        expect(classes).toContain("flex-1");
        expect(classes).toContain("min-h-0");
        expect(classes).not.toContain("h-dvh");
    });
});

// Issue #2056 defect 2: on a short viewport (852x303 baseline, <=500px
// tall), the header band's padding and title size must shrink under the
// `short-viewport:` variant (`max-height: 500px`, defined once in
// `index.css`) so the chrome stops eating the majority of the viewport.
// jsdom doesn't evaluate media queries, so this asserts the CLASS is
// present on the right elements rather than a resolved pixel height — the
// actual "chrome <= 30% of the viewport" measurement needs a browser pass.
//
// Defect 3 AMPLIFICATION (browser-measured on this branch at 852x277,
// post-fix): shrinking the header/legality bands wasn't enough — their
// COMBINED chrome (169px) still exceeded what `<main>` had left (165px),
// so `PoolDeckbuilderSurface` (no floor, `overflow-hidden` triggers CSS's
// automatic-minimum-size-zero exception) collapsed to a measured 0px ("no
// pane has clientHeight: 0" / "at least one row of tiles" both failed).
// The header and legality bands now HIDE entirely under short-viewport
// (rather than merely shrinking) and fold into `SaveDeckBar`'s single row
// instead — see `save-deck-bar.tsx`'s `onBack`/`legality` props.
describe("PoolDeckBuilderForm — short-viewport chrome treatment (issue #2056 defects 2 & 3)", () => {
    it("the header band hides itself entirely under short-viewport — its Back affordance moves into SaveDeckBar instead of merely shrinking", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const header = container.querySelector("h1")!.parentElement!;
        expect(header.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );
    });

    it("the legality panel band hides itself entirely under short-viewport — its content moves into SaveDeckBar's compact chip instead", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const legalityBand =
            container.querySelector('[role="status"]')!.parentElement!;
        expect(legalityBand.className.split(/\s+/)).toContain(
            "short-viewport:hidden"
        );
    });

    it("SaveDeckBar's row carries a short-viewport-only Back button and legality chip so the two hidden bands' functionality survives", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const form = container.querySelector("form")!;
        const backButtons = within(form).getAllByText("← Back to Event");
        const shortViewportBack = backButtons.find((el) =>
            el.className.split(/\s+/).includes("short-viewport:inline-flex")
        );
        expect(shortViewportBack).toBeTruthy();

        const chipWrapper = form.querySelector(
            "span.hidden.short-viewport\\:inline-flex"
        );
        expect(chipWrapper).toBeTruthy();
    });

    it("PoolDeckbuilderSurface keeps a min-height floor tied to the SAME floored card size defect 1 fixed, so it cannot collapse to 0", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector(
            '[style*="--card-base"]'
        ) as HTMLElement;
        expect(surfaceRoot).toBeTruthy();
        // jsdom's CSSOM (`cssstyle`) doesn't round-trip a `calc()` nesting
        // `min()`/`max()` faithfully — it numerically folds the `* 7 / 5`
        // term and mangles the inner min()/max() commas on read-back, which
        // is a jsdom parsing limitation, not a real-browser one. Assert only
        // that SOME non-empty min-height made it onto the element (the thing
        // that matters for "does not collapse") here; the exact expression
        // is pinned as a source-text assertion below instead, following the
        // same jsdom-can't-verify-this precedent as `deck-builder-height.test.ts`.
        expect(surfaceRoot.style.minHeight).not.toBe("");
    });
});

// jsdom's CSSOM mangles a `calc()` that nests `min()`/`max()` on read-back
// (see the test above), so the exact minHeight expression is pinned here as
// a source-text assertion instead — legitimate per the same
// jsdom-can't-verify-this precedent `deck-builder-height.test.ts` documents.
describe("DeckBuilderShell — builder pane floor (issue #2056 defect 3 amplification)", () => {
    it("the min-height expression is tied to the variant's declared card base (the SAME floored card size defect 1 fixed), not a second unrelated hardcoded number", () => {
        // Issue #1623 absorbed `pool-deckbuilder-surface.tsx` into the shared
        // `DeckBuilderShell`, so the floor now derives from the view spec the
        // variant declares (`view.cardBase`) rather than a per-surface const.
        const src = readFileSync(
            join(__dirname, "..", "deck-builder-shell.tsx"),
            "utf8"
        );
        expect(src).toContain(
            "minHeight: `calc(${view.cardBase} * 7 / 5 + 3.5rem)`"
        );
    });
});

// Issue #2056 defect 1: the responsive card-size clamp must carry the
// CARD_MIN_W floor (via `cardBase()`), or a short-and-wide viewport (the
// `dvh` term binding) collapses tiles below legibility (measured 27.3px at
// 852x303). This asserts the emitted `--card-base` CSS var — the thing
// `--card-w`/`--card-h` are computed from — carries the floor, since jsdom
// can't measure a resolved pixel width. Moved here from the retired
// `pool-deckbuilder-surface.test.tsx` (issue #1623): the constant is this
// VARIANT's, so the guard belongs where the variant is mounted.
describe("PoolDeckBuilderForm — card-size floor (issue #2056, unchanged by #2275)", () => {
    it("emits the same --card-base clamp as issue #2056 shipped — wrapped in a max() floor, not a bare min()", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector(
            '[style*="--card-base"]'
        ) as HTMLElement;
        expect(surfaceRoot.style.getPropertyValue("--card-base")).toBe(
            "max(4.5rem, min(7.5rem, 17vw, 9dvh))"
        );
    });
});

// Issue #2275: below 800px of viewport height, `PoolDeckbuilderSurface`'s
// own `minHeight` is a CONSTANT (156.8px, `poolSurfaceMinHeightPx()` in
// `~/lib/cardSizing.ts` proves the math — see `deck-builder-height.test.ts`)
// while the space `<main>` (the shell) actually has left for this route
// keeps shrinking with the viewport. Below ~246px that constant used to win,
// and since nothing absorbed the shortfall except `<main>`'s own fallback
// scrollbar, `SaveDeckBar` — the primary Done action — spilled past the
// bottom of the viewport, exactly the symptom the #2056 fix removed at
// taller viewports.
//
// Chosen fix (branch (b) from the issue): PIN `SaveDeckBar`. Everything that
// can outgrow its box — the header, the basics bar, and above all the pane
// carrying the forced floor — now lives inside its OWN `overflow-y-auto`
// wrapper; `SaveDeckBar` is a plain sibling flex item OUTSIDE it. This is
// deliberately NOT a fix that only holds above/below some specific pixel
// value: it is a structural invariant (a flex sibling outside a `min-h-0
// flex-1 overflow-y-auto` wrapper always renders at its own natural height,
// regardless of how much the wrapper's content overflows), so it holds at
// EVERY viewport height the app supports — jsdom cannot run real layout to
// prove a number, but it CAN prove the DOM shape that makes the number
// irrelevant, which is what this sweep asserts once at each representative
// height band (down to 64px — well under any real device, past which no
// fix restores usability; through the issue's own ~246px measurement; up
// past the 800px floor-vs-scaling boundary `deck-builder-height.test.ts`
// exercises numerically). The fallback-scroll crossover — the height below
// which the WRAPPER now needs its own scrollbar to show the whole pane,
// where before this fix the deficit spilled onto `SaveDeckBar` instead — is
// unchanged from the issue's own ~246px measurement: the pane's floor and
// the surrounding chrome are both untouched by this fix, only what absorbs
// the shortfall is different.
describe("PoolDeckBuilderForm — SaveDeckBar stays reachable regardless of the pane's forced floor (issue #2275)", () => {
    // Height is not an input this component reads (no windowed media-query
    // JS, no ResizeObserver) — the `short-viewport:` variant is a pure CSS
    // media query jsdom never evaluates. So "sweeping viewport heights"
    // here means: at every height in the band, the SAME rendered DOM shape
    // applies, and that shape is what the assertions below pin. There is
    // nothing further to vary per height because the component's output is
    // height-invariant by design — that invariance IS the fix.
    const REPRESENTATIVE_HEIGHTS_PX = [
        64, 150, 200, 245, 246, 247, 300, 500, 800, 1200,
    ];

    it.each(REPRESENTATIVE_HEIGHTS_PX)(
        "at a %ipx-tall viewport, SaveDeckBar's form is NOT inside the pane's scrollable wrapper",
        () => {
            setup();
            const { container } = render(
                <PoolDeckBuilderForm
                    eventId={"event-1" as never}
                    seatIndex={0}
                    pool={POOL}
                    existingDeck={null}
                    eventType="sealed"
                    poolArrangement={[]}
                />
            );
            const form = container.querySelector("form")!;
            const scrollWrapper = container.querySelector(".overflow-y-auto")!;
            expect(scrollWrapper).toBeTruthy();
            expect(scrollWrapper.contains(form)).toBe(false);
            cleanup();
        }
    );

    it("the scrollable wrapper contains the pane carrying the forced min-height floor, so its shortfall is absorbed there instead of pushing SaveDeckBar out of the flex column", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const surfaceRoot = container.querySelector('[style*="--card-base"]')!;
        const scrollWrapper = container.querySelector(".overflow-y-auto")!;
        expect(scrollWrapper.contains(surfaceRoot)).toBe(true);
    });

    it("SaveDeckBar's own wrapper is a shrink-0 sibling of the scrollable wrapper — it never competes for the pane's shortfall", () => {
        setup();
        const { container } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="sealed"
                poolArrangement={[]}
            />
        );
        const form = container.querySelector("form")!;
        const saveBarWrapper = form.parentElement!;
        expect(saveBarWrapper.className.split(/\s+/)).toContain("shrink-0");
        const root = container.firstElementChild as HTMLElement;
        expect(Array.from(root.children)).toContain(saveBarWrapper);
    });
});
