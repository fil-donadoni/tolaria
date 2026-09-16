// The DECLARED POSITIONS the `check:ui` lane loads into its own games
// (ADR 0132 §4, issue #3652).
//
// `ui-gate-stress-scenario.test.ts` next door holds ONE payload to the shape
// the surface it serves exists to measure — a crowded board, deep piles, a
// full hand. This file holds every payload to the property §4 actually is:
// the position is DECLARED. The turn holder and the priority holder are
// written down, and they are the HUMAN seat — so nothing the probe measures
// depends on who won the coin toss, and in the one vs-AI surface the Bot is
// never owed an input while the five viewports are walked.
//
// Why that last claim follows from a spec field: `buildStateFromScenario`
// (`convex/gre/scenarioBuilder.ts`) maps `"me"` to the first seat and `"opp"`
// to the second, and the second is the Bot's (`-p2`, ADR 0001,
// `bladeLoadBotSeatId`). `useVsAiDriver` acts only when the ENGINE says the
// bot owes input; with both fields on `"me"` it never does, so the ring the
// `game-debug-sheet-ai` surface measures is written by the seam alone
// (`src/components/debug/__tests__/ai-trace-seam.bot.test.tsx`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryGetCardByName } from "../../convex/cards";
import {
    scenarioCardValidator,
    scenarioSpecValidator,
} from "../../convex/debugScenarioSpec";
import { laneScenarioSeeds, type ScenarioSeed } from "../ui-gate/lane-account";

const ROOT = resolve(__dirname, "../..");

/** Read as TEXT rather than imported: `scripts/ui-gate/index.ts` owns a live
 *  browser + Vite server at module scope. */
const runner = readFileSync(resolve(ROOT, "scripts/ui-gate/index.ts"), "utf8");

const seeds = laneScenarioSeeds();

type Spec = {
    activePlayer?: string;
    priority?: string;
    cards: { name: string; token?: boolean }[];
};

const specOf = (seed: ScenarioSeed) => seed.spec as Spec;

describe("check:ui declared positions (ADR 0132 §4)", () => {
    it("seeds one payload per game surface that loads a position", () => {
        // Three today. The count is asserted so that ADDING a payload without
        // a surface, or a surface without a payload, is a decision somebody
        // makes on purpose rather than a diff nobody reads.
        expect(seeds.map((s) => s.label)).toEqual([
            "UI stress — full board, full hand, deep piles",
            "UI yields — two spells on the stack",
            "UI AI trace — quiet board, priority on the human seat",
        ]);
    });

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s declares the turn holder and priority on the human seat",
        (_label, seed) => {
            const spec = specOf(seed);
            // BOTH, not just `priority`: priority defaults to the ACTIVE
            // player, and the active player defaults to the base state's turn
            // holder — which is the dealt game's, i.e. the coin toss's. A spec
            // naming only one of the two still inherits the other.
            expect(spec.activePlayer).toBe("me");
            expect(spec.priority).toBe("me");
        }
    );

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s is searched for by the exact label the lane types",
        (label) => {
            // The walk finds its row by filling the Scenarios search box with
            // this string (`ensureScenarioBoard`). A payload renamed on one
            // side only makes the surface UNWALKED on a machine that has
            // already seeded the old row — a coverage hole nobody attributes.
            expect(runner).toContain(JSON.stringify(label));
        }
    );

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s names only cards that resolve in the catalogue",
        (_label, seed) => {
            // The same check `seedScenarioDirect` runs before it writes the
            // row — run here so a catalogue change reds the gate instead of
            // the bootstrap, hours later, on the machine running the lane.
            const unresolved = specOf(seed)
                .cards.filter(
                    (c) => !c.token && tryGetCardByName(c.name) === null
                )
                .map((c) => c.name);
            expect(unresolved).toEqual([]);
        }
    );

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s uses only fields the write-path validator accepts",
        (_label, seed) => {
            const specFields = Object.keys(scenarioSpecValidator.fields);
            for (const key of Object.keys(seed.spec as object)) {
                expect(specFields).toContain(key);
            }
            const cardFields = Object.keys(scenarioCardValidator.fields);
            for (const card of specOf(seed).cards) {
                for (const key of Object.keys(card)) {
                    expect(cardFields).toContain(key);
                }
            }
        }
    );
});
