// `handExileCostReduction` — "As an additional cost to cast this spell, you may
// exile any number of white cards from your hand. This spell costs {2} less to
// cast for each card exiled this way." (CR 601.2b / 601.2f / 118.8 — March of
// Otherworldly Light, issue #8625.) The cost rides the `payWith` variable-offset
// picker Delve shares (`gre/payWith.ts`), in `zone: "hand"`, paying {2} a card.
//
// Layers: GRE unit (fuel + picker bounds), integration through the real
// `finalizeTargetSelection` park / `recordCastExileCostPick` / commit seams,
// castability gate, wire format through `projectPublicState`.

import { describe, it, expect } from "vitest";
import {
    buildDelveExileChoice,
    collapseForcedDelvePick,
    genericFuelCards,
    genericFuelOf,
} from "../gre/payWith";
import { getLegalActions } from "../gre/rules";
import {
    finalizeTargetSelection,
    recordCastExileCostPick,
    tryAutoCommitPendingCast,
} from "../game";
import type { PendingTarget } from "../gre/state";
import { projectPublicState } from "../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";

const MARCH = getCardByName("March of Otherworldly Light")!.id;
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const LION = getCardByName("Lion Sash")!.id; // white, in hand = white fuel
const DISRUPT = "c6cc89b0-9acf-452b-ac1a-bc7e90eb32fc"; // blue: never fuel
const BEAR = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears

/** March in hand with `white` white cards and `blue` blue cards beside it, and
 *  `lands` untapped Plains. An opposing creature is the target. */
