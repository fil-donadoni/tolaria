// issue #3000 — a spell cast by a player who does NOT own the card.
//
// CR 112.2: "a spell's controller is, by default, the player who put it on the
// stack." CR 110.2: "a permanent's controller is, by default, the player under
// whose control it entered the battlefield", and CR 110.2b says that for a
// permanent spell the default controller is "the player who put that spell onto
// the stack" — the CASTER, whoever owns the card.
//
// The bug this file pins: `controllerId` is inherited from the card object in
// its previous zone, so before the fix a cross-player cast (a void-counter
// exile grant, "exile the top card of an opponent's library, you may play it",
// Word of Command's controlled cast) produced a state that was internally
// INCONSISTENT — the permanent sat in the caster's battlefield array while its
// `controllerId` field still named the owner. Every downstream consumer reads
// that field: the ETB trigger's controller, the layer-2 base, the layer-system
// `applies` predicates, attack/block legality, the client projection. Observed
// as a "draw a card, then discard a card" ETB making the OWNER loot while the
// creature stood on the CASTER's side.
//
// Ownership is deliberately untouched throughout (CR 400.3): the card is still
// owned by its owner and still goes to its OWNER's graveyard.
//
// The full-path (`game.ts` mutations → projected client view) half of this
// coverage is `convex/__tests__/nonOwnerCastControllerPath.test.ts`.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { getEffectiveToughness } from "../layers";
import { syncLayers2to5 } from "../layers2to5";
import { removeContinuousEffect } from "../continuousEffects";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { applyPlayLandFromExile } from "../playLand";
import { vodalianMerchant } from "../../cards/sets/inv/blue";
import { castle } from "../../cards/sets/lea/white";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { mountain } from "../../cards/sets/lea/colorless";

/** The card p2 is allowed to cast out of p1's exile: p1 owns it, p1 controls it
 *  while it sits in the exile zone, and the grant names p2 (the shape every
 *  cast-from-another-player's-zone permission leaves behind — Dauthi
 *  Voidwalker's void counter is the canonical one). */
function grantedToOpponent(cardId: string, instanceId: string) {
    return makeInstance(cardId, {
        id: instanceId,
        ownerId: "p1",
        controllerId: "p1",
        zone: "exile",
        castableFromExileBy: "p2",
        castFromExileWithoutPayingManaCost: true,
    });
}

/** The cast COMMIT, in the exact shape every production cast site writes it
 *  (`finalizePendingCast` / `castSpell` in `game.ts`, `applyMove` and `search`
 *  for the Bot): `removeFromZone` moves the card out of the ZONE OWNER's zone
 *  onto the stack with the CASTER named, then the stack item spreads the moved
 *  card and stamps `castById`. */
function commitCast(
    state: GameState,
    instanceId: string,
    zoneOwnerId: string,
    casterId: string
): StackItem {
    const card = removeFromZone(
        state,
        getPlayer(state, zoneOwnerId),
        instanceId,
        "exile",
        casterId
    );
    const item: StackItem = { ...card, castById: casterId };
    state.stack.push(item);
    return item;
}

