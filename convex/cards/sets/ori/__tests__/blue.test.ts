// ORI blue — Jace, Vryn's Prodigy // Jace, Telepath Unbound (issue #2380).
//
// The card is the tracer for the exile-and-return-transformed template, whose
// Op-level coverage (CR 400.7 new-object semantics, CR 306.5b starting loyalty,
// wire format) lives with the Op itself in
// `convex/gre/effects/__tests__/interpreter.test.ts`. What is tested HERE is
// what only this card can prove: the conditional flip actually fires off the
// front face's own activated ability at the right graveyard count, and each of
// the three back-face loyalty abilities is reachable and does what it says.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    assertLoyaltyActivationLegal,
    graveyardCastStackFlags,
    payLoyaltyCost,
} from "../../../../game";
import { compactState, expandState } from "../../../../gre/serialize";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { advancePhase } from "../../../../gre/phases";
import { getDefinition } from "../../../index";
import { jaceVrynsProdigy } from "../blue";
import { JACE_TELEPATH_UNBOUND_EMBLEM_ID } from "../../../emblems";
import { lightningBolt } from "../../lea/red";
import { grizzlyBears } from "../../lea/green";

const JACE = jaceVrynsProdigy.id;

/** Board with Jace (front face) on p1's battlefield, `graveyard` filler cards
 *  in p1's graveyard, and one card in hand to discard to the loot. */