function board(white: number, blue: number, lands: number) {
    const spell = makeInstance(MARCH, {
        id: "march",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const hand = [
        spell,
        ...Array.from({ length: white }, (_, i) =>
            makeInstance(LION, {
                id: `w${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        ),
        ...Array.from({ length: blue }, (_, i) =>
            makeInstance(DISRUPT, {
                id: `b${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        ),
    ];
    const battlefield = Array.from({ length: lands }, (_, i) =>
        makeInstance(PLAINS, { id: `pl${i}`, controllerId: "p1" })
    );
    const target = makeInstance(BEAR, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
    const p1 = makePlayer("p1", { hand, battlefield });
    const p2 = makePlayer("p2", { battlefield: [target] });
    const state = makeState({
        players: [p1, p2],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return { state, player: state.players[0], spell };
}

describe("hand-exile fuel (CR 601.2b, 105.2)", () => {
    it("reads the declaration off the definition", () => {
        const { spell } = board(0, 0, 0);
        expect(genericFuelOf(spell)).toEqual({
            zone: "hand",
            color: "W",
            perCard: 2,
        });
    });

    it("only WHITE cards in hand are fuel, never the spell itself", () => {
        const { player, spell } = board(2, 2, 0);
        expect(
            genericFuelCards(player, spell)
                .map((c) => c.id)
                .sort()
        ).toEqual(["w0", "w1"]);
    });
});

describe("picker bounds — each card pays {2} of the generic cost", () => {
    it("max = min(white cards, ceil(generic / 2)); perCard rides the choice", () => {
        const { player, spell } = board(5, 0, 0);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 5, W: 1 },
            spell.id,
            0
        );
        expect(choice?.zone).toBe("hand");
        expect(choice?.color).toBe("W");
        expect(choice?.offsetGeneric).toEqual({ min: 0, max: 3, perCard: 2 });
    });

    it("forces ceil(shortfall / 2) exiles", () => {
        const { player, spell } = board(5, 0, 0);
        const choice = buildDelveExileChoice(
            player,
            spell,
            { X: 4, W: 1 },
            spell.id,
            3
        );
        expect(choice?.offsetGeneric?.min).toBe(2);
    });

    it("collapses a forced pick: every white card is exiled and each pays {2}", () => {
        const { player, spell } = board(2, 1, 0);
        const manaCost: Record<string, number> = { X: 4, W: 1 };
        const choice = buildDelveExileChoice(
            player,
            spell,
            manaCost,
            spell.id,
            4
        );
        expect(choice?.offsetGeneric).toMatchObject({ min: 2, max: 2 });
        collapseForcedDelvePick(player, spell.id, choice, manaCost);
        expect(choice?.pickedCardIds).toEqual(["w0", "w1"]);
        expect(manaCost.X).toBe(0);
    });

    it("offers no picker without white cards or without generic cost", () => {
        const a = board(0, 3, 0);
        expect(
            buildDelveExileChoice(a.player, a.spell, { X: 4, W: 1 }, "march", 0)
        ).toBeUndefined();
        const b = board(3, 0, 0);
        expect(
            buildDelveExileChoice(b.player, b.spell, { X: 0, W: 1 }, "march", 0)
        ).toBeUndefined();
    });
});

describe("recordCastExileCostPick + commit (CR 601.2f)", () => {
    function parked(white: number, lands: number, x: number) {
        const { state, player, spell } = board(white, 1, lands);
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: spell.id,
            targetType: "any",
            count: 1,
            selected: [{ type: "permanent", id: "victim" }] as never,
            chosenX: x,
        };
        state.pendingTarget = pt;
        finalizeTargetSelection(state, pt, "p1");
        return { state, player };
    }

    it("parks a hand picker on X=4 with 3 white cards, then each pick pays {2}", () => {
        const { state, player } = parked(3, 1, 4);
        const pc = state.pendingCast!;
        expect(pc.exileFromGraveyardChoice?.zone).toBe("hand");
        expect(pc.exileFromGraveyardChoice?.offsetGeneric?.perCard).toBe(2);
        // Real mana is {W}: one Plains' worth is owed after both exiles.
        recordCastExileCostPick(state, "p1", ["w0", "w1"]);
        expect(pc.manaCost.X).toBe(0);
        expect(pc.manaCost.W).toBe(1);
        // Nothing left the hand until commit.
        expect(player.hand.map((c) => c.id)).toContain("w0");
    });

    it("rejects a non-white card and a card outside the hand", () => {
        const { state } = parked(2, 4, 4);
        expect(() => recordCastExileCostPick(state, "p1", ["b0"])).toThrow(
            /filter/
        );
        expect(() => recordCastExileCostPick(state, "p1", ["nope"])).toThrow(
            /not in your hand/
        );
    });

    it("commits: the picked white cards go hand → exile, X stays announced", () => {
        const { state, player } = parked(2, 4, 4);
        recordCastExileCostPick(state, "p1", ["w0", "w1"]);
        player.manaPool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        tryAutoCommitPendingCast(state, "p1");
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].chosenX).toBe(4);
        expect(player.exile.map((c) => c.id).sort()).toEqual(["w0", "w1"]);
        expect(player.hand.map((c) => c.id)).not.toContain("w0");
        expect(player.hand.map((c) => c.id)).not.toContain("march");
    });
});

describe("castability + wire format", () => {
    it("white hand cards make the cast payable: Grizzly Bears (MV 2) needs X=2", () => {
        // One Plains alone affords X=0, so no legal target (MV 2 > 0): hidden.
        const bare = board(0, 0, 1);
        expect(
            getLegalActions(bare.state, bare.player, bare.spell)
        ).not.toContain("cast");
        // ONE white card in hand pays {2}: X=2 is reachable, so it is shown
        // on the wire exactly as the client reads it.
        const fueled = board(1, 0, 1);
        const me = projectPublicState(fueled.state, 1, "p1").players.find(
            (p) => p.id === "p1"
        )!;
        expect(me.hand[0]!.legalActions).toContain("cast");
    });

    it("the hand picker crosses projectPublicState with zone, colour and perCard", () => {
        const { state } = board(2, 0, 1);
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "march",
            manaCost: { X: 4, W: 1 },
            tappedLandIds: [],
            exileFromGraveyardChoice: {
                count: 0,
                excludeInstanceId: "march",
                zone: "hand",
                color: "W",
                offsetGeneric: { min: 0, max: 2, perCard: 2 },
            },
        };
        const ec = projectPublicState(state, 1, "p1").pendingCast
            ?.exileFromGraveyardChoice;
        expect(ec?.zone).toBe("hand");
        expect(ec?.color).toBe("W");
        expect(ec?.offsetGeneric).toEqual({ min: 0, max: 2, perCard: 2 });
    });
});
