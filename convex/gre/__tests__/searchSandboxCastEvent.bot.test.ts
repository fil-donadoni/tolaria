// The two search sandboxes announce a cast through the SINGLE choke point
// (CR 601.2i / 603.3, issue #3026).
//
// `emitSpellCastEvent` (`gre/state.ts`) is documented as "the single choke
// point every cast goes through": it emits `SPELL_CAST`, maintains
// `spellsCastThisTurn` (Storm's counter, ADR 0052), the caster's own per-turn
// tally (issue #1343) and the lifetime `spellsCastThisGame` (issue #790), and
// runs `collectCastTriggers` so a keyword-synthesized cast trigger lands on the
// stack above the spell. Both hand-built "build a StackItem from a cast"
// reimplementations (issue #2473) pushed their item without ever calling it, so
// inside the tree no cast was ever counted and no cast trigger ever existed:
// storm copied zero times in every rollout, every blade scenario and all
// self-play, which reads as ordinary weak play and reds nothing.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` is a declared
// bot module (`bot-suite-boundary.test.ts` / `BOT_MODULE_EXACT`).
import { describe, it, expect } from "vitest";
import { applyMoveInSearch } from "../search";
import { applyMoveForSearch } from "../applyMove";
import type { Move } from "../moves";
import type { GameState, StackItem } from "../state";
import { resolveTopOfStack } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { lightningBolt, mountain } from "../../cards/sets/lea";
import { grapeshot } from "../../cards/sets/tsp";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

/** A storm COUNTERSPELL — no such card ships, and none needs to: this fixture
 *  exists to reach the one shape that distinguishes "the cast segment is
 *  drained" from "the stack got back to its old depth". Its storm copy removes
 *  an item that was on the stack BEFORE the cast, so the depth falls back to
 *  its pre-cast value while the cast spell itself is still sitting there. */
