// The Bot's reach for airbend (CR 701.65a, issue #3551): `enumerateMoves` offers
// the {2} cast of an airbended card an unaffordable printed cost would hide, the
// search commit pays {2}, and the raised target answers both halves of Aang's
// "creature or spell", or none.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { commitCastInSearch } from "../applyMove";
import { enumerateMoves } from "../moves";
import { raiseTriggerTargetSelection } from "../rules";
import { getPlayer, type GameState, type StackItem } from "../state";

const AANG = getCardByName("Aang, Swift Savior").id;
const APPA = getCardByName("Appa, Steadfast Guardian").id;
const BEARS = getCardByName("Grizzly Bears").id;
const COLOSSUS = getCardByName("Darksteel Colossus").id;
const ISLAND = getCardByName("Island").id;

const land = (i: number) =>
    makeInstance(ISLAND, {
        id: `land${i}`,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });

function airbendedColossus(lands: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: Array.from({ length: lands }, (_, i) => land(i)),
                exile: [
                    makeInstance(COLOSSUS, {
                        id: "colossus",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "exile",
                        castableFromExileBy: "p1",
                        castFromExileAlternativeCost: { X: 2 },
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 5,
    });
}

const castMoves = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "colossus"
    );

describe("the Bot and airbend", () => {
    it("offers the {2} cast with two lands and not with one", () => {
        expect(castMoves(airbendedColossus(2)).length).toBeGreaterThan(0);
        expect(castMoves(airbendedColossus(1))).toHaveLength(0);
    });

    it("the search commit pays {2}, not the printed {11}", () => {
        const state = airbendedColossus(2);
        const [move] = castMoves(state);
        expect(move?.kind).toBe("cast-spell");
        commitCastInSearch(
            state,
            "p1",
            move as Extract<typeof move, { kind: "cast-spell" }>,
            { handPriorityToCaster: false }
        );
        expect(state.stack.some((s) => s.id === "colossus")).toBe(true);
        expect(
            getPlayer(state, "p1").battlefield.filter((c) => c.isTapped)
        ).toHaveLength(2);
    });

    it("answers Aang's raised target on either half, or declines (no freeze)", () => {
        const aang = makeInstance(AANG, {
            id: "aang",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aang] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(BEARS, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "battlefield",
                        }),
                    ],
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            turn: 5,
        });
        state.stack.push({
            ...makeInstance(BEARS, {
                id: "spell",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        } as StackItem);
        state.stack.push({
            ...aang,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "aang-swift-savior-airbend",
            triggerSourceId: "aang",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "aang",
                controllerId: "p1",
                types: ["Creature"],
            },
        } as StackItem);
        expect(raiseTriggerTargetSelection(state)).toBe(true);

        const answers = JSON.stringify(enumerateMoves(state, "p1"));
        expect(answers).toContain('"theirs"');
        expect(answers).toContain('"spell"');
        expect(enumerateMoves(state, "p1").length).toBeGreaterThan(2);
    });

    it("answers Appa's open-ended target, with a confirm-only zero (no freeze)", () => {
        const own = (cardId: string, id: string) =>
            makeInstance(cardId, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
        const appa = own(APPA, "appa");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [appa, own(BEARS, "b1"), own(BEARS, "b2")],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            turn: 5,
        });
        state.stack.push({
            ...appa,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "appa-steadfast-guardian-airbend",
            triggerSourceId: "appa",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "appa",
                controllerId: "p1",
                types: ["Creature"],
            },
        } as StackItem);
        expect(raiseTriggerTargetSelection(state)).toBe(true);

        const answers = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "submit-target"
        );
        expect(
            answers.some(
                (m) => m.kind === "submit-target" && m.targets.length === 0
            )
        ).toBe(true);
        expect(
            answers.some(
                (m) => m.kind === "submit-target" && m.targets.length === 2
            )
        ).toBe(true);
    });
});
