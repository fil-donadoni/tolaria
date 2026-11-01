// Manifest dread (CR 701.62, issue #2072) — the whole mechanic in one file:
//   - GRE unit: the `manifestDread` Op (CR 701.62a + its CR 608.2b clamps),
//     the face-down battlefield entry (CR 701.40a / 708.3), the CR 701.40b
//     turn-face-up special action and its parenthetical, CR 701.40c (a
//     manifested morph card), and the CR 708.4 cast-face-down replacements no
//     longer reaching a manifested or morph permanent.
//   - Integration: `applyTurnPermanentFaceUp` (the `turnPermanentFaceUp`
//     mutation's body). The Bot seam (`enumerateMoves` +
//     `applyMoveForSearch`) is `manifestDread.bot.test.ts`.
//   - Wire format: the controller's projection carries the real identity, the
//     opponent's never does; `faceDownBy: "manifest"` rides for both.
//   - Serialization: the producer survives the DB round-trip.
//   - Abhorrent Oculus: the "exile six cards from your graveyard" additional
//     cost (CR 601.2f / 118.8) and the each-opponent's-upkeep trigger.

import { describe, expect, it } from "vitest";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    FACE_DOWN_CARD_ID,
    getCardByName,
    registerTokenDefinition,
} from "../../cards";
import type { EffectOp } from "../../cards/types";
import { containmentPriest } from "../../cards/sets/c14/white.cards";
import { underworldBreach } from "../../cards/sets/thb/red.cards";
import { canTurnFaceUp, turnFaceUpPayment } from "../morph";
import { turnFaceDown } from "../faceDown";
import {
    resolveTopOfStack,
    runDamageReplacement,
    tapPermanent,
} from "../state";
import type { GameState } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getEffectivePower, NO_BOARD_LAYER_VIEW } from "../layers";
import { collectTriggers, placeTriggersOnStack } from "../triggers";
import { getLegalActions } from "../rules";
import { buildCastExileCostChoice } from "../castCost";
import { applyTurnPermanentFaceUp } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import {
    BEARS,
    card,
    FOREST,
    ISLAND,
    lands,
    manifestedBoard,
    OCULUS,
    oculusBoard,
} from "./manifestDread.helper";

const ANGEL = getCardByName("Exalted Angel").id; // {4}{W}{W}, morph {2}{W}{W}
const COUNTERSPELL = getCardByName("Counterspell").id;
const PLAINS = getCardByName("Plains").id;
// Registered through the definition seam rather than looked up by name, so the
// file runs on a tree whose derived Definition Index is still the base's
// (ADR 0157 — `derive:regenerate` repacks it in the lane).
const PRIEST = containmentPriest();
registerTokenDefinition(PRIEST);
const BREACH = underworldBreach();
registerTokenDefinition(BREACH);

/** A DSL-only sorcery whose whole script is `manifestDread` for its caster. */
const MANIFEST_SPELL = "test-manifest-dread-spell";
registerTokenDefinition({
    id: MANIFEST_SPELL,
    name: MANIFEST_SPELL,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "manifestDread", player: "controller" },
    ] satisfies EffectOp[],
});

/** Drives the suspended look-distribute pick to manifest `pick`. */
function submitPick(state: GameState, pick: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [pick],
    });
}

