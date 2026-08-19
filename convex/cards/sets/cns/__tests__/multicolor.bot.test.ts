// CNS — BOT-side behaviour for Dack Fayden's emblem (issues #2360 / #1571).
//
// The emblem is the first shipped trigger whose CONTROLLER is the player
// casting the spell rather than the player being targeted, and it fires ONCE
// PER targeted permanent (CR 603.2c divergence, documented on the emblem
// definition). Both properties are new stack traffic the search has to walk:
// a bot casting a two-target spell with the emblem out ends up with three
// objects on the stack where it expected one. The failure mode this guards is
// the one the bot must never have — a rollout that stalls or throws instead of
// producing a move (ADR 0047, issue #2283).
//
// NOT covered here, deliberately: whether the bot ENUMERATES Dack's loyalty
// abilities as moves. It does not — `gre/moves.ts` skips every ability with a
// `cost.loyalty`, catalogue-wide, pending the bot planeswalker slice (issue
// #700 / ADR 0058). That gate predates this card and applies to every shipped
// planeswalker; see `docs/findings/2391-bot-skips-loyalty-abilities.md`.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../../index";
import { finalizeTargetSelection } from "../../../../game";
import { DACK_FAYDEN_EMBLEM_ID } from "../../../emblems";
import { enumerateMoves } from "../../../../gre/moves";
import { selectRolloutMove } from "../../../../gre/search";
import { cloneGameState } from "../../../../gre/clone";
import { refreshExpectedInput } from "../../../../gre/expectedInput";
import type { GameState, PendingTarget } from "../../../../gre/state";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

const TWIDDLE = getCardByName("Twiddle").id;
const ORNITHOPTER = getCardByName("Ornithopter").id;
const BEARS = getCardByName("Balduvian Bears").id;

/** p1 (the bot seat) holds Twiddle and Dack's emblem; p2 has two permanents. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(TWIDDLE, {
                        id: "twiddle1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(ORNITHOPTER, {
                        id: "thopter",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(BEARS, {
                        id: "bears",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    state.emblems = [
        {
            id: "emblem-1",
            ownerId: "p1",
            emblemId: DACK_FAYDEN_EMBLEM_ID,
            name: "Dack Fayden emblem",
            text: "Whenever you cast a spell that targets one or more permanents, gain control of those permanents.",
        },
    ];
    return state;
}

describe("Dack Fayden emblem — bot never freezes (ADR 0047)", () => {
    it("a cast that raises the emblem trigger leaves both seats with a legal move", () => {
        const state = board();
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "twiddle1",
            targetType: ["Artifact", "Creature", "Land"],
            count: 1,
            selected: [{ type: "permanent", id: "thopter" }],
        };
        state.pendingTarget = pt;
        finalizeTargetSelection(state, pt, "p1");

        // The emblem trigger really is on the stack — otherwise this asserts
        // nothing about the emblem.
        expect(
            state.stack.filter(
                (s) => s.emblemSourceId === DACK_FAYDEN_EMBLEM_ID
            )
        ).toHaveLength(1);

        // Owed-ness stays derivable, and whoever is owed input has a move.
        refreshExpectedInput(state);
        expect(state.expectedInput).toBeDefined();
        const owed = state.expectedInput!.playerId;
        expect(owed).toBeDefined();

        const moves = enumerateMoves(state, owed!);
        expect(moves.length).toBeGreaterThan(0);

        // …and the rollout policy really picks one of them rather than
        // stalling on the unfamiliar stack traffic.
        const probe = cloneGameState(state);
        const rng = () => 0.5;
        expect(() =>
            selectRolloutMove(probe, owed!, "p1", moves, rng)
        ).not.toThrow();
        expect(selectRolloutMove(probe, owed!, "p1", moves, rng)).toBeDefined();
    });
});
