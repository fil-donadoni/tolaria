// Waterbend (CR 701.67): the optional, partial tap substitution for the generic
// mana of a cost, through the real game.ts entry points and the wire projection.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import {
    activateAbilityOnState,
    applyOneTargetSelection,
    declineGenericSubstitutionOnState,
    selectActivationCostOnState,
} from "../../game";
import {
    genericSubstitutionsLeft,
    isTapOtherChoicePaid,
    manaCostAfterSubstitution,
} from "../tapOtherCost";
import { tryAutoCommitPendingActivation } from "../activation";
import { nextOwedPayment } from "../owedPayment";
import { projectPublicState } from "../../gameProjections";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { waterbendCost } from "../../cards/abilities/waterbend";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const ABILITY = "aangs-iceberg-waterbend";

const on = (name: string, id: string, tapped = false) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: tapped,
    });

function board(
    ...perms: ReadonlyArray<ReturnType<typeof makeInstance>>
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [on("Aang's Iceberg", "iceberg"), ...perms],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const announce = (state: GameState, abilityId = ABILITY) =>
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "iceberg",
        abilityId,
    });
const pick = (state: GameState, cardInstanceId: string) =>
    selectActivationCostOnState(state, { playerId: "p1", cardInstanceId });
const decline = (state: GameState) =>
    declineGenericSubstitutionOnState(state, { playerId: "p1" });
const tappedIds = (state: GameState) =>
    state.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();

describe("waterbend predicates (CR 701.67a/b)", () => {
    it("the substitution leg owes nothing: it reads paid at zero picks (the 'may')", () => {
        const toc = { substitutesGeneric: 3, pickedIds: [] };
        expect(isTapOtherChoicePaid(toc)).toBe(true);
    });

    it("what is left is bounded by the cap and by the generic still owed", () => {
        const toc = { substitutesGeneric: 3, pickedIds: ["a"] };
        expect(genericSubstitutionsLeft(toc, { X: 5 })).toBe(2);
        expect(genericSubstitutionsLeft(toc, { X: 1, U: 2 })).toBe(1);
        expect(genericSubstitutionsLeft(toc, { U: 2 })).toBe(0);
        expect(genericSubstitutionsLeft({ pickedIds: [] }, { X: 5 })).toBe(0);
    });

    it("the generic key goes away at zero and coloured pips are untouched", () => {
        expect(manaCostAfterSubstitution({ X: 2, U: 1 }, 1)).toEqual({
            X: 1,
            U: 1,
        });
        expect(manaCostAfterSubstitution({ X: 1, U: 1 }, 1)).toEqual({ U: 1 });
    });
});