describe("manifestDread Op (CR 701.62a)", () => {
    it("looks at the top two, manifests the pick face down and bins the other", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        card(COUNTERSPELL, "a", "library"),
                        card(BEARS, "b", "library"),
                        card(FOREST, "c", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, MANIFEST_SPELL, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toEqual(["a", "b"]);
        // "Manifest ONE of them" — exactly one, not a may.
        expect(head.count).toEqual({ min: 1, max: 1 });

        submitPick(state, "b");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const manifested = state.players[0].battlefield.find(
            (c) => c.id === "b"
        )!;
        // CR 701.40a — a 2/2 face-down creature, the real card kept behind it.
        expect(manifested.faceDown).toBe(true);
        expect(manifested.faceDownBy).toBe("manifest");
        expect(manifested.faceDownOf).toBe(BEARS);
        expect((manifested.card as { id: string }).id).toBe(FACE_DOWN_CARD_ID);
        expect(getEffectivePower(state, manifested)).toBe(2);
        // The other looked-at card went to the graveyard; the third is untouched.
        const graveyard = state.players[0].graveyard.map((c) => c.id);
        expect(graveyard).toContain("a");
        expect(graveyard).not.toContain("b");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["c"]);
    });

    it("CR 608.2b — a lone library card is manifested with no prompt and nothing binned", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: [card(BEARS, "a", "library")] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, MANIFEST_SPELL, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            state.players[0].battlefield.find((c) => c.id === "a")?.faceDownBy
        ).toBe("manifest");
        // Only the resolved sorcery itself is in the graveyard.
        expect(state.players[0].graveyard.map((c) => c.card.id)).toEqual([
            MANIFEST_SPELL,
        ]);
    });

    it("CR 608.2b — an empty library is a clean no-op that never suspends", () => {
        const state = makeState();
        pushSpell(state, MANIFEST_SPELL, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].battlefield).toHaveLength(0);
    });

    it("CR 701.40f — a manifest an entry replacement exiles reaches exile as the real card", () => {
        // Containment Priest: "If a nontoken creature would enter and it
        // wasn't cast, exile it instead." The face-down 2/2 IS such a creature
        // (CR 708.3), and the card it exiles was never manifested.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [card(BEARS, "a", "library")],
                    battlefield: [card(PRIEST.id, "priest", "battlefield")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, MANIFEST_SPELL, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "a")
        ).toBeUndefined();
        const exiled = state.players[0].exile.find((c) => c.id === "a")!;
        expect(exiled.faceDown).toBeUndefined();
        expect((exiled.card as { id: string }).id).toBe(BEARS);
    });

    it("CR 701.40a — a manifested LAND card is a 2/2 creature, not a land", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: [card(FOREST, "a", "library")] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, MANIFEST_SPELL, "p1");
        resolveTopOfStack(state);
        const manifested = state.players[0].battlefield.find(
            (c) => c.id === "a"
        )!;
        expect(manifested.types).toEqual(["Creature"]);
        expect(manifested.faceDownOf).toBe(FOREST);
    });

    it("wire format: the controller sees the identity, the opponent sees the sentinel; both see the producer", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: [card(BEARS, "a", "library")] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, MANIFEST_SPELL, "p1");
        resolveTopOfStack(state);

        const own = projectPublicState(state, 1, "p1").players[0].battlefield;
        const ownCard = own.find((c) => c.id === "a")!;
        // CR 708.5 — the controller may look at a face-down permanent.
        expect(ownCard.knownCardId).toBe(BEARS);
        expect(ownCard.faceDownBy).toBe("manifest");

        const opp = projectPublicState(state, 1, "p2").players[0].battlefield;
        const oppCard = opp.find((c) => c.id === "a")!;
        expect(oppCard.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(oppCard.knownCardId).toBeUndefined();
        expect(JSON.stringify(oppCard)).not.toContain(BEARS);
        // That a permanent was MANIFESTED is public; only its identity is not.
        expect(oppCard.faceDownBy).toBe("manifest");
    });

    it("survives a DB round-trip with its producer", () => {
        const { state } = manifestedBoard(BEARS, FOREST, 0);
        const round = expandState(compactState(state));
        const after = round.players[0].battlefield[0];
        expect(after.faceDownBy).toBe("manifest");
        expect(after.faceDownOf).toBe(BEARS);
    });
});

describe("turning a manifested permanent face up (CR 701.40b / 116.2b)", () => {
    it("a manifested creature card turns up for its mana cost", () => {
        const { state, permanent } = manifestedBoard(BEARS, FOREST, 2);
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(true);
        // The wire affordance is the same predicate.
        const projected = projectPublicState(state, 1, "p1").players[0]
            .battlefield[0];
        expect(projected.canTurnFaceUp).toBe(true);

        applyTurnPermanentFaceUp(state, "p1", "manifested");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "manifested"
        )!;
        expect(after.faceDown).toBeUndefined();
        expect(after.faceDownBy).toBeUndefined();
        expect((after.card as { id: string }).id).toBe(BEARS);
        // {1}{G} paid: both Forests tapped.
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(2);
    });

    it("refuses when the mana cost is unaffordable", () => {
        const { state, permanent } = manifestedBoard(BEARS, FOREST, 1);
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(false);
        expect(() =>
            applyTurnPermanentFaceUp(state, "p1", "manifested")
        ).toThrow();
    });

    it("CR 701.40b / 701.40g — a manifested noncreature card can't be turned up this way", () => {
        const { state, permanent } = manifestedBoard(COUNTERSPELL, ISLAND, 6);
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(false);
    });

    it("CR 701.40b — a manifested land card has no mana cost and can't be turned up", () => {
        const { state, permanent } = manifestedBoard(FOREST, FOREST, 6);
        expect(canTurnFaceUp(state, state.players[0], permanent)).toBe(false);
    });

    it("CR 701.40c — a manifested morph card takes the cheaper of its two procedures", () => {
        // Morph {2}{W}{W} (4) beats the mana cost {4}{W}{W} (6).
        const { state, permanent } = manifestedBoard(ANGEL, PLAINS, 6);
        expect(
            turnFaceUpPayment(state, state.players[0], permanent)?.plan
        ).toHaveLength(4);
        applyTurnPermanentFaceUp(state, "p1", "manifested");
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(4);
    });
});