describe("a permanent spell cast by a non-owner (CR 110.2 / 110.2b / 112.2)", () => {
    function position() {
        const merchant = grantedToOpponent(vodalianMerchant.id, "merch");
        // Both players hold a card and have one in the library, so "who draws"
        // and "who discards" are answerable from the zone contents alone.
        return makeState({
            players: [
                makePlayer("p1", {
                    exile: [merchant],
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "p1-hand",
                            ownerId: "p1",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p1-lib",
                            ownerId: "p1",
                            controllerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2-hand",
                            ownerId: "p2",
                            controllerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2-lib",
                            ownerId: "p2",
                            controllerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
        });
    }

    it("CR 112.2 — reports the CASTER as its controller while on the stack", () => {
        const state = position();
        const item = commitCast(state, "merch", "p1", "p2");

        expect(item.castById).toBe("p2");
        // The two fields must not disagree about the same fact.
        expect(item.controllerId).toBe("p2");
        expect(state.stack[0].controllerId).toBe("p2");
        // CR 112.2 — ownership is untouched by the cast.
        expect(item.ownerId).toBe("p1");
    });

    it("CR 110.2 — enters the battlefield under the CASTER's control, in the caster's zone", () => {
        const state = position();
        commitCast(state, "merch", "p1", "p2");
        resolveTopOfStack(state);

        const entered = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "merch"
        );
        expect(entered).toBeDefined();
        // Field and zone agree — the invariant the bug broke.
        expect(entered!.controllerId).toBe("p2");
        expect(entered!.ownerId).toBe("p1");
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "merch")
        ).toBe(false);
    });

    it("CR 603.6a — its enters-the-battlefield trigger loots the CASTER, not the owner", () => {
        const state = position();
        commitCast(state, "merch", "p1", "p2");
        // 1. the spell resolves, the permanent enters, the ETB goes on the
        //    stack (triggers never auto-resolve).
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe("p2");
        // 2. the trigger resolves: "draw a card, then discard a card".
        resolveTopOfStack(state);

        // The DRAW went to the caster.
        expect(
            getPlayer(state, "p2")
                .hand.map((c) => c.id)
                .sort()
        ).toEqual(["p2-hand", "p2-lib"]);
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toEqual([
            "p1-hand",
        ]);
        expect(getPlayer(state, "p1").library).toHaveLength(1);

        // …and so is the discard CHOICE (CR 701.9a — the discarding player
        // chooses), addressed to the caster and offering only their own hand.
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2-lib"],
        });
        expect(getPlayer(state, "p2").hand.map((c) => c.id)).toEqual([
            "p2-hand",
        ]);
        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).toEqual([
            "p2-lib",
        ]);
    });

    it("CR 613.1b — 'creatures you control' predicates count it for the CASTER only", () => {
        const state = position();
        // One Castle each: "Untapped creatures you control get +0/+2." The
        // predicate reads `target.controllerId === source.controllerId`, so it
        // is a real layer-system answer to "does the caster control this?".
        getPlayer(state, "p2").battlefield.push(
            makeInstance(castle.id, {
                id: "castle-caster",
                ownerId: "p2",
                controllerId: "p2",
            })
        );
        commitCast(state, "merch", "p1", "p2");
        resolveTopOfStack(state);

        const entered = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "merch"
        )!;
        // Printed 1/2, +0/+2 from the CASTER's Castle.
        expect(getEffectiveToughness(state, entered)).toBe(4);

        // The OWNER's Castle does not see it at all: adding one changes nothing.
        getPlayer(state, "p1").battlefield.push(
            makeInstance(castle.id, {
                id: "castle-owner",
                ownerId: "p1",
                controllerId: "p1",
            })
        );
        expect(getEffectiveToughness(state, entered)).toBe(4);
    });

    // A NON-REGRESSION guard, not a new pin: zone-return has always routed by
    // `ownerId` (`sendStackItemToGraveyard` / `graveyardDestinationFor`), and
    // the acceptance criterion is that the controller stamp did not disturb it.
    it("CR 400.3 — leaving the battlefield, the card still goes to its OWNER's graveyard", () => {
        const state = position();
        commitCast(state, "merch", "p1", "p2");
        resolveTopOfStack(state);
        removePermanentTo(state, "merch", "graveyard", "destroy");

        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            "merch"
        );
        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).not.toContain(
            "merch"
        );
    });

    it("CR 613.1b layer 2 — a control change that ENDS restores control to the CASTER, not the owner", () => {
        const state = position();
        commitCast(state, "merch", "p1", "p2");
        resolveTopOfStack(state);

        // The owner steals their own card back until end of turn (Ray of
        // Command's shape): a layer-2 control-change entry over the instance.
        state.continuousEffects = [
            ...(state.continuousEffects ?? []),
            {
                id: "ce-steal-back",
                layer: 2,
                timestamp: 10_000,
                expiry: {
                    kind: "duration",
                    duration: { phase: "end-of-turn" },
                    controllerId: "p1",
                },
                affected: { kind: "instances", instanceIds: ["merch"] },
                payload: { kind: "control-change", controllerId: "p1" },
                characteristicDefining: false,
            },
        ];
        syncLayers2to5(state);
        expect(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "merch")
                ?.controllerId
        ).toBe("p1");

        // The effect ends. The baseline it unwinds to is the CASTER (CR 108.3
        // "the player who put it onto the battlefield"), never the owner.
        removeContinuousEffect(state, "ce-steal-back");
        syncLayers2to5(state);
        const restored = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "merch"
        );
        expect(restored?.controllerId).toBe("p2");
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "merch")
        ).toBe(false);
    });

    it("a normal cast (owner === caster) is unaffected", () => {
        const own = makeInstance(vodalianMerchant.id, {
            id: "own-merch",
            ownerId: "p1",
            controllerId: "p1",
            zone: "exile",
            castableFromExileBy: "p1",
            castFromExileWithoutPayingManaCost: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [own],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p1-lib",
                            ownerId: "p1",
                            controllerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = commitCast(state, "own-merch", "p1", "p1");
        expect(item.controllerId).toBe("p1");
        resolveTopOfStack(state);

        const entered = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "own-merch"
        );
        expect(entered?.controllerId).toBe("p1");
        expect(entered?.ownerId).toBe("p1");
        // The ETB still loots its own controller.
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toEqual([
            "p1-lib",
        ]);
        expect(state.pendingChoices![0].playerId).toBe("p1");
    });
});