describe("Waterbend {3} on Aang's Iceberg (CR 701.67a)", () => {
    it("is announceable with no mana at all, and parks with the picker open", () => {
        const state = board(on("Grizzly Bears", "b1"));
        announce(state);
        const pa = state.pendingActivation!;
        expect(pa.manaCost).toEqual({ X: 3 });
        expect(pa.tapOtherChoice).toMatchObject({
            substitutesGeneric: 3,
            pickedIds: [],
        });
        expect(state.stack).toHaveLength(0);
    });

    it("every pip paid by tapping: artifacts and creatures mix, commit on the last", () => {
        const state = board(
            on("Grizzly Bears", "b1"),
            on("Sol Ring", "ring"),
            on("Savannah Lions", "l1")
        );
        announce(state);
        pick(state, "b1");
        expect(state.pendingActivation!.manaCost).toEqual({ X: 2 });
        pick(state, "ring");
        expect(state.pendingActivation!.manaCost).toEqual({ X: 1 });
        // CR 601.2h — nothing taps until the cost is paid.
        expect(tappedIds(state)).toEqual([]);
        pick(state, "l1");
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(tappedIds(state)).toEqual(["b1", "l1", "ring"]);
    });

    it("a partial mix: one pick, then mana pays the rest (no mana entered the pool from the tap)", () => {
        const state = board(on("Grizzly Bears", "b1"));
        announce(state);
        pick(state, "b1");
        const me = state.players[0];
        // CR 605.1a — the tap is not a mana ability.
        expect(me.manaPool.C ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
        me.manaPool.R = 2;
        tryAutoCommitPendingActivation(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(0);
        expect(tappedIds(state)).toEqual(["b1"]);
    });

    it("zero picks: plain mana pays it all and nothing else taps", () => {
        const state = board(on("Grizzly Bears", "b1"));
        state.players[0].manaPool.R = 3;
        announce(state);
        decline(state);
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].manaPool.R).toBe(0);
        expect(tappedIds(state)).toEqual([]);
    });

    it("cancelling after a pick taps nothing that was never tapped", () => {
        const state = board(on("Grizzly Bears", "b1"));
        announce(state);
        pick(state, "b1");
        state.pendingActivation = undefined;
        expect(tappedIds(state)).toEqual([]);
    });

    it.each([
        ["a land", () => on("Mountain", "x"), /does not match/],
        ["a tapped creature", () => on("Grizzly Bears", "x", true), /tapped/],
    ])("refuses %s as a pick", (_label, make, message) => {
        const state = board(make());
        announce(state);
        expect(() => pick(state, "x")).toThrow(message);
    });

    it("refuses the source itself and a second pick of one permanent", () => {
        const state = board(on("Grizzly Bears", "b1"));
        announce(state);
        expect(() => pick(state, "iceberg")).toThrow(/own source/);
        pick(state, "b1");
        expect(() => pick(state, "b1")).toThrow(/already selected/);
        expect(state.pendingActivation!.manaCost).toEqual({ X: 2 });
    });

    it("a pick tapped before commit drops the activation, and nothing else taps", () => {
        const state = board(on("Grizzly Bears", "b1"), on("Sol Ring", "ring"));
        announce(state);
        pick(state, "b1");
        state.players[0].battlefield.find((c) => c.id === "b1")!.isTapped =
            true;
        state.players[0].manaPool.R = 2;
        tryAutoCommitPendingActivation(state, "p1");
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(tappedIds(state)).toEqual(["b1"]);
    });

    it("wire format: the projection carries the decremented cost and the picker", () => {
        const state = board(on("Grizzly Bears", "b1"), on("Sol Ring", "ring"));
        announce(state);
        pick(state, "b1");
        const pa = projectPublicState(state, 1, "p1").pendingActivation!;
        expect(pa.manaCost).toEqual({ X: 2 });
        expect(pa.tapOtherChoice).toMatchObject({
            substitutesGeneric: 3,
            pickedIds: ["b1"],
        });
        expect(genericSubstitutionsLeft(pa.tapOtherChoice!, pa.manaCost)).toBe(
            2
        );
    });
});