function boardWithJace(graveyardCount: number): {
    state: GameState;
    jace: CardInstanceState;
} {
    const jace = makeInstance(JACE, {
        id: "jace",
        controllerId: "p1",
        ownerId: "p1",
    });
    const graveyard = Array.from({ length: graveyardCount }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `gy${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        })
    );
    const hand = [
        makeInstance(lightningBolt.id, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        }),
    ];
    const library = [
        makeInstance(lightningBolt.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }),
    ];
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [jace],
                graveyard,
                hand,
                library,
            }),
            makePlayer("p2"),
        ],
    });
    return { state, jace };
}

/** Activates the front face's own "{T}: Draw a card, then discard a card…"
 *  ability and answers the discard choice with `discardId`. */
function loot(state: GameState, discardId: string): void {
    const src = state.players[0].battlefield.find((c) => c.id === "jace")!;
    state.stack.push({
        ...src,
        zone: "stack",
        castById: "p1",
        abilityId: "jace-vryns-prodigy-loot",
        targets: [],
    });
    resolveTopOfStack(state);
    const choice = state.pendingChoices![0];
    expect(choice.kind).toBe("choose-hand-card");
    applyPendingChoiceSubmit(state, {
        playerId: "p1",
        stackItemId: choice.stackItemId,
        step: choice.step,
        choiceId: choice.choiceId,
        cardInstanceIds: [discardId],
    });
}

describe("Jace, Vryn's Prodigy — the loot + conditional flip (CR 712 / 400.7)", () => {
    it("loots without flipping while the graveyard is short of five (the discard is counted)", () => {
        // Three cards in the graveyard: the loot's own discard makes four —
        // still one short, so the `if` branch does not run.
        const { state } = boardWithJace(3);
        loot(state, "hand1");

        expect(state.players[0].graveyard).toHaveLength(4);
        const still = state.players[0].battlefield.find(
            (c) => c.id === "jace"
        )!;
        expect(still.transformed).toBeUndefined();
        expect(still.types).toEqual(["Creature"]);
        expect(still.counters?.loyalty).toBeUndefined();
    });

    it("flips when the just-discarded card is the fifth (CR 608.2 — written order)", () => {
        // Four in the graveyard: the discard takes it to five DURING this
        // resolution, and the check runs after it. This is the ordering
        // assertion — a check placed before the discard would not fire here.
        const { state } = boardWithJace(4);
        loot(state, "hand1");

        expect(state.players[0].graveyard).toHaveLength(5);
        const flipped = state.players[0].battlefield.find(
            (c) => c.id === "jace"
        )!;
        expect(flipped.transformed).toBe(true);
        expect(flipped.types).toEqual(["Planeswalker"]);
        expect(flipped.subtypes).toEqual(["Jace"]);
        // CR 306.5b — Jace, Telepath Unbound's printed starting loyalty.
        expect(flipped.counters?.loyalty).toBe(5);
        expect(state.players[0].exile).toHaveLength(0);

        // Wire format: the client renders the planeswalker face and its
        // loyalty off the projection, for BOTH players (CR 712.1a — transform
        // is public information).
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "jace"
            )!;
            expect(slim.types).toEqual(["Planeswalker"]);
            expect(slim.counters?.loyalty).toBe(5);
            const backDef = getDefinition(slim.card.id);
            expect(backDef.name).toBe("Jace, Telepath Unbound");
            expect(backDef.loyalty).toBe(5);
            expect(backDef.activatedAbilities).toHaveLength(3);
        }
    });

    it("the returned planeswalker is a NEW object — the creature's counters do not survive (CR 400.7)", () => {
        const { state, jace } = boardWithJace(4);
        jace.counters = { "+1/+1": 2 };
        loot(state, "hand1");

        const flipped = state.players[0].battlefield.find(
            (c) => c.id === "jace"
        )!;
        expect(flipped.counters?.["+1/+1"]).toBeUndefined();
        expect(flipped.counters?.loyalty).toBe(5);
    });
});

describe("Jace, Telepath Unbound — the three loyalty abilities (CR 606)", () => {
    /** Board with the BACK face already on the battlefield, reached through the
     *  real flip (never hand-built) so the abilities under test are the ones a
     *  real game would offer. */
    function flippedBoard(): {
        state: GameState;
        jace: CardInstanceState;
    } {
        const { state } = boardWithJace(4);
        loot(state, "hand1");
        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        expect(jace.transformed).toBe(true);
        return { state, jace };
    }

    function backFaceAbility(state: GameState, abilityId: string) {
        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        const def = getDefinition((jace.card as { id: string }).id);
        return def.activatedAbilities!.find((a) => a.id === abilityId)!;
    }

    function activate(
        state: GameState,
        abilityId: string,
        targets: {
            type: "permanent" | "graveyard-card";
            id: string;
            playerId?: string;
        }[] = []
    ): void {
        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        payLoyaltyCost(jace, backFaceAbility(state, abilityId));
        state.stack.push({
            ...jace,
            zone: "stack",
            castById: "p1",
            abilityId,
            targets,
        });
        resolveTopOfStack(state);
    }

    it("+1 — up to one target creature gets -2/-0 until the controller's next turn", () => {
        const { state } = flippedBoard();
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bear);

        activate(state, "jace-telepath-unbound-plus1", [
            { type: "permanent", id: "bear" },
        ]);

        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        // CR 606.5 — the +1 raised loyalty from the starting 5.
        expect(jace.counters?.loyalty).toBe(6);
        // 2/2 Grizzly Bears −2/−0 reads as 0/2 (layer 7c).
        expect(getEffectivePower(state, bear)).toBe(0);
        expect(getEffectiveToughness(state, bear)).toBe(2);

        // "until YOUR next turn" (CR 502.1) — the effect is scoped to JACE's
        // controller, not the creature's. p2's own untap step must NOT end it,
        // even though p2 controls the shrunken creature.
        state.activePlayerId = "p1";
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(getEffectivePower(state, bear)).toBe(0);

        // p1's next untap step does.
        state.activePlayerId = "p2";
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("−3 — grants a this-turn cast of a targeted instant/sorcery from the graveyard, exiling it on resolution", () => {
        const { state } = flippedBoard();
        const target = state.players[0].graveyard.find(
            (c) => (c.card as { id: string }).id === lightningBolt.id
        )!;

        activate(state, "jace-telepath-unbound-minus3", [
            { type: "graveyard-card", id: target.id, playerId: "p1" },
        ]);

        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        expect(jace.counters?.loyalty).toBe(2);
        const granted = state.players[0].graveyard.find(
            (c) => c.id === target.id
        )!;
        expect(granted.castableFromGraveyardBy).toBe("p1");
        // CR 514.2 — an impulse "this turn" window, revoked at CLEANUP.
        expect(granted.castableFromGraveyardUntilTurn).toBe(state.turn);
        // "If that spell would be put into your graveyard, exile it instead."
        expect(granted.castFromGraveyardExilesOnResolve).toBe(true);
        // The grant is a permission, not a cost waiver (Jace does not say
        // "without paying its mana cost").
        expect(granted.castFromGraveyardWithoutPayingManaCost).toBeUndefined();

        // Full path GRE → game.ts: the flag the grant stamped is what the CAST
        // site reads to redirect the spell off the stack. Asserting the flag
        // alone would leave the two halves passing individually and failing
        // together (CR 702.34a's Flashback exile shares this seam).
        expect(graveyardCastStackFlags(state, granted, "graveyard")).toEqual({
            castFromGraveyard: true,
            exileOnResolve: true,
        });

        // The grant must survive the DB round-trip (the window outlives the
        // mutation that opened it).
        const rehydrated = expandState(compactState(state));
        const roundTripped = rehydrated.players[0].graveyard.find(
            (c) => c.id === target.id
        )!;
        expect(roundTripped.castFromGraveyardExilesOnResolve).toBe(true);
        expect(roundTripped.castableFromGraveyardBy).toBe("p1");
    });

    it("−9 — creates the mill-on-cast emblem (CR 114)", () => {
        const { state } = flippedBoard();
        // Nine loyalty needed: the ultimate is only reachable after the +1s,
        // which this test short-circuits by topping the counters up directly
        // (the +1 path itself is covered above).
        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        jace.counters = { ...jace.counters, loyalty: 9 };

        activate(state, "jace-telepath-unbound-minus9");

        const after = state.players[0].battlefield.find(
            (c) => c.id === "jace"
        )!;
        expect(after.counters?.loyalty).toBe(0);
        expect(
            (state.emblems ?? []).some(
                (e) =>
                    e.emblemId === JACE_TELEPATH_UNBOUND_EMBLEM_ID &&
                    e.ownerId === "p1"
            )
        ).toBe(true);
    });

    it("only one loyalty ability per turn (CR 606.3)", () => {
        const { state } = flippedBoard();
        const jace = state.players[0].battlefield.find((c) => c.id === "jace")!;
        state.phase = "PRECOMBAT_MAIN";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.stack = [];

        const plus1 = backFaceAbility(state, "jace-telepath-unbound-plus1");
        expect(() =>
            assertLoyaltyActivationLegal(state, jace, plus1)
        ).not.toThrow();
        payLoyaltyCost(jace, plus1);
        expect(jace.loyaltyActivatedThisTurn).toBe(true);
        expect(() => assertLoyaltyActivationLegal(state, jace, plus1)).toThrow(
            /already been activated/
        );
    });
});
