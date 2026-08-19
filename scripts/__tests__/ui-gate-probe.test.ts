import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { Window } from "happy-dom";

/**
 * The occlusion probe's card selector (`scripts/ui-gate/probe.js`) — the
 * `cards` count that feeds `bun run check:ui` and its budgets.
 *
 * Regression for the decorative-art false positive: `img[src*="scryfall"]`
 * also matched `AmbientPageGround`'s random full-bleed background art
 * (`data-ambient-art`, `aria-hidden`) and `FeaturedDeckArt`'s hero splash
 * (`aria-hidden`) — both draw real `cards.scryfall.io` URLs, so every
 * `cards`/`cardsOcc` reading on a surface mounting either component was a
 * coin flip on what the random draw happened to pick that run. Excluding
 * `aria-hidden="true"` (and, redundantly but explicitly, `[data-ambient-art]`)
 * fixes the selector's SEMANTICS — a decorative image is never a card,
 * independent of whether the draw is made deterministic.
 *
 * This runs the actual `probe.js` source (no copy/paraphrase) against a
 * `happy-dom` document via `vm` — the same trick `vitest-environment-happy-dom`
 * uses internally, done by hand here so this file can stay in the `scripts`
 * node project rather than pull the whole file into the `dom` project.
 */

const PROBE_SOURCE = readFileSync(
    path.join(__dirname, "../ui-gate/probe.js"),
    "utf8"
);

/** Evaluate `probe.js` in a fresh happy-dom document and return
 *  `window.__tolariaProbe().cards` for the given `<body>` markup. */
function probeCards(bodyHtml: string) {
    const window = new Window({ url: "http://localhost/" });
    const context = createContext(window as unknown as object);
    window.document.body.innerHTML = bodyHtml;
    runInContext(PROBE_SOURCE, context);
    runInContext("globalThis.__result = window.__tolariaProbe();", context);
    return (window as unknown as { __result: { cards: { n: number } } })
        .__result.cards;
}

describe("check:ui probe — card selector excludes decorative art", () => {
    it("does not count AmbientPageGround's random background art as a card", () => {
        // The exact shape `ambient-page-ground.tsx` renders: `data-ambient-art`
        // AND `aria-hidden="true"` on an `<img>` whose `src` is a genuine
        // `cards.scryfall.io` URL (the rotation pool mixes local frames with
        // hand-picked card art — see `ambient-backgrounds.ts`).
        const cards = probeCards(`
            <div data-ambient-ground aria-hidden="true">
                <img data-ambient-art aria-hidden="true" alt=""
                     src="https://cards.scryfall.io/art_crop/front/a/a/aaaa.jpg?1" />
            </div>
        `);
        expect(cards.n).toBe(0);
    });

    it("does not count FeaturedDeckArt's hero splash as a card", () => {
        // `featured-deck-art.tsx`: `aria-hidden` WITHOUT `data-ambient-art` —
        // the decorative marker the fix must not rely on exclusively.
        const cards = probeCards(`
            <img aria-hidden="true" alt=""
                 src="https://cards.scryfall.io/art_crop/front/b/b/bbbb.jpg?1" />
        `);
        expect(cards.n).toBe(0);
    });

    it("still counts a real card image (no aria-hidden, no data-ambient-art)", () => {
        // The exact shape `card-image.tsx` renders for a real board/hand card:
        // a plain `<img>` with a non-empty `alt` (the card name) and no
        // decorative marker.
        const cards = probeCards(`
            <img alt="Lightning Bolt"
                 src="https://cards.scryfall.io/normal/front/c/c/cccc.jpg?1" />
        `);
        expect(cards.n).toBe(1);
    });

    it("still counts a real card image nested under a non-hidden ancestor", () => {
        // `closest` must not over-match plain ancestors — only ones that are
        // themselves decorative.
        const cards = probeCards(`
            <div class="battlefield">
                <div class="card-slot">
                    <img alt="Grizzly Bears"
                         src="https://cards.scryfall.io/normal/front/d/d/dddd.jpg?1" />
                </div>
            </div>
        `);
        expect(cards.n).toBe(1);
    });

    it("counts a real card alongside decorative art without conflating them", () => {
        const cards = probeCards(`
            <img data-ambient-art aria-hidden="true" alt=""
                 src="https://cards.scryfall.io/art_crop/front/e/e/eeee.jpg?1" />
            <img alt="Counterspell"
                 src="https://cards.scryfall.io/normal/front/f/f/ffff.jpg?1" />
        `);
        expect(cards.n).toBe(1);
    });
});