describe("the CR 708.4 cast-face-down turn-up replacements (issue #2072)", () => {
    const tapped = (producer: "manifest" | "morph" | "cast-face-down") => {
        const permanent = card(
            producer === "morph" ? ANGEL : BEARS,
            "fd",
            "battlefield"
        );
        turnFaceDown(NO_BOARD_LAYER_VIEW, permanent, producer);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [permanent] }),
                makePlayer("p2"),
            ],
        });
        const live = state.players[0].battlefield[0];
        tapPermanent(state, live);
        return live;
    };

    const damaged = (
        producer: "manifest" | "morph" | "cast-face-down",
        side: "deals" | "dealt"
    ) => {
        const permanent = card(
            producer === "morph" ? ANGEL : BEARS,
            "fd",
            "battlefield"
        );
        turnFaceDown(NO_BOARD_LAYER_VIEW, permanent, producer);
        const other = card(BEARS, "other", "battlefield", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [permanent] }),
                makePlayer("p2", { battlefield: [other] }),
            ],
        });
        if (side === "deals") {
            runDamageReplacement(
                state,
                "fd",
                "p1",
                { type: "permanent", id: "other" },
                2,
                true
            );
        } else {
            runDamageReplacement(
                state,
                "other",
                "p2",
                { type: "permanent", id: "fd" },
                1,
                true
            );
        }
        return state.players[0].battlefield[0];
    };

    for (const producer of ["manifest", "morph"] as const) {
        it(`a ${producer} permanent that deals or is dealt damage stays face down`, () => {
            expect(damaged(producer, "deals").faceDown).toBe(true);
            expect(damaged(producer, "dealt").faceDown).toBe(true);
        });
    }

    it("an Illusionary Mask permanent dealt damage still turns face up", () => {
        expect(damaged("cast-face-down", "dealt").faceDown).toBeUndefined();
        expect(damaged("cast-face-down", "deals").faceDown).toBeUndefined();
    });

    it("a manifested permanent becomes tapped and stays face down", () => {
        const live = tapped("manifest");
        expect(live.isTapped).toBe(true);
        expect(live.faceDown).toBe(true);
    });

    it("a morph permanent becomes tapped and stays face down", () => {
        expect(tapped("morph").faceDown).toBe(true);
    });

    it("an Illusionary Mask (cast-face-down) permanent still turns face up", () => {
        expect(tapped("cast-face-down").faceDown).toBeUndefined();
    });
});

describe("Abhorrent Oculus — additional cost (CR 601.2f / 118.8 / 601.2h)", () => {
    it("castable with six other cards in the graveyard, not with five", () => {
        const six = oculusBoard(6);
        expect(
            getLegalActions(six, six.players[0], six.players[0].hand[0])
        ).toContain("cast");
        const five = oculusBoard(5);
        expect(
            getLegalActions(five, five.players[0], five.players[0].hand[0])
        ).not.toContain("cast");
    });

    it("a HAND cast parks on the one graveyard-exile picker for six cards", () => {
        const state = oculusBoard(7);
        const player = state.players[0];
        expect(
            buildCastExileCostChoice(state, player, player.hand[0], "hand", {
                additionalCosts: OCULUS.additionalCosts,
            })
        ).toEqual({ choice: { count: 6, excludeInstanceId: "oculus" } });
    });

    it("CR 601.2f — an escape cast (Underworld Breach) owes the escape exile ON TOP of the six", () => {
        const breachBoard = (others: number): GameState =>
            makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [
                            card(OCULUS.id, "oculus", "graveyard"),
                            ...Array.from({ length: others }, (_, i) =>
                                card(BEARS, `gy${i}`, "graveyard")
                            ),
                        ],
                        battlefield: [
                            card(BREACH.id, "breach", "battlefield"),
                            ...lands(ISLAND, 3),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
        // Breach's escape: "exile three other cards" — 6 + 3 = 9 owed.
        const nine = breachBoard(9);
        const p9 = nine.players[0];
        expect(
            buildCastExileCostChoice(nine, p9, p9.graveyard[0], "graveyard", {
                additionalCosts: OCULUS.additionalCosts,
            })
        ).toEqual({ choice: { count: 9, excludeInstanceId: "oculus" } });
        expect(getLegalActions(nine, p9, p9.graveyard[0])).toContain("cast");
        const eight = breachBoard(8);
        expect(
            getLegalActions(
                eight,
                eight.players[0],
                eight.players[0].graveyard[0]
            )
        ).not.toContain("cast");
    });
});

describe("Abhorrent Oculus — each opponent's upkeep, manifest dread (CR 503.1a / 701.62a)", () => {
    function oculusInPlay(activePlayerId: string): GameState {
        return makeState({
            activePlayerId,
            phase: "UPKEEP",
            players: [
                makePlayer("p1", {
                    battlefield: [card(OCULUS.id, "oculus", "battlefield")],
                    library: [card(BEARS, "mine", "library")],
                }),
                makePlayer("p2", {
                    library: [card(BEARS, "theirs", "library", "p2")],
                }),
            ],
        });
    }

    it("fires on the opponent's upkeep and manifests from its CONTROLLER's library", () => {
        const state = oculusInPlay("p2");
        const triggers = collectTriggers(state, [
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p2" },
        ]);
        expect(triggers).toHaveLength(1);
        placeTriggersOnStack(state, triggers);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
                ?.faceDownBy
        ).toBe("manifest");
        expect(state.players[1].library.map((c) => c.id)).toEqual(["theirs"]);
    });

    it("does not fire on its controller's own upkeep", () => {
        const state = oculusInPlay("p1");
        expect(
            collectTriggers(state, [
                { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
            ])
        ).toHaveLength(0);
    });
});
