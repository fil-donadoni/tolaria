// Bot lane for Necromancy (VIS, issue #2392). Lives in its own
// `*.bot.test.ts` file because `convex/gre/moves.ts` is a declared bot module
// (`convex/__tests__/bot-suite-boundary.test.ts`), so any test importing the
// enumerator belongs to `test:bot`.
//
// Two decisions the Bot has to be able to SEE, and the failure mode is silence
// in both cases — a move that is never enumerated is indistinguishable from a
// move the Bot considered and rejected:
//
//   1. the CR 601.3 cast-timing permission. `enumerateCastMoves` re-derives no
//      timing of its own (it gates on `getLegalActions`, the shared authority),
//      so what this pins is that the OFFER and the PLAN agree: the plan pays
//      the PRINTED cost, because the unconditional permission carries no
//      surcharge. #2501's shipped freeze was exactly this pair disagreeing —
//      the probe offered a cast at the surcharged price the planner had not
//      budgeted for, the executor announced first, and the cast parked in
//      `pendingCast` forever.
//   2. the CR 603.3d reanimation target. The ETB trigger's target lives in a
//      GRAVEYARD, a zone `enumerateRaisedTargetMoves` reaches only through
//      `getLegalTargets`' zone branch; if that returned nothing the trigger
//      would sit on the stack with an unfilled slot and no move to fill it.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import { enumerateMoves, type Move } from "../../../../gre/moves";
import { getLegalActions } from "../../../../gre/rules";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { necromancy } from "../black";
import { animateDead, grizzlyBears } from "../../lea";

const SWAMP = getCardByName("Swamp").id;

/** p1 holds `cardId` with `landCount` untapped Swamps. p1 always holds
 *  priority; only whose TURN it is moves (the `flashSurchargeMoves` shape). */
function handBoard(
    cardId: string,
    landCount: number,
    window: "own" | "off"
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(cardId, {
                        id: "spell1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: landCount }, (_, i) =>
                    makeInstance(SWAMP, {
                        id: `land${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: window === "own" ? "p1" : "p2",
        priorityPlayerId: "p1",
    });
}

function castMoves(state: GameState): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "spell1"
    );
}

describe("Bot: Necromancy's CR 601.3 cast-timing permission", () => {
    it("enumerates the cast on the OPPONENT's turn, at the printed {2}{B}", () => {
        const state = handBoard(necromancy.id, 3, "off");

        // The probe offers it…
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).toContain("cast");
        // …and the plan the executor will submit taps exactly the printed
        // cost. A fourth land here would be a surcharge nobody declared.
        const casts = castMoves(state);
        expect(casts).toHaveLength(1);
        expect(casts[0].tapPlan).toHaveLength(3);
    });

    it("prices the same in the caster's own sorcery window", () => {
        const casts = castMoves(handBoard(necromancy.id, 3, "own"));
        expect(casts).toHaveLength(1);
        expect(casts[0].tapPlan).toHaveLength(3);
    });

    it("offers nothing off-window when the printed cost is unreachable", () => {
        const state = handBoard(necromancy.id, 2, "off");
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).not.toContain("cast");
        expect(castMoves(state)).toHaveLength(0);
    });

    it("control: an enchantment with no permission is enumerated only in its own window", () => {
        // Animate Dead {1}{B} — same colour, same type, no CR 601.3 clause.
        // It is a PRINTED Aura, so it needs a legal cast-time target to be
        // enumerated at all: seed one, or the control proves nothing.
        const withCorpse = (window: "own" | "off"): GameState => {
            const state = handBoard(animateDead.id, 3, window);
            state.players[1].graveyard = [
                makeInstance(grizzlyBears.id, {
                    id: "corpse",
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "graveyard",
                }),
            ];
            return state;
        };
        expect(castMoves(withCorpse("own")).length).toBeGreaterThan(0);
        expect(castMoves(withCorpse("off"))).toHaveLength(0);
    });
});

describe("Bot: Necromancy's CR 603.3d reanimation target (graveyard zone)", () => {
    it("enumerates one submit-target move per creature card in ANY graveyard", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "graveyard",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const spell: StackItem = {
            ...makeInstance(necromancy.id, {
                id: "necro-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
        } as StackItem;
        state.stack.push(spell);

        // Resolve the spell; the ETB trigger fires with an unfilled target slot
        // and — TWO legal candidates, so no auto-lock — a raised PendingTarget.
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "necromancy-etb-reanimate"
        );
        expect(state.pendingTarget).toBeDefined();

        const submissions = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "submit-target" }> =>
                m.kind === "submit-target"
        );
        const ids = submissions
            .flatMap((m) => m.targets)
            .map((t) => t.id)
            .sort();
        // "a graveyard", not "your graveyard" — both are offered.
        expect(ids).toEqual(["mine", "theirs"]);
    });
});
