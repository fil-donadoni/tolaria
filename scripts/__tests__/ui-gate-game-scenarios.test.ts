// The DECLARED POSITIONS the `check:ui` lane loads into its own games
// (ADR 0132 §4, issue #3652).
//
// `ui-gate-stress-scenario.test.ts` next door holds ONE payload to the shape
// the surface it serves exists to measure — a crowded board, deep piles, a
// full hand. This file holds every payload to the property §4 actually is:
// the position is DECLARED, and the decision it poses is posed to the HUMAN
// seat. Issue #3708 is where a blanket `activePlayer === "me"` stopped being
// able to say that: `game-combat` has to declare `activePlayer: "opp"`, since a
// block is a turn-based action owed to the DEFENDING player (CR 509.1a) and a
// combat the human seat attacks in would put the opponent's half of combat on
// screen.
//
// So the check is in two parts, and BOTH are needed. The engine is asked who
// the rebuilt position owes its input to — that is the property itself. But
// that answer alone is vacuous for `activePlayer` outside a block window:
// `computeExpectedInput` falls through to `{kind: "priority", playerId:
// priorityPlayerId}`, so a payload that quietly took `activePlayer: "opp"`
// would still name seat one and pass. The turn holder is therefore asserted
// too, and excused for exactly the position whose decision is the defender's.
//
// So: `activePlayer` and `priority` must both be WRITTEN DOWN (neither may be
// inherited — priority defaults to the active player and the active player to
// the base state's turn holder, i.e. the coin toss's), and the rebuilt
// position must owe its input to seat one. `buildStateFromScenario`
// (`convex/gre/scenarioBuilder.ts`) maps `"me"` to the first seat and `"opp"`
// to the second, and the second is the Bot's (`-p2`, ADR 0001,
// `bladeLoadBotSeatId`). `useVsAiDriver` acts only when the ENGINE says the
// bot owes input — which is exactly what `computeExpectedInput` answers below
// — so the ring the `game-debug-sheet-ai` surface measures is written by the
// seam alone (`src/components/debug/__tests__/ai-trace-seam.bot.test.tsx`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCardByName, tryGetCardByName } from "../../convex/cards";
import {
    scenarioCardValidator,
    scenarioSpecValidator,
    type ScenarioSpec,
} from "../../convex/debugScenarioSpec";
import { computeExpectedInput } from "../../convex/gre/expectedInput";
import { buildStateFromScenario } from "../../convex/gre/scenarioBuilder";
import {
    createInitialGameState,
    type PlayerInput,
} from "../../convex/gre/setup";
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

/** A two-seat game to rebuild a position onto — the same shape
 *  `debugSetupScenario` hands the builder, minus the deployment. Seat one is
 *  `"me"` and seat two `"opp"`, which is the mapping every assertion below
 *  reads. */
function baseState() {
    const filler = getCardByName("Forest");
    const seat = (id: string): PlayerInput => ({
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "ui-gate",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    });
    return createInitialGameState([seat("p1"), seat("p2")], 0x3708);
}

describe("check:ui declared positions (ADR 0132 §4)", () => {
    it("seeds one payload per game surface that loads a position", () => {
        // Six today. The count is asserted so that ADDING a payload without
        // a surface, or a surface without a payload, is a decision somebody
        // makes on purpose rather than a diff nobody reads.
        expect(seeds.map((s) => s.label)).toEqual([
            "UI stress — full board, full hand, deep piles",
            "UI yields — two spells on the stack",
            "UI AI trace — quiet board, priority on the human seat",
            "UI board — ordinary mid-game position",
            "UI combat — blocks owed on a confirmed attack",
            "UI choice — a card pick over the board, seven candidates",
        ]);
    });

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s writes down BOTH the turn holder and the priority holder",
        (_label, seed) => {
            const spec = specOf(seed);
            // BOTH, not just `priority`: priority defaults to the ACTIVE
            // player, and the active player defaults to the base state's turn
            // holder — which is the dealt game's, i.e. the coin toss's. A spec
            // naming only one of the two still inherits the other.
            expect(spec.activePlayer).toBeDefined();
            expect(spec.priority).toBeDefined();
        }
    );

    it.each(seeds.map((s) => [s.label, s] as const))(
        "%s poses its decision to the HUMAN seat",
        (_label, seed) => {
            // The property the two fields above are only a proxy for, asked of
            // the engine itself: rebuild the position and read who it owes its
            // input to. A walk measures controls the VIEWER can act on, and in
            // the vs-AI surface a position owing the Bot an input would have it
            // moving under the probe.
            const state = buildStateFromScenario(
                baseState(),
                seed.spec as ScenarioSpec
            );
            const expected = computeExpectedInput(state);
            expect(expected).toBeDefined();
            expect(expected?.playerId).toBe(state.players[0].id);
            // And the TURN is the human seat's, unless the position owes a
            // turn-based action only the defending player can answer (CR
            // 509.1a) — the one shape that needs the other seat active for the
            // human seat to be the one being asked. Without this line the
            // assertion above never reads `activePlayer` at all for the five
            // positions outside a block window (see this file's head), and a
            // payload could take the opponent's turn without any guard
            // noticing.
            if (expected?.kind !== "blockers") {
                expect(state.activePlayerId).toBe(state.players[0].id);
            }
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