describe("CR 701.67a — tapping instead of spending floating mana", () => {
    const bodies = () => [
        on("Grizzly Bears", "b1"),
        on("Grizzly Bears", "b2"),
        on("Grizzly Bears", "b3"),
    ];

    it("floating mana covering the cost does not commit: it can be kept by tapping", () => {
        const state = board(...bodies());
        const me = state.players[0];
        me.manaPool.R = 3;
        announce(state);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation?.genericSubstitutionOffer).toBe(true);

        pick(state, "b1");
        pick(state, "b2");
        expect(state.stack).toHaveLength(0);
        pick(state, "b3");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(3);
        expect(tappedIds(state)).toEqual(["b1", "b2", "b3"]);
    });

    it("two picks leaving {1} that the pool covers: the third pick is still offered", () => {
        const state = board(...bodies());
        const me = state.players[0];
        me.manaPool.R = 1;
        announce(state);
        expect(
            state.pendingActivation?.genericSubstitutionOffer
        ).toBeUndefined();
        pick(state, "b1");
        pick(state, "b2");
        expect(state.stack).toHaveLength(0);
        pick(state, "b3");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(1);
    });

    it("declining after a partial mix spends the mana for what is left", () => {
        const state = board(...bodies());
        const me = state.players[0];
        me.manaPool.R = 3;
        announce(state);
        pick(state, "b1");
        decline(state);
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(1);
        expect(tappedIds(state)).toEqual(["b1"]);
    });

    it("no eligible permanent: commits with no question", () => {
        const state = board(
            on("Grizzly Bears", "b1", true),
            on("Mountain", "m1")
        );
        state.players[0].manaPool.R = 3;
        announce(state);
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
    });

    it("the last candidate picked: commits with no question", () => {
        const state = board(on("Grizzly Bears", "b1"));
        const me = state.players[0];
        me.manaPool.R = 3;
        announce(state);
        pick(state, "b1");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(1);
    });

    it("mana arriving by itself reaches coverage with no question, a candidate or not", () => {
        const state = board(...bodies());
        const me = state.players[0];
        announce(state);
        me.manaPool.R = 3;
        tryAutoCommitPendingActivation(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(0);
        expect(tappedIds(state)).toEqual([]);
    });

    it("the offer lapses when the last candidate is tapped some other way", () => {
        const state = board(on("Grizzly Bears", "b1"));
        const me = state.players[0];
        me.manaPool.R = 3;
        announce(state);
        expect(state.stack).toHaveLength(0);
        me.battlefield.find((c) => c.id === "b1")!.isTapped = true;
        tryAutoCommitPendingActivation(state, "p1");
        expect(state.stack).toHaveLength(1);
    });

    it("the offer is a park the owed-payment seam reports, once and only while it stands", () => {
        const state = board(...bodies());
        expect(nextOwedPayment(state, "p1")).toBeNull();
        state.players[0].manaPool.R = 3;
        announce(state);
        expect(nextOwedPayment(state, "p1")?.kind).toBe(
            "activation:genericSubstitutionOffer"
        );
        decline(state);
        expect(nextOwedPayment(state, "p1")).toBeNull();
    });

    it("declining with nothing on offer is refused", () => {
        const state = board(...bodies());
        announce(state);
        expect(() => decline(state)).toThrow(/No tap substitution on offer/);
    });

    it("a targeted ability makes the offer once its target is chosen", () => {
        const ID = "test-waterbend-targeted";
        registerTokenDefinition({
            ...getCardByName("Aang's Iceberg"),
            id: ID,
            name: "Test Waterbend Targeted",
            activatedAbilities: [
                {
                    id: ID,
                    oracleText:
                        "Waterbend {1}: Draw a card. Target a creature.",
                    cost: waterbendCost(1),
                    useStack: true,
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(ID, {
                            id: "iceberg",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                        on("Grizzly Bears", "b1"),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const me = state.players[0];
        me.manaPool.R = 1;
        announce(state, ID);
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "b1",
        });
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation?.genericSubstitutionOffer).toBe(true);
        pick(state, "b1");
        expect(state.stack).toHaveLength(1);
        expect(me.manaPool.R).toBe(1);
    });

    it("wire format: the projection carries the offer", () => {
        const state = board(...bodies());
        state.players[0].manaPool.R = 3;
        announce(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingActivation?.genericSubstitutionOffer).toBe(
            true
        );
    });
});

describe("CR 701.67b — only the waterbend cost's own generic is substitutable", () => {
    const ID = "test-waterbend-part-of-total";
    registerTokenDefinition({
        ...getCardByName("Aang's Iceberg"),
        id: ID,
        name: "Test Waterbend Part Of Total",
        activatedAbilities: [
            {
                id: "test-waterbend-part",
                oracleText: "{1}{U}, Waterbend {2}: Draw a card.",
                cost: waterbendCost(2, { X: 1, U: 1 }),
                useStack: true,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ],
    });

    it("the third tap is refused: the {1} beside the waterbend cost needs mana", () => {
        const source = makeInstance(ID, {
            id: "iceberg",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        source,
                        on("Grizzly Bears", "b1"),
                        on("Grizzly Bears", "b2"),
                        on("Grizzly Bears", "b3"),
                    ],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        announce(state, "test-waterbend-part");
        expect(state.pendingActivation!.manaCost).toEqual({ X: 3, U: 1 });
        pick(state, "b1");
        pick(state, "b2");
        expect(state.pendingActivation!.manaCost).toEqual({ X: 1, U: 1 });
        expect(() => pick(state, "b3")).toThrow(/No generic mana left/);
    });
});
