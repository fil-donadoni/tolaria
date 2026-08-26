// LCI blue — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { malcolmAlluringScoundrel, tishanasTidebinder } from "../blue";
import { registerTokenDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    removePermanentTo,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { finalizeCleanup } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import { collectTriggers } from "../../../../gre/triggers";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import {
    finalizeTargetSelection,
    applyOneTargetSelection,
} from "../../../../game";
import { compactState, expandState } from "../../../../gre/serialize";
import type { GameEvent } from "../../../types";

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

// Synthetic ACTIVATED-ability creature fixture (Stifle-parity half A) — a
// vanilla body with ONE non-mana activated ability plus a keyword, so the
// rider's strip (CR 613.1f) has something visible to remove.
const ACTIVATED_SOURCE_ID = "test-lci-blue-tidebinder-activated-source";
registerTokenDefinition({
    id: ACTIVATED_SOURCE_ID,
    name: ACTIVATED_SOURCE_ID,
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    staticAbilities: ["vigilance"],
    activatedAbilities: [
        {
            id: "test-activated-draw",
            oracleText: "{1}: Draw a card.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

// Synthetic NON-artifact/creature/planeswalker fixture (the type-gate
// NEGATIVE case) — an Enchantment with a non-mana activated ability. CR
// 613.1f's rider text ("If an ability of an ARTIFACT, CREATURE, or
// PLANESWALKER is countered this way ...") deliberately excludes it: the
// ability is still counterable, but the rider must not fire.
const ENCHANTMENT_SOURCE_ID = "test-lci-blue-tidebinder-enchantment-source";
registerTokenDefinition({
    id: ENCHANTMENT_SOURCE_ID,
    name: ENCHANTMENT_SOURCE_ID,
    rarity: "common",
    types: ["Enchantment"],
    staticAbilities: ["hexproof"],
    activatedAbilities: [
        {
            id: "test-enchantment-draw",
            oracleText: "{1}: Draw a card.",
            cost: { mana: { X: 1 } },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
});

/** Pushes an activated-ability stack item WITHOUT resolving it, leaving it
 *  on the stack as a legal `spellStackKind: "ability"` target — mirrors
 *  `bro/__tests__/white.test.ts`'s `resolveActivated` minus the resolve
 *  call. */
function pushActivatedAbility(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): StackItem {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    };
    state.stack.push(item);
    return item;
}

/** Pushes Malcolm's own combat-damage trigger onto the stack WITHOUT
 *  resolving it, through the REAL `collectTriggers` pipeline (`gre/triggers.ts`
 *  `buildTriggerItem`) rather than a hand-built `StackItem` literal — a
 *  2026-08 review round on #1562 proved the hand-built shape hid a real bug:
 *  it reused Malcolm's OWN battlefield id for the stack item's `id` (via
 *  `{ ...source, ... }`), which is what an ACTIVATED ability's stack item
 *  does (`buildActivatedAbilityStackItem` clones the source), but NOT what a
 *  TRIGGERED ability's stack item does — `buildTriggerItem` stamps a FRESH
 *  `id` (`allocInstanceId`) and records the real permanent separately as
 *  `triggerSourceId`. The hand-built fixture's accidental id-reuse is
 *  exactly why "counters a target TRIGGERED ability" passed while
 *  `loseAllAbilitiesWhileSourceRemains` silently no-op'd for every real
 *  triggered ability (proof-of-failure shape 3 — the test never reached the
 *  real id-allocation code). Leaves it as a legal `spellStackKind: "ability"`
 *  target for Tidebinder's counter. */
function pushMalcolmTrigger(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const built = collectTriggers(state, [
        {
            type: "DAMAGE_DEALT",
            sourceInstanceId: source.id,
            sourceControllerId: source.controllerId,
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as GameEvent,
    ]);
    expect(built).toHaveLength(1);
    const [item] = built;
    // The fresh-id premise this whole fixup exists to prove: NOT Malcolm's
    // own battlefield id.
    expect(item!.id).not.toBe(source.id);
    expect(item!.triggerSourceId).toBe(source.id);
    state.stack.push(item!);
    return item!;
}

/** Puts Tidebinder's ETB trigger on the stack with an UN-set target slot
 *  (mirrors `bro/__tests__/white.test.ts`'s `loranEtbTriggerOnStack`),
 *  ABOVE whatever ability is already on the stack. */
function tidebinderEtbTriggerOnStack(
    state: GameState,
    source: CardInstanceState
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "trig-tidebinder-etb",
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "tishanas-tidebinder-etb",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: source.types,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trig);
    return trig;
}

/** Drives the CR 603.3d "up to one" target choice through the real
 *  machinery. A CHOSEN target (`abilityStackItemId` non-null) goes through
 *  `applyOneTargetSelection` — the `selectTarget` mutation's own accepted-set
 *  body (`game.ts`) — because THAT is the real production site that computes
 *  `TargetSelection.stackSourceId` (issue #1562 fixup) from the found stack
 *  item's `triggerSourceId ?? id`; hand-setting `pendingTarget.selected`
 *  directly (the pre-existing Loran precedent, still used for the "decline"
 *  branch below, which has no target to resolve) would skip that
 *  computation and silently defeat the rider's own regression coverage. The
 *  DECLINE branch (`null`) has no found stack item to compute anything from,
 *  so it stays the direct set + `finalizeTargetSelection` shape. */
function chooseTidebinderTarget(
    state: GameState,
    abilityStackItemId: string | null
) {
    const raised = raiseTriggerTargetSelection(state);
    expect(raised).toBe(true);
    if (abilityStackItemId === null) {
        state.pendingTarget!.selected = [];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        return;
    }
    applyOneTargetSelection(state, state.pendingTarget!.playerId, {
        targetType: "spell",
        targetId: abilityStackItemId,
    });
}

describe("Tishana's Tidebinder (CR 613.1f layer 6, CR 611.2b duration, CR 603.3d ETB-targeted trigger, issue #1562)", () => {
    it("counters a target ACTIVATED ability (Stifle-parity, CR 701.6a/113.7a) and strips the source creature's abilities while Tidebinder remains", () => {
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushActivatedAbility(state, bear, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinder);
        chooseTidebinderTarget(state, "bear");
        expect(resolveTopOfStack(state)).not.toBeNull();

        // The activated ability vanished (CR 701.6a) — nothing left to
        // resolve, and no card drawn from it.
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p2").hand).toHaveLength(0);

        // The rider fired: the bear (a Creature) lost vigilance.
        const strippedBear = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(strippedBear.staticAbilities).not.toContain("vigilance");
        expect(strippedBear.abilitiesSuppressedBy).toEqual([
            expect.objectContaining({ sourceId: "tidebinder" }),
        ]);

        // Tidebinder leaves the battlefield — CR 611.2b's duration ends and
        // the bear REGAINS its ability with no bespoke teardown code.
        removePermanentTo(state, "tidebinder", "graveyard");
        const restoredBear = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(restoredBear.staticAbilities).toContain("vigilance");
        expect(restoredBear.abilitiesSuppressedBy).toBeUndefined();
    });

    it("counters a target TRIGGERED ability (Stifle-parity, CR 701.6a/113.7a)", () => {
        const malcolm = makeInstance(malcolmAlluringScoundrel.id, {
            id: "malcolm-t",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", { battlefield: [malcolm] }),
            ],
        });
        const malcolmTrigger = pushMalcolmTrigger(state, malcolm);
        tidebinderEtbTriggerOnStack(state, tidebinder);
        // The countered slot is the TRIGGER's own (fresh) stack-item id —
        // NOT Malcolm's battlefield id ("malcolm-t") — precisely the shape
        // this fixup makes the rider resolve correctly through
        // `stackSourceId` instead of.
        expect(malcolmTrigger.id).not.toBe("malcolm-t");
        chooseTidebinderTarget(state, malcolmTrigger.id);
        expect(resolveTopOfStack(state)).not.toBeNull();

        // The triggered ability vanished — no chorus counter, no draw/
        // discard ever happened.
        expect(state.stack).toHaveLength(0);
        const strippedMalcolm = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "malcolm-t"
        )!;
        expect(strippedMalcolm.counters?.chorus ?? 0).toBe(0);
        expect(getPlayer(state, "p2").hand).toHaveLength(0);

        // The rider fired: Malcolm (a Creature) lost flash and flying too.
        expect(strippedMalcolm.staticAbilities).not.toContain("flying");
        expect(strippedMalcolm.staticAbilities).not.toContain("flash");
    });

    it("does NOT strip abilities when the countered ability's source is not an artifact/creature/planeswalker (CR 613.1f's type restriction)", () => {
        const ench = makeInstance(ENCHANTMENT_SOURCE_ID, {
            id: "ench",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder3",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", { battlefield: [ench] }),
            ],
        });
        pushActivatedAbility(state, ench, "test-enchantment-draw");
        tidebinderEtbTriggerOnStack(state, tidebinder);
        chooseTidebinderTarget(state, "ench");
        expect(resolveTopOfStack(state)).not.toBeNull();

        // Countered (the ability half is unconditional)...
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p2").hand).toHaveLength(0);
        // ...but the rider did NOT fire: the enchantment keeps hexproof.
        const untouchedEnch = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "ench"
        )!;
        expect(untouchedEnch.staticAbilities).toContain("hexproof");
        expect(untouchedEnch.abilitiesSuppressedBy).toBeUndefined();
    });

    it("'up to one target' — declining leaves the ability uncountered and grants no rider (CR 608.2b)", () => {
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const libTop = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "lib-decline",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder4",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", {
                    battlefield: [bear],
                    library: [libTop],
                }),
            ],
        });
        pushActivatedAbility(state, bear, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinder);
        chooseTidebinderTarget(state, null);
        // Tidebinder's own trigger resolves first (it's on top); nothing
        // countered.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.stack).toHaveLength(1); // the bear's ability remains
        // Resolve the bear's (un-countered) ability: it still draws.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(getPlayer(state, "p2").hand.map((c) => c.id)).toEqual([
            "lib-decline",
        ]);
        const untouchedBear = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear2"
        )!;
        expect(untouchedBear.staticAbilities).toContain("vigilance");
    });

    it("the stripped permanent's lost abilities survive projectPublicState (wire format, mandatory for a visible continuous effect)", () => {
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear-wire",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder-wire",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushActivatedAbility(state, bear, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinder);
        chooseTidebinderTarget(state, "bear-wire");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const projectedBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear-wire"
        )!;
        expect(projectedBear.staticAbilities).not.toContain("vigilance");
    });

    it("survives a save/reload cycle (compactState/expandState) — the hold and its restore both work off the reloaded state", () => {
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear-save",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinder = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder-save",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinder] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushActivatedAbility(state, bear, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinder);
        chooseTidebinderTarget(state, "bear-save");
        resolveTopOfStack(state);

        const reloaded = expandState(compactState(state));
        const reloadedBear = getPlayer(reloaded, "p2").battlefield.find(
            (c) => c.id === "bear-save"
        )!;
        expect(reloadedBear.staticAbilities).not.toContain("vigilance");
        expect(reloadedBear.abilitiesSuppressedBy).toEqual([
            expect.objectContaining({ sourceId: "tidebinder-save" }),
        ]);

        // The restore path still works off the RELOADED state too — proves
        // the hold's `sourceId` survived the round trip as a plain string,
        // not something the reload silently detached from its target.
        removePermanentTo(reloaded, "tidebinder-save", "graveyard");
        const restoredBear = getPlayer(reloaded, "p2").battlefield.find(
            (c) => c.id === "bear-save"
        )!;
        expect(restoredBear.staticAbilities).toContain("vigilance");
    });

    it("two Tidebinders stripping the SAME permanent compose correctly (CR 613.7) — the FIRST to leave must NOT restore a keyword while the SECOND's hold is still live", () => {
        const bear = makeInstance(ACTIVATED_SOURCE_ID, {
            id: "bear-multi",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const tidebinderA = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder-a",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const tidebinderB = makeInstance(tishanasTidebinder.id, {
            id: "tidebinder-b",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tidebinderA, tidebinderB] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        // Tidebinder A counters an activated ability off the bear and strips it.
        pushActivatedAbility(state, bear, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinderA);
        chooseTidebinderTarget(state, "bear-multi");
        resolveTopOfStack(state);
        const afterA = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear-multi"
        )!;
        expect(afterA.staticAbilities).not.toContain("vigilance");
        expect(afterA.abilitiesSuppressedBy).toEqual([
            expect.objectContaining({ sourceId: "tidebinder-a" }),
        ]);

        // Tidebinder B counters a SECOND activated ability off the SAME bear.
        // `staticAbilities` is already empty (A already stripped it), so B's
        // own `applyAbilityLossHold` call records NO `removedKeywords` entry
        // of its own — the bug this test guards is exactly that B's hold
        // must still be load-bearing despite owning no keyword entries.
        pushActivatedAbility(state, afterA, "test-activated-draw");
        tidebinderEtbTriggerOnStack(state, tidebinderB);
        chooseTidebinderTarget(state, "bear-multi");
        resolveTopOfStack(state);
        const afterB = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear-multi"
        )!;
        expect(
            afterB.abilitiesSuppressedBy?.map((s) => s.sourceId).sort()
        ).toEqual(["tidebinder-a", "tidebinder-b"]);
        expect(afterB.staticAbilities).not.toContain("vigilance");

        // Tidebinder A leaves FIRST — Tidebinder B's hold is STILL LIVE, so
        // vigilance must NOT come back yet (CR 613.7: two independent
        // one-shot "loses all abilities" holds on the same target).
        removePermanentTo(state, "tidebinder-a", "graveyard");
        const afterALeaves = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear-multi"
        )!;
        expect(afterALeaves.staticAbilities).not.toContain("vigilance");
        expect(
            afterALeaves.abilitiesSuppressedBy?.map((s) => s.sourceId)
        ).toEqual(["tidebinder-b"]);

        // Tidebinder B leaves LAST — now, and only now, the bear regains
        // vigilance.
        removePermanentTo(state, "tidebinder-b", "graveyard");
        const afterBLeaves = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear-multi"
        )!;
        expect(afterBLeaves.staticAbilities).toContain("vigilance");
        expect(afterBLeaves.abilitiesSuppressedBy).toBeUndefined();
    });
});
