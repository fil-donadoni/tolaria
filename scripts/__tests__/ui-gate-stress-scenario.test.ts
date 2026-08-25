// The ui-gate `game-stress` surface's debug scenario, guarded (issue #2725).
//
// `scripts/ui-gate/surfaces.ts` walks the board by typing a scenario LABEL into
// the Debug panel's search box and clicking the row it finds. That row is a
// deployment-local DB write (ADR 0044 — scenarios deliberately do not live in
// git), so the only part of the contract this repo CAN hold is the part that
// travels with the code: the label the walk searches for, and a spec whose card
// names all resolve in the catalogue.
//
// Both fail silently otherwise. A renamed label makes the walk throw
// `Unreachable` — reported as a coverage hole, but only on a machine that has
// already seeded the row; a card name that stops resolving is rejected by
// `seedScenarioDirect`'s own loadability guard at SEED time, hours after the
// PR that dropped the card. This test is what turns both into a red gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryGetCardByName } from "../../convex/cards";
import { isDepthPile } from "../../src/lib/board-layout";
import {
    scenarioSpecValidator,
    scenarioCardValidator,
} from "../../convex/debugScenarioSpec";

const ROOT = resolve(__dirname, "../..");
const SCENARIO_PATH = resolve(ROOT, "scripts/ui-gate/stress-scenario.json");

/** `CardsPile`'s collapsed-tile depth, read out of the component source rather
 *  than restated here. It is a function-local `const` (not exported), and it is
 *  the only threshold that gives "deep pile" a rendering meaning: a pile at or
 *  below it shows every card it holds, so nothing about it is deep. Read, never
 *  guessed — a renamed constant throws here instead of quietly re-baselining the
 *  bar to whatever the payload happens to contain. */
function collapsedPileDepth(): number {
    const source = readFileSync(
        resolve(ROOT, "src/components/board/cards-pile.tsx"),
        "utf8"
    );
    const match = source.match(/const COLLAPSED_DEPTH = (\d+);/);
    if (!match) {
        throw new Error(
            "COLLAPSED_DEPTH not found in src/components/board/cards-pile.tsx"
        );
    }
    return Number(match[1]);
}

type SeedArgs = {
    label: string;
    prompt?: string;
    spec: { cards: { name: string; token?: boolean }[] };
};

const seed = JSON.parse(readFileSync(SCENARIO_PATH, "utf8")) as SeedArgs;

describe("ui-gate stress scenario (game-stress surface)", () => {
    it("carries the exact label the lane searches for", () => {
        // Read as TEXT rather than imported: `scripts/ui-gate/index.ts` owns a
        // live browser + Vite server at module scope.
        const runner = readFileSync(
            resolve(ROOT, "scripts/ui-gate/index.ts"),
            "utf8"
        );
        expect(runner).toContain(
            `const STRESS_SCENARIO_LABEL = ${JSON.stringify(seed.label)};`
        );
    });

    it("names only cards that resolve in the catalogue", () => {
        // Same check `seedScenarioDirect` runs before it writes the row — run
        // here so a catalogue change reds the gate instead of the seed.
        const unresolved = seed.spec.cards
            .filter((c) => !c.token && tryGetCardByName(c.name) === null)
            .map((c) => c.name);
        expect(unresolved).toEqual([]);
    });

    it("uses only fields the write-path validator accepts", () => {
        // `seedScenarioDirect` validates against `scenarioSpecValidator`; an
        // unknown field is rejected at seed time, on the machine running the
        // lane, long after the change that introduced it.
        const specFields = Object.keys(scenarioSpecValidator.fields);
        for (const key of Object.keys(seed.spec)) {
            expect(specFields).toContain(key);
        }
        const cardFields = Object.keys(scenarioCardValidator.fields);
        for (const card of seed.spec.cards) {
            for (const key of Object.keys(card)) {
                expect(cardFields).toContain(key);
            }
        }
    });

    it("actually stresses the layout it exists to stress", () => {
        // The surface's whole job is the crowded case: a zone that must shrink
        // its cards. A spec that quietly lost its board would walk green and
        // measure nothing.
        const battlefield = seed.spec.cards.filter(
            (c) => (c as { zone?: string }).zone === "battlefield"
        );
        const permanents = battlefield.reduce(
            (n, c) => n + ((c as { count?: number }).count ?? 1),
            0
        );
        expect(permanents).toBeGreaterThanOrEqual(60);
        // Permanent stacks (identical clean copies) and tapped permanents are
        // the two footprint-census rows that a card-count-derived sizing rule
        // gets wrong — the scenario must contain both.
        expect(
            battlefield.some((c) => ((c as { count?: number }).count ?? 1) >= 4)
        ).toBe(true);
        expect(
            battlefield.some((c) => (c as { tapped?: boolean }).tapped === true)
        ).toBe(true);
        // A full hand on both seats, and piles deep enough to show a count.
        for (const owner of ["me", "opp"]) {
            const hand = seed.spec.cards
                .filter(
                    (c) =>
                        (c as { owner?: string }).owner === owner &&
                        (c as { zone?: string }).zone === "hand"
                )
                .reduce(
                    (n, c) => n + ((c as { count?: number }).count ?? 1),
                    0
                );
            expect(hand).toBeGreaterThanOrEqual(7);
        }
    });

    it("carries a permanent stack deep enough to render as a depth-pile", () => {
        // `isDepthPile` (src/lib/board-layout.ts) is the switch the renderer
        // reads: at or below the threshold a stack fans
        // (`battlefield-stack-fan.tsx`), above it the tight diagonal pile
        // (`battlefield-stack-depth-pile.tsx`) takes over, with a different
        // footprint (`stackFootprintWidth`) and a different DOM. Without one
        // entry past the threshold, the depth-pile is the one footprint-census
        // row `game-stress` never walks — the surface would report a clean
        // board for a rendering path it never rendered.
        //
        // A scenario entry's `count` is a LOWER bound on the group it becomes:
        // `groupBattlefield` merges identical clean copies, and only splits a
        // group (tapped / altered members), never merges two smaller entries
        // into something bigger than either.
        const deepest = Math.max(
            ...seed.spec.cards
                .filter((c) => (c as { zone?: string }).zone === "battlefield")
                .map((c) => (c as { count?: number }).count ?? 1)
        );
        expect(isDepthPile(deepest)).toBe(true);
    });

    it("carries graveyard and exile piles deeper than a collapsed tile shows", () => {
        // "deep piles" is in the scenario's own LABEL, and until this assertion
        // nothing held it: the payload could lose every pile and still walk
        // green. The bar comes from the renderer — `CardsPile` mounts only its
        // last `COLLAPSED_DEPTH` cards, so a pile at or under that depth shows
        // every card it holds and exercises nothing the shallow case doesn't.
        const minDepth = collapsedPileDepth();
        for (const owner of ["me", "opp"]) {
            for (const zone of ["graveyard", "exile"]) {
                const depth = seed.spec.cards
                    .filter(
                        (c) =>
                            (c as { owner?: string }).owner === owner &&
                            (c as { zone?: string }).zone === zone
                    )
                    .reduce(
                        (n, c) => n + ((c as { count?: number }).count ?? 1),
                        0
                    );
                expect(depth, `${owner} ${zone}`).toBeGreaterThan(minDepth);
            }
        }
    });
});
