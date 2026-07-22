// LCI blue — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { malcolmAlluringScoundrel } from "../blue";
import { registerTokenDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { finalizeCleanup } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";

// A plain vanilla creature card for hand/library fixtures, distinct from
// Malcolm itself.
const FILLER_ID = "test-lci-blue-filler-creature";
registerTokenDefinition({
    id: FILLER_ID,
    name: FILLER_ID,
    rarity: "common",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

// A plain basic-land-shaped card for the "discarded land" fixture (CR ruling:
// "You may not play land cards discarded with Malcolm's last ability").
const FILLER_LAND_ID = "test-lci-blue-filler-land";
registerTokenDefinition({
    id: FILLER_LAND_ID,
    name: FILLER_LAND_ID,
    rarity: "common",
    types: ["Land"],
});

/** Pushes Malcolm's combat-damage trigger onto the stack with a synthetic
 *  DAMAGE_DEALT event and resolves it (mirrors the Barrowgoyf
 *  `fireCombatDamage` pattern, m3c/__tests__/black.test.ts). */
function fireCombatDamage(
    state: GameState,
    source: CardInstanceState,
    targetPlayerId: string,
    amount: number
): StackItem | null {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "malcolm-chorus",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "DAMAGE_DEALT",
            sourceInstanceId: source.id,
            sourceControllerId: source.controllerId,
            target: { type: "player", id: targetPlayerId },
            amount,
            isCombat: true,
        } as StackItem["triggerEvent"],
        targets: [],
    };
    state.stack.push(item);
    return resolveTopOfStack(state);
}

describe("Malcolm, Alluring Scoundrel (CR 603.2 combat-damage trigger, CR 122.1/122.6 counters, CR 608.2f cast-during-resolution issue #1477)", () => {
    it("is a {1}{U} 2/1 Legendary Siren Pirate with Flash and Flying", () => {
        expect(malcolmAlluringScoundrel.manaCost).toEqual({ X: 1, U: 1 });
        expect(malcolmAlluringScoundrel.types).toEqual(["Creature"]);
        expect(malcolmAlluringScoundrel.supertypes).toEqual(["Legendary"]);
        expect(malcolmAlluringScoundrel.subtypes).toEqual(["Siren", "Pirate"]);
        expect(malcolmAlluringScoundrel.power).toBe(2);
        expect(malcolmAlluringScoundrel.toughness).toBe(1);
        expect(malcolmAlluringScoundrel.staticAbilities).toEqual([
            "flash",
            "flying",
        ]);
    });

    it("puts a chorus counter on itself, draws a card, then discards the chosen card (below the 4-counter threshold: no free cast is granted)", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(FILLER_ID, {
            id: "hand1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const libTop = makeInstance(FILLER_ID, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [malcolm],
                    hand: [handCard],
                    library: [libTop],
                }),
                makePlayer("p2"),
            ],
        });
        expect(fireCombatDamage(state, malcolm, "p2", 2)).toBeNull(); // suspended on the discard choice

        // The chorus counter and the draw already happened (irreversible ops
        // ahead of the suspending `choice`).
        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "malcolm1"
        )!;
        expect(onBattlefield.counters?.chorus).toBe(1);
        expect(getPlayer(state, "p1").hand).toHaveLength(2); // handCard + drawn libTop

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hand1"],
        });

        expect(state.stack).toHaveLength(0);
        const afterHand = getPlayer(state, "p1").hand;
        expect(afterHand.map((c) => c.id)).toEqual(["lib1"]);
        const discarded = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "hand1"
        )!;
        expect(discarded).toBeDefined();
        // Only 1 chorus counter — well below the 4-counter threshold.
        expect(discarded.castableFromGraveyardBy).toBeUndefined();
        expect(
            discarded.castFromGraveyardWithoutPayingManaCost
        ).toBeUndefined();
    });

    it("still does NOT grant a free cast at exactly 3 chorus counters (one below the threshold)", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm2",
            controllerId: "p1",
            ownerId: "p1",
            counters: { chorus: 2 },
        });
        const handCard = makeInstance(FILLER_ID, {
            id: "hand2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [malcolm],
                    hand: [handCard],
                    library: [
                        makeInstance(FILLER_ID, {
                            id: "lib2",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireCombatDamage(state, malcolm, "p2", 3);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hand2"],
        });

        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "malcolm2"
        )!;
        expect(onBattlefield.counters?.chorus).toBe(3);
        const discarded = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "hand2"
        )!;
        expect(discarded.castableFromGraveyardBy).toBeUndefined();
    });

    it("at the 4-counter threshold, offers a free cast of the discarded card DURING the trigger's resolution and, on accept, casts it from the graveyard — Cast/Decline affordance survives projection", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm3",
            controllerId: "p1",
            ownerId: "p1",
            counters: { chorus: 3 },
        });
        const handCard = makeInstance(FILLER_ID, {
            id: "hand3",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [malcolm],
                    hand: [handCard],
                    library: [
                        makeInstance(FILLER_ID, {
                            id: "lib3",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireCombatDamage(state, malcolm, "p2", 4);

        // Discard the drawn/hand card (force the hand card explicitly).
        const discardHead = state.pendingChoices![0];
        expect(discardHead.kind).toBe("choose-hand-card");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: discardHead.stackItemId,
            step: discardHead.step,
            choiceId: discardHead.choiceId,
            cardInstanceIds: ["hand3"],
        });

        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "malcolm3"
        )!;
        expect(onBattlefield.counters?.chorus).toBe(4);

        // The trigger SUSPENDS AGAIN on the Cast/Decline offer (an option-pick
        // routed to Malcolm's controller — CR 608.2f: a resolution choice, NOT
        // priority; the opponent p2 is never the chooser here).
        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        expect(offer.playerId).toBe("p1");
        expect(offer.options?.map((o) => o.id)).toEqual(["cast", "decline"]);
        // The trigger is still on the stack, suspended (nothing has been
        // handed to the opponent).
        expect(state.stack).toHaveLength(1);

        // MANDATORY wire format (new-Op regime) — the Cast/Decline affordance
        // reaches the caster's client through `projectPublicState`
        // (`pendingChoices` carries the generic option-pick prompt).
        const projected = projectPublicState(state, 1, "p1");
        const projOffer = projected.pendingChoices?.[0];
        expect(projOffer?.kind).toBe("option-pick");
        expect(projOffer?.options?.map((o) => o.id)).toEqual([
            "cast",
            "decline",
        ]);

        // Accept — the discarded card is cast INLINE from the graveyard, put
        // on the stack (a real spell) as part of the trigger's own resolution,
        // no longer in the graveyard.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["cast"],
        });
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "hand3")
        ).toBe(false);
        const castSpell = state.stack.find((s) => s.id === "hand3");
        expect(castSpell).toBeDefined();
        expect(castSpell!.castById).toBe("p1");

        // A normal spell afterwards — resolving it puts the creature onto the
        // battlefield (free cast: no mana was paid from p1's empty pool).
        resolveTopOfStack(state);
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === "hand3")
        ).toBe(true);
    });

    it("a discarded LAND passes silently at the threshold — no Cast/Decline offer (CR ruling: 'You may not play land cards discarded with Malcolm's last ability')", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm4",
            controllerId: "p1",
            ownerId: "p1",
            counters: { chorus: 3 },
        });
        const landInHand = makeInstance(FILLER_LAND_ID, {
            id: "land4",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [malcolm],
                    hand: [landInHand],
                    library: [
                        makeInstance(FILLER_ID, {
                            id: "lib4",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireCombatDamage(state, malcolm, "p2", 4);
        const head = state.pendingChoices![0];
        // Force the land pick explicitly.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["land4"],
        });

        // No Cast/Decline offer — a land is played, not cast, so the Op passes
        // silently and the trigger finishes with nothing on the stack.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        const discardedLand = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "land4"
        )!;
        expect(discardedLand).toBeDefined();
        // Nothing was cast and no later-in-turn window was stamped.
        expect(discardedLand.castableFromGraveyardBy).toBeUndefined();
    });

    it("declining the offer at the threshold leaves the discarded card in the graveyard and grants NO later-in-turn cast (the impulse-window bug is gone, issue #1477)", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm5",
            controllerId: "p1",
            ownerId: "p1",
            counters: { chorus: 3 },
        });
        const handCard = makeInstance(FILLER_ID, {
            id: "hand5",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [malcolm],
                    hand: [handCard],
                    library: [
                        makeInstance(FILLER_ID, {
                            id: "lib5",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireCombatDamage(state, malcolm, "p2", 4);
        const discardHead = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: discardHead.stackItemId,
            step: discardHead.step,
            choiceId: discardHead.choiceId,
            cardInstanceIds: ["hand5"],
        });

        const offer = state.pendingChoices![0];
        expect(offer.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: offer.stackItemId,
            step: offer.step,
            choiceId: offer.choiceId,
            cardInstanceIds: ["decline"],
        });

        // The trigger finishes; nothing is cast. The discarded card sits in the
        // graveyard with NO cast permission — it cannot be cast later in the
        // turn (the old grantCastFromGraveyard "this-turn" impulse window, and
        // its CR-incorrect sorcery-speed-later-cast, are gone).
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        const declined = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "hand5"
        )!;
        expect(declined).toBeDefined();
        expect(declined.castableFromGraveyardBy).toBeUndefined();
        expect(declined.castFromGraveyardWithoutPayingManaCost).toBeUndefined();
        // Wire format: the caster's projected graveyard card exposes NO cast
        // affordance (there is no grant to leak).
        const projected = projectPublicState(state, 1, "p1");
        const projCard = projected.players[0].graveyard.find(
            (c) => c.id === "hand5"
        )!;
        expect(projCard.legalActions).toBeUndefined();
    });
});