const STORM_COUNTER_ID = "test:storm-counter-probe";
const stormCounterProbe: CardDefinition = {
    id: STORM_COUNTER_ID,
    rarity: "common",
    name: "Storm Counter Probe",
    manaCost: { U: 1 },
    types: ["Instant"],
    staticAbilities: ["storm"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [{ op: "counter", target: { target: 0 } }],
};
registerTokenDefinition(stormCounterProbe);

/** Two Mountains and the two spells in hand — the position both sandboxes are
 *  driven over. The sandboxes do not re-validate mana (the tap plan rides on
 *  the Move, see `applyTapPlan`), but the lands are real so the position is one
 *  the enumerator could actually have produced. */
function stormPosition(): GameState {
    const lands = [0, 1].map((i) =>
        makeInstance(mountain.id, {
            id: `mtn-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: lands,
                hand: [
                    makeInstance(lightningBolt.id, {
                        id: "bolt",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                    makeInstance(grapeshot.id, {
                        id: "grapeshot",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function castAtOpponent(cardInstanceId: string): Move {
    return {
        kind: "cast-spell",
        cardInstanceId,
        targets: [{ type: "player", id: "p2" }],
        confirmTargets: false,
        tapPlan: [],
    };
}

/** The three counters the choke point maintains, read off one state. */
function castCounters(state: GameState) {
    const p1 = state.players[0];
    return {
        table: state.spellsCastThisTurn,
        perTurn: p1.spellsCastThisTurn,
        lifetime: p1.spellsCastThisGame,
    };
}

/** Resolves the whole stack, bounded — the storm trigger pushes copies as it
 *  resolves, so this is not a fixed number of steps. */
function resolveWholeStack(state: GameState): void {
    for (let step = 0; step < 64 && state.stack.length > 0; step++) {
        const depth = state.stack.length;
        const topId = state.stack[state.stack.length - 1]?.id;
        resolveTopOfStack(state);
        if (
            state.stack.length === depth &&
            state.stack[state.stack.length - 1]?.id === topId
        ) {
            break;
        }
    }
}

describe("cast choke point — ISMCTS sandbox (applyMoveInSearch, issue #3026)", () => {
    it("counts the cast on all three tallies, exactly as the mutation path does", () => {
        const state = stormPosition();
        expect(castCounters(state)).toEqual({
            table: undefined,
            perTurn: undefined,
            lifetime: undefined,
        });

        applyMoveInSearch(state, "p1", castAtOpponent("bolt"));

        expect(castCounters(state)).toEqual({
            table: 1,
            perTurn: 1,
            lifetime: 1,
        });
    });

    it("puts a storm trigger on the stack ABOVE the spell that caused it (CR 603.3b / 702.40a)", () => {
        const state = stormPosition();
        applyMoveInSearch(state, "p1", castAtOpponent("bolt"));
        applyMoveInSearch(state, "p1", castAtOpponent("grapeshot"));

        const grapeshotIndex = state.stack.findIndex(
            (s) => s.id === "grapeshot"
        );
        expect(grapeshotIndex).toBeGreaterThanOrEqual(0);
        const trigger = state.stack.find(
            (s: StackItem) => s.triggerSourceId === "grapeshot"
        );
        expect(trigger).toBeDefined();
        // CR 702.40a — one copy per spell cast before it this turn: the Bolt.
        expect(trigger?.stormCopiesRemaining).toBe(1);
        expect(state.stack.indexOf(trigger!)).toBeGreaterThan(grapeshotIndex);
    });

    it("resolves the copies the count implies — 1 damage becomes 2 (CR 702.40a)", () => {
        const state = stormPosition();
        applyMoveInSearch(state, "p1", castAtOpponent("bolt"));
        applyMoveInSearch(state, "p1", castAtOpponent("grapeshot"));
        resolveWholeStack(state);

        // 20 - 3 (Bolt) - 1 (Grapeshot) - 1 (its one storm copy) = 15.
        expect(state.players[1].life).toBe(15);
    });
});

describe("cast choke point — greedy sandbox (applyMoveForSearch, issue #3026)", () => {
    it("counts the cast on all three tallies", () => {
        const after = applyMoveForSearch(
            stormPosition(),
            "p1",
            castAtOpponent("bolt")
        );
        expect(castCounters(after)).toEqual({
            table: 1,
            perTurn: 1,
            lifetime: 1,
        });
    });

    it("resolves the storm copies its own cast produced", () => {
        const afterBolt = applyMoveForSearch(
            stormPosition(),
            "p1",
            castAtOpponent("bolt")
        );
        const afterGrapeshot = applyMoveForSearch(
            afterBolt,
            "p1",
            castAtOpponent("grapeshot")
        );
        // The greedy sandbox plays each move out to a stable point, so both
        // spells and the storm copy have already resolved: 20 - 3 - 1 - 1.
        expect(afterGrapeshot.players[1].life).toBe(15);
        expect(afterGrapeshot.stack).toHaveLength(0);
    });
});

describe("the two sandboxes agree (issue #3026)", () => {
    it("the same Move produces the same counters and the same cast trigger in both", () => {
        const ismcts = stormPosition();
        applyMoveInSearch(ismcts, "p1", castAtOpponent("bolt"));
        applyMoveInSearch(ismcts, "p1", castAtOpponent("grapeshot"));

        const greedyBolt = applyMoveForSearch(
            stormPosition(),
            "p1",
            castAtOpponent("bolt")
        );
        const greedy = applyMoveForSearch(
            greedyBolt,
            "p1",
            castAtOpponent("grapeshot")
        );

        expect(castCounters(greedy)).toEqual(castCounters(ismcts));
        expect(castCounters(ismcts)).toEqual({
            table: 2,
            perTurn: 2,
            lifetime: 2,
        });

        // The ISMCTS leaf leaves the stack unresolved (the opponent may
        // respond) while the greedy leaf plays it out, so the sandboxes agree
        // on the OUTCOME rather than on the stack snapshot: resolving the
        // ISMCTS stack reaches the same life total.
        resolveWholeStack(ismcts);
        expect(ismcts.players[1].life).toBe(greedy.players[1].life);
    });
});

describe("a spell COPY is not a cast (CR 707.10, issue #3026)", () => {
    it("the copies the storm trigger makes never inflate any of the three tallies", () => {
        const state = stormPosition();
        applyMoveInSearch(state, "p1", castAtOpponent("bolt"));
        applyMoveInSearch(state, "p1", castAtOpponent("grapeshot"));
        // Two CASTS, and the trigger is on top of the stack with one copy owed.
        expect(castCounters(state)).toEqual({
            table: 2,
            perTurn: 2,
            lifetime: 2,
        });

        // Resolving it runs `cloneSpellOntoStack`, which is deliberately NOT
        // routed through the cast choke point: a copy is put onto the stack,
        // never cast (CR 707.10). Routing the sandboxes through the choke point
        // must not drag the copy machinery through it too.
        resolveWholeStack(state);

        expect(castCounters(state)).toEqual({
            table: 2,
            perTurn: 2,
            lifetime: 2,
        });
    });
});

describe("greedy drain is bounded by the cast item, not by stack depth (issue #3026)", () => {
    it("resolves the cast spell even when its own storm copy removes an item from UNDER it", () => {
        const state = stormPosition();
        // A pre-existing item on the stack: the opponent's Bolt, which the
        // probe's storm copy will counter. `stackDepthBeforeCast` is therefore
        // 1, not 0.
        const oppBolt = makeInstance(lightningBolt.id, {
            id: "opp-bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({ ...oppBolt, castById: "p2", targets: [] });
        state.players[0].hand.push(
            makeInstance(STORM_COUNTER_ID, {
                id: "storm-counter",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        // One prior cast, so the probe's storm trigger makes exactly one copy —
        // and that copy is what counters the Bolt sitting below the probe.
        state.spellsCastThisTurn = 1;
        state.players[0].spellsCastThisTurn = 1;

        const after = applyMoveForSearch(state, "p1", {
            kind: "cast-spell",
            cardInstanceId: "storm-counter",
            targets: [{ type: "spell", id: "opp-bolt" }],
            confirmTargets: false,
            tapPlan: [],
        });

        // The copy countered the Bolt, dropping the stack back to depth 1 with
        // the probe still on it. A drain bounded by depth alone stops there and
        // hands `evaluate` a leaf with an unresolved spell on the stack.
        expect(after.stack.some((s) => s.id === "storm-counter")).toBe(false);
        expect(after.stack).toHaveLength(0);
    });
});
