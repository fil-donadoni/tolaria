// Attack taps and the `SpellContext.tap` effect emit PERMANENT_TAPPED through
// the shared tap choke point (CR 701.26a, issue #3787) on every attack path:
// `applyMoveForSearch` (greedy sim) and `applyMoveInSearch` (ISMCTS sandbox)
// must show the bot the same Magda Treasures the server produces.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { applyMoveForSearch } from "../applyMove";
import { emitAttackersDeclaredEvents } from "../phases";
import { applyMoveInSearch } from "../search";
import {
    buildSpellContext,
    emitPermanentTapped,
    getPlayer,
    resolveTopOfStack,
    type GameState,
} from "../state";
import type { Move } from "../moves";

const MAGDA = "079e6263-e54c-4899-a336-5315909b9322";
const DWARF = "ea9a38b1-4676-425a-b40d-4fb478966024";
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const TAP_TRIGGER = "magda-dwarf-tapped-treasure";

function board(): GameState {
    const mk = (cardId: string, id: string) =>
        makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [mk(MAGDA, "magda"), mk(DWARF, "dwarf")],
            }),
            makePlayer("p2"),
        ],
    });
}

const ATTACK: Move = {
    kind: "declare-attackers",
    attackerIds: ["magda", "dwarf"],
} as Move;

const treasures = (state: GameState) =>
    getPlayer(state, "p1").battlefield.filter((c) =>
        c.subtypes.includes("Treasure")
    );

function treasuresAfterResolving(state: GameState): number {
    expect(
        state.stack.filter((s) => s.triggeredAbilityId === TAP_TRIGGER)
    ).toHaveLength(2);
    while (state.stack.length > 0) resolveTopOfStack(state);
    return treasures(state).length;
}

describe("attack taps reach Magda on every path (CR 508.1f / 701.26a)", () => {
    it("applyMove greedy sim: its bounded drain leaves two Treasures", () => {
        const next = applyMoveForSearch(board(), "p1", ATTACK);
        while (next.stack.length > 0) resolveTopOfStack(next);
        expect(treasures(next)).toHaveLength(2);
    });

    it("ISMCTS sandbox: two Treasures after resolution", () => {
        const state = board();
        applyMoveInSearch(state, "p1", ATTACK);
        expect(treasuresAfterResolving(state)).toBe(2);
    });
});

describe("mana-ability taps stay out of the attack batch (CR 605)", () => {
    it("a queued forMana tap of an attacker is left in pendingEvents", () => {
        const state = board();
        const magda = getPlayer(state, "p1").battlefield[0];
        magda.isTapped = true;
        emitPermanentTapped(state, magda, true, { G: 1 });
        state.combat = {
            attackerIds: ["magda", "dwarf"],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        emitAttackersDeclaredEvents(state);
        expect(
            (state.pendingEvents ?? []).filter(
                (e) => e.type === "PERMANENT_TAPPED" && e.forMana
            )
        ).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });
});

describe("SpellContext.tap (CR 701.26a)", () => {
    it("emits exactly one non-mana PERMANENT_TAPPED for the target", () => {
        const state = board();
        const ctx = buildSpellContext(state, pushSpell(state, BEARS, "p1"));
        ctx.tap({ type: "creature", id: "dwarf" } as never);
        const events = (state.pendingEvents ?? []).filter(
            (e) => e.type === "PERMANENT_TAPPED"
        );
        expect(events).toEqual([
            expect.objectContaining({ permanentId: "dwarf", forMana: false }),
        ]);
        // a second tap of the now-tapped target is not a transition
        ctx.tap({ type: "creature", id: "dwarf" } as never);
        expect(
            (state.pendingEvents ?? []).filter(
                (e) => e.type === "PERMANENT_TAPPED"
            )
        ).toHaveLength(1);
    });
});