/** Whole-class primitive behavior for the per-card graveyard-cast grant
 *  (`grantCastFromGraveyard`): turn-scoped expiry at CLEANUP, mirroring
 *  `grantCastFromExile`'s own expiry sweep (clu/red.test.ts's Headliner
 *  Scarlett coverage). Exercised directly against a synthetic grant rather
 *  than through Malcolm's trigger — a class-level fix, not Malcolm-specific
 *  (CR 514.2 / 608.2g, issue #1344). */
describe("graveyard-cast grant expiry (CR 514.2 / 608.2g, issue #1344)", () => {
    function graveyardWithGrant(opts: { untilTurn?: number } = {}) {
        const card = makeInstance(FILLER_ID, {
            id: "granted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            castableFromGraveyardBy: "p1",
            castFromGraveyardWithoutPayingManaCost: true,
            ...(opts.untilTurn !== undefined
                ? { castableFromGraveyardUntilTurn: opts.untilTurn }
                : {}),
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [card] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            turn: 1,
        });
        return { state, card };
    }

    it("a this-turn grant is revoked at CLEANUP while the card stays in the graveyard", () => {
        const { state, card } = graveyardWithGrant({ untilTurn: 1 });
        finalizeCleanup(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(card.castableFromGraveyardBy).toBeUndefined();
        expect(card.castableFromGraveyardUntilTurn).toBeUndefined();
        expect(card.castFromGraveyardWithoutPayingManaCost).toBeUndefined();
    });

    it("a persisted grant (no expiry marker) is unaffected by CLEANUP", () => {
        const { state, card } = graveyardWithGrant();
        finalizeCleanup(state);
        expect(card.castableFromGraveyardBy).toBe("p1");
        expect(card.castableFromGraveyardUntilTurn).toBeUndefined();
    });

    it("a future-turn grant survives THIS cleanup and expires at the later one", () => {
        const { state, card } = graveyardWithGrant({ untilTurn: 2 });
        finalizeCleanup(state);
        expect(card.castableFromGraveyardBy).toBe("p1");
        state.turn = 2;
        finalizeCleanup(state);
        expect(card.castableFromGraveyardBy).toBeUndefined();
    });
});