// The in-class sibling found while walking this seam: a LAND is not cast (CR
// 305.1 — playing a land uses no stack and is not a spell), so it never passes
// through `removeFromZone` or `finalizeSpellResolution`. Its own cross-player
// entry helper (`moveCardAcrossPlayers`, `gre/playLand.ts` — which exists ONLY
// for this case) inherited `controllerId` exactly the same way, and Dauthi
// Voidwalker's land grant reaches it today.
describe("a LAND played from another player's exile (CR 110.2 / 110.2a / 305.1)", () => {
    function position() {
        return makeState({
            players: [
                makePlayer("p1", {
                    exile: [
                        makeInstance(mountain.id, {
                            id: "granted-land",
                            ownerId: "p1",
                            controllerId: "p1",
                            zone: "exile",
                            castableFromExileBy: "p2",
                            castFromExileWithoutPayingManaCost: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("enters under the PLAYER's control, in their zone, still owned by the owner", () => {
        const state = position();
        const played = applyPlayLandFromExile(
            state,
            getPlayer(state, "p2"),
            "granted-land"
        );

        expect(played).not.toBeNull();
        expect(
            getPlayer(state, "p1").exile.some((c) => c.id === "granted-land")
        ).toBe(false);
        const entered = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "granted-land"
        );
        expect(entered).toBeDefined();
        expect(entered!.controllerId).toBe("p2");
        expect(entered!.ownerId).toBe("p1");
        // CR 305.2 — the land drop is the PLAYER's.
        expect(getPlayer(state, "p2").landsPlayedThisTurn).toBe(1);
        expect(getPlayer(state, "p1").landsPlayedThisTurn ?? 0).toBe(0);
    });

    it("CR 400.3 — still goes to its OWNER's graveyard when it leaves", () => {
        const state = position();
        applyPlayLandFromExile(state, getPlayer(state, "p2"), "granted-land");
        removePermanentTo(state, "granted-land", "graveyard", "destroy");

        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            "granted-land"
        );
        expect(getPlayer(state, "p2").graveyard.map((c) => c.id)).not.toContain(
            "granted-land"
        );
    });
});
