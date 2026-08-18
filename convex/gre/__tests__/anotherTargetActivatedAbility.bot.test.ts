// "ANOTHER target …" on an ACTIVATED ability, bot side (issue #2399).
//
// `TargetRequirement.excludeSource` used to be honoured only for TRIGGERED
// abilities (`triggerTargetLegality`, `gre/rules.ts`), and the per-card idiom
// for the activated case was a dynamic `getTargetRequirement(source)` closure.
// That idiom is invisible to the bot: `enumerateAbilityMoves` skips any ability
// carrying one ("Conditional abilities need a runtime predicate we don't
// replicate"), so Giver of Runes / Manifold Key / Reflection of Kiki-Jiki were
// abilities the search could never take. Routing the flag through the shared
// `applySelfExclusion` fixes both halves at once, and the invariant this file
// pins is the one that actually matters:
//
//   the tuples the bot enumerates are exactly the picks the mutation accepts.
//
// A bot that enumerates the SOURCE as a legal target submits a pick the server
// rejects, and a rejected target submission is an ADR 0047 freeze, not a retry.

import { describe, it, expect } from "vitest";
import { fableOfTheMirrorBreaker } from "../../cards/sets/neo/red";
import { elvishArchers } from "../../cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";
import { processPendingActionTriggers, resolveTopOfStack } from "../state";
import { advanceSagasAtPrecombatMain } from "../sagas";
import { enumerateMoves } from "../moves";
import { LORE_COUNTER } from "../../cards/abilities/sagas";

const KIKI_ABILITY_ID = "reflection-of-kiki-jiki-copy";

/** A transformed Fable (Reflection of Kiki-Jiki) plus `others` on p1's
 *  battlefield, with priority and mana enough to activate. */
function kikiBoard(others: CardInstanceState[]): {
    state: GameState;
    kiki: CardInstanceState;
} {
    const saga = makeInstance(fableOfTheMirrorBreaker.id, {
        id: "fable1",
        controllerId: "p1",
        counters: { [LORE_COUNTER]: 2 },
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [saga] }), makePlayer("p2")],
        activePlayerId: "p1",
    });
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
    const kiki = state.players[0].battlefield[0];
    kiki.isSummoningSick = false;
    state.players[0].battlefield.push(...others);
    state.players[0].manaPool = { C: 5 };
    state.phase = "PRECOMBAT_MAIN";
    state.priorityPlayerId = "p1";
    return { state, kiki };
}

const kikiMoves = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m) => m.kind === "activate-ability" && m.abilityId === KIKI_ABILITY_ID
    );

describe("activated-ability self-exclusion in move enumeration (issue #2399)", () => {
    it("never enumerates the SOURCE as its own 'another target' (CR 109.2)", () => {
        const other = makeInstance(elvishArchers.id, {
            id: "other1",
            controllerId: "p1",
        });
        const { state, kiki } = kikiBoard([other]);

        const moves = kikiMoves(state);
        expect(moves.length).toBeGreaterThan(0);
        const targetIds = moves.flatMap((m) =>
            ((m as { targets?: { id: string }[] }).targets ?? []).map(
                (t) => t.id
            )
        );
        expect(targetIds).toContain("other1");
        expect(targetIds).not.toContain(kiki.id);
    });

    it("with NO other creature, the ability yields no move at all", () => {
        // Reflection of Kiki-Jiki is itself a nonlegendary creature its
        // controller controls, so without the exclusion this board would
        // enumerate a self-targeting activation the server then rejects.
        const { state } = kikiBoard([]);
        expect(kikiMoves(state)).toHaveLength(0);
    });
});
