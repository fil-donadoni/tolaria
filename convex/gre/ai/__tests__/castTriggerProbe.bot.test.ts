// The 1-ply probe on a cast whose announcement is NOT the top of the stack
// (issue #7784).
//
// CR 601.2i: a "when you cast" ability (storm, CR 702.40a; prowess; cascade)
// triggers as the spell becomes cast, and CR 603.3 puts it on the stack ABOVE
// the spell. `policyProbeState` used to read the top as the move's
// announcement, resolve that one item — the trigger — and score the spell
// with itself still unresolved: a mill spell read as the mana it cost. The
// second defect sat one ply further: storm's copies raise `copy-retarget`
// (CR 707.10c) at the mover, and `settleFrom` answered only a `trigger`-kind
// prompt, so no probe ever saw a copy resolve.
//
// Both are pinned through the REAL probe (`applyMoveInSearch` → the cast with
// its storm trigger, then `policyProbeState`), against the settled state: the
// stack drained to nothing and the damage the spell and its copies deal.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import { cloneGameState } from "../../clone";
import { enumerateMoves, type Move } from "../../moves";
import { applyMoveInSearch, policyProbeState } from "../../search";
import { buildPositionFromSpec } from "../blade/build";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

type SpecCard = ScenarioSpec["cards"][number];

function position(cards: SpecCard[]): GameState {
    return buildPositionFromSpec({
        cards,
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    });
}

/** Cast `name` AT THE OPPONENT (a player-targeted spell also enumerates a
 *  cast at its own caster). */
function castAtOpponent(state: GameState, name: string): Move {
    const me = state.activePlayerId;
    const opp = state.players.find((p) => p.id !== me)!.id;
    const id = getCardByName(name).id;
    const card = state.players
        .flatMap((p) => p.hand)
        .find((c) => (c.card as { id?: string }).id === id);
    if (!card) throw new Error(`${name} is not in a hand`);
    const move = enumerateMoves(state, me).find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === card.id &&
            (m.targets ?? []).every((t) => t.type !== "player" || t.id === opp)
    );
    if (!move) throw new Error(`${name} is not castable here`);
    return move;
}

function probeCast(state: GameState, name: string): GameState {
    const me = state.activePlayerId;
    const move = castAtOpponent(state, name);
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, me, move);
    // The announcement put the spell AND its storm trigger on the stack: the
    // precondition the two defects share.
    expect(probe.stack.map((s) => s.triggeredAbilityId ?? "spell")).toEqual([
        "spell",
        "storm",
    ]);
    return policyProbeState(probe, move, DEFAULT_EVAL_WEIGHTS, me);
}

const grapeshot: SpecCard = { name: "Grapeshot", owner: "me", zone: "hand" };

describe("policyProbeState — a cast trigger above the spell (CR 601.2i, CR 603.3)", () => {
    it("settles down to the SPELL, not to the trigger on top of it", () => {
        const s = position([grapeshot]);
        const settled = probeCast(s, "Grapeshot");
        expect(settled.stack).toHaveLength(0);
        expect(settled.pendingTarget).toBeUndefined();
        // Storm count zero: the trigger made no copy, the spell itself dealt 1.
        expect(settled.players[1].life).toBe(19);
    });
});

describe("settleFrom — storm copies' retarget is the mover's own answer (CR 707.10c)", () => {
    it("answers the copy-retarget and resolves every copy", () => {
        const s = position([grapeshot]);
        // Two spells already cast this turn → two copies (CR 702.40a), each
        // raising `copy-retarget` at the mover as it is made.
        s.spellsCastThisTurn = 2;
        const settled = probeCast(s, "Grapeshot");
        expect(settled.stack).toHaveLength(0);
        expect(settled.pendingTarget).toBeUndefined();
        // Original + two copies, 1 damage each.
        expect(settled.players[1].life).toBe(17);
    });
});
