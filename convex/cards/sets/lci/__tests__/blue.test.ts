// LCI blue — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { malcolmAlluringScoundrel } from "../blue";
import { registerTokenDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    removeFromZone,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { finalizeCleanup } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import {
    castRawManaCost,
    locateCastSource,
    castZoneOwner,
} from "../../../../game";

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

describe("Malcolm, Alluring Scoundrel (CR 603.2 combat-damage trigger, CR 122.1/122.6 counters, CR 601.3e / 117.6-analog issue #1344 free graveyard cast)", () => {
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

    it("grants a free cast of the discarded card once the count reaches four (threshold gate) — wire format survives projection", () => {
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
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["hand3"],
        });

        const onBattlefield = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "malcolm3"
        )!;
        expect(onBattlefield.counters?.chorus).toBe(4);
        const discarded = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "hand3"
        )!;
        expect(discarded.castableFromGraveyardBy).toBe("p1");
        expect(discarded.castableFromGraveyardUntilTurn).toBe(state.turn);
        expect(discarded.castFromGraveyardWithoutPayingManaCost).toBe(true);

        // MANDATORY wire format (new-Op regime) — the grant's `legalActions`
        // + `castKind` survive `projectPublicState` for the caster's own
        // view; the opponent's view of the SAME game carries no grant on
        // their side (there's nothing to leak — the card sits in the
        // caster's own graveyard, invisible to the opponent's affordance
        // computation entirely since `isOwnGraveyard` gates it).
        const projected = projectPublicState(state, 1, "p1");
        const projGraveyardCard = projected.players[0].graveyard.find(
            (c) => c.id === "hand3"
        )!;
        expect(projGraveyardCard.legalActions).toContain("cast");
        expect(projGraveyardCard.castKind).toBe("graveyard-grant");
    });

    it("a discarded LAND is never granted a cast (CR ruling: 'You may not play land cards discarded with Malcolm's last ability')", () => {
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
        // Only the land is a legal discard target when the drawn card is
        // also present — force the land pick explicitly.
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["land4"],
        });

        const discardedLand = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "land4"
        )!;
        expect(discardedLand).toBeDefined();
        // The primitive itself refuses a land (CR 116.2a) — no grant at all.
        expect(discardedLand.castableFromGraveyardBy).toBeUndefined();

        const projected = projectPublicState(state, 1, "p1");
        const projLand = projected.players[0].graveyard.find(
            (c) => c.id === "land4"
        )!;
        expect(projLand.legalActions).toBeUndefined();
    });

    it("casts the granted card FROM THE GRAVEYARD for free — the real cast-commit seam (locateCastSource / castRawManaCost / castZoneOwner)", () => {
        const grantedCard = makeInstance(FILLER_ID, {
            id: "castSeamGY",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            castableFromGraveyardBy: "p1",
            castFromGraveyardWithoutPayingManaCost: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [grantedCard] }),
                makePlayer("p2"),
            ],
        });

        const caster = getPlayer(state, "p1");
        const src = locateCastSource(state, caster, "castSeamGY");
        expect(src.zone).toBe("graveyard");
        expect(src.card?.id).toBe("castSeamGY");
        // CR 601.3e / 117.6-analog — the free-cast waiver zeroes the cost
        // entirely, even though the caster's pool is empty.
        expect(castRawManaCost(state, src.card!, src.zone)).toEqual({});

        // Same-player commit — `castZoneOwner` is a no-op identity for a
        // graveyard cast (no cross-player shape exists). `removeFromZone` is
        // the REAL production removal path (`announceCast`, `convex/game.ts`)
        // — it also consumes the per-card grant flags, mirroring the real
        // cast-commit exactly (a raw splice would silently skip that
        // cleanup).
        const owner = castZoneOwner(state, caster, "castSeamGY", src.zone);
        expect(owner.id).toBe("p1");
        const removed = removeFromZone(owner, "castSeamGY", "graveyard");
        const stackItem: StackItem = {
            ...removed,
            castById: "p1",
            targets: [],
        };
        state.stack.push(stackItem);
        resolveTopOfStack(state);

        // A plain creature resolves onto the caster's battlefield.
        expect(
            getPlayer(state, "p1").battlefield.some(
                (c) => c.id === "castSeamGY"
            )
        ).toBe(true);
        // The per-card grant flags are consumed on entry (`removeFromZone`).
        const entered = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "castSeamGY"
        )!;
        expect(entered.castableFromGraveyardBy).toBeUndefined();
        expect(entered.castFromGraveyardWithoutPayingManaCost).toBeUndefined();
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
