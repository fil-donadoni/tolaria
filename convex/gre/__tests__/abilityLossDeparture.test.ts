// CR 400.7 (issue #8730) — a permanent that lost its abilities on the
// battlefield shows what it PRINTS in the zone it moves to, on all four
// destinations. The graveyard/exile branch of `removePermanentTo` keeps the
// instance's history as last known information, and used to keep the layer-6
// residue with it: an Elk-ified Chromatic Star sat in the graveyard with no
// abilities, an Elk-ified Serra Angel with no keywords.
//
// The trap beside it (CR 603.10a): a leaves-the-battlefield trigger looks back
// at the permanent as it last existed, so a Chromatic Star that dies as an Elk
// had no abilities and must NOT draw. That used to hold only because the
// suppression leaked; `abilitiesAtLeave` is now what the look-back reads.

import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    processPendingActionTriggers,
    recomputeContinuousEffects,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { resolveActivatedAbility } from "../activation";
import { seasonedPyromancer } from "../../cards/sets/mh1/red.cards";
import { goblinShrine } from "../../cards/sets/drk/red.cards";
import { effectiveTriggeredAbilities, lookBackSelf } from "../copy";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import { activateAbilityOnState, applyOneTargetSelection } from "../../game";
import { getDefinition } from "../../cards";
import { titaniasSong } from "../../cards/sets/atq/green.cards";
import { astrologiansPlanisphere } from "../../cards/sets/fin/blue.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const OKO = getDefinition("3462a3d0-5552-49fa-9eb7-100960c55891").id;
const STAR = getDefinition("1d7a1357-debd-49b0-9fd5-560d5b3f589e").id;
const SERRA = getDefinition("f8ac5006-91bd-4803-93da-f87cf196dd2f").id; // 4/4 flying, vigilance
const BEARS = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095").id; // vanilla 2/2
const PLUS1 = "oko-thief-of-crowns-plus1";
const STAR_DRAW = "chromatic-star-death-draw";

type Destination = "graveyard" | "exile" | "hand" | "library";
const DESTINATIONS: readonly Destination[] = [
    "graveyard",
    "exile",
    "hand",
    "library",
];

/** p1: Oko; p2: `victim` and a library card to draw. */
function okoBoard(victim: CardInstanceState): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(OKO, {
                        id: "oko1",
                        controllerId: "p1",
                        ownerId: "p1",
                        counters: { loyalty: 4 },
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [victim],
                library: [
                    makeInstance(BEARS, {
                        id: "lib0",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

/** Resolves Oko's `+1` on `targetId` (CR 611.2c — a one-shot arm keyed to
 *  the `"indefinite"` sentinel, the shape no source-keyed release reaches). */
function elkify(state: GameState, targetId: string): void {
    const oko = state.players[0].battlefield.find((c) => c.id === "oko1")!;
    state.stack.push({
        ...oko,
        zone: "stack",
        castById: "p1",
        abilityId: PLUS1,
        targets: [{ type: "permanent", id: targetId }],
    });
    resolveTopOfStack(state);
}

function victim(defId: string): CardInstanceState {
    return makeInstance(defId, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
}

function inZone(
    state: GameState,
    zone: Destination,
    id: string
): CardInstanceState {
    const card = state.players[1][zone].find((c) => c.id === id);
    if (!card) throw new Error(`${id} not in ${zone}`);
    return card;
}

/** Same card as the wire carries it (CR 400.7 must hold for the client too). */
function projected(
    state: GameState,
    zone: "graveyard" | "exile",
    id: string
): CardInstanceState {
    const view = projectPublicState(state, 1, "p1");
    const card = view.players[1][zone].find((c) => c.id === id);
    if (!card) throw new Error(`${id} not projected in ${zone}`);
    return card as CardInstanceState;
}

function starDrawTriggers(state: GameState): number {
    return state.stack.filter((item) => item.triggeredAbilityId === STAR_DRAW)
        .length;
}

describe("CR 400.7 — the card in the new zone shows its printed characteristics after Oko's +1 (issue #8730)", () => {
    it.each(DESTINATIONS)(
        "a Chromatic Star elk-ified then moved to %s has its printed abilities, type line and colours",
        (zone) => {
            const state = okoBoard(victim(STAR));
            elkify(state, "victim");
            const elk = state.players[1].battlefield[0];
            expect(getEffectiveActivatedAbilities(elk)).toEqual([]);
            expect(elk.types).toEqual(["Creature"]);

            removePermanentTo(state, "victim", zone);
            const card = inZone(state, zone, "victim");
            expect(getEffectiveActivatedAbilities(card)).toHaveLength(1);
            expect(effectiveTriggeredAbilities(card).map((a) => a.id)).toEqual([
                STAR_DRAW,
            ]);
            expect(card.abilitiesSuppressedBy).toBeUndefined();
            expect(card.abilityLossHolds).toBeUndefined();
            expect(card.types).toEqual(["Artifact"]);
            expect(card.subtypes).toEqual([]);
            expect(card.colorOverride).toBeUndefined();
            expect(card.grantedColors).toBeUndefined();
        }
    );

    it.each(DESTINATIONS)(
        "a Serra Angel elk-ified then moved to %s has its printed keywords and P/T",
        (zone) => {
            const state = okoBoard(victim(SERRA));
            elkify(state, "victim");
            expect(state.players[1].battlefield[0].staticAbilities).toEqual([]);

            removePermanentTo(state, "victim", zone);
            const card = inZone(state, zone, "victim");
            expect(card.staticAbilities).toEqual(
                expect.arrayContaining(["flying", "vigilance"])
            );
            expect(card.subtypes).toEqual(["Angel"]);
            expect(getEffectivePower(state, card)).toBe(4);
            expect(getEffectiveToughness(state, card)).toBe(4);
        }
    );

    it.each(["graveyard", "exile"] as const)(
        "the %s card crosses the wire without the layer-6 residue (projectPublicState)",
        (zone) => {
            const state = okoBoard(victim(STAR));
            elkify(state, "victim");
            removePermanentTo(state, "victim", zone);
            const slim = projected(state, zone, "victim");
            expect(slim.abilitiesSuppressedBy).toBeUndefined();
            expect(slim.abilityLossHolds).toBeUndefined();
            expect(slim.colorOverride).toBeUndefined();
            expect(slim.types).toEqual(["Artifact"]);
            expect(getEffectiveActivatedAbilities(slim)).toHaveLength(1);
        }
    );

    it("full path: the +1 announced through activateAbilityOnState, the Elk dies to lethal damage, and the graveyard card is printed on the wire", () => {
        const state = okoBoard(victim(SERRA));
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "oko1",
            abilityId: PLUS1,
        });
        applyOneTargetSelection(state, "p1", {
            targetType: "permanent",
            targetId: "victim",
        });
        resolveTopOfStack(state);
        const elk = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(elk.subtypes).toEqual(["Elk"]);
        // CR 704.5g — the combat-damage outcome: lethal damage on a 3/3.
        elk.damageMarked = 3;
        checkStateBasedActions(state);

        const slim = projected(state, "graveyard", "victim");
        expect(slim.colorOverride).toBeUndefined();
        expect(slim.grantedColors).toBeUndefined();
        expect(slim.abilitiesSuppressedBy).toBeUndefined();
        expect(slim.subtypes).toEqual(["Angel"]);
        expect(slim.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "vigilance"])
        );
    });

    it("CR 113.6 — a printed graveyard ability works again on a card that died as an Elk", () => {
        const state = okoBoard(victim(seasonedPyromancer().id));
        elkify(state, "victim");
        const elk = state.players[1].battlefield[0];
        expect(
            resolveActivatedAbility(elk, "seasoned-pyromancer-graveyard")
        ).toBeNull();
        removePermanentTo(state, "victim", "graveyard");
        const card = inZone(state, "graveyard", "victim");
        expect(
            resolveActivatedAbility(card, "seasoned-pyromancer-graveyard")
        ).not.toBeNull();
    });

    it("CR 611.2c — the Elk stays an Elk after Oko leaves the battlefield", () => {
        const state = okoBoard(victim(SERRA));
        elkify(state, "victim");
        removePermanentTo(state, "oko1", "graveyard");
        recomputeContinuousEffects(state);
        const elk = state.players[1].battlefield[0];
        expect(elk.subtypes).toEqual(["Elk"]);
        expect(elk.staticAbilities).toEqual([]);
        expect(getEffectivePower(state, elk)).toBe(3);
    });

    it("CR 603.10a — last known information still reads what the Elk was (`keywordsAtLeave`, `countersAtLeave`)", () => {
        const state = okoBoard(victim(SERRA));
        elkify(state, "victim");
        const elk = state.players[1].battlefield[0];
        elk.counters = { "+1/+1": 1 };
        removePermanentTo(state, "victim", "graveyard");
        const card = inZone(state, "graveyard", "victim");
        expect(card.keywordsAtLeave).toEqual([]);
        expect(card.countersAtLeave).toEqual({ "+1/+1": 1 });
        expect(card.abilitiesAtLeave?.suppressedBy).toHaveLength(1);
        // The look-back is the Elk: no keywords, its abilities lost.
        const back = lookBackSelf(state, card);
        expect(back.staticAbilities).toEqual([]);
        expect(effectiveTriggeredAbilities(back)).toEqual([]);
    });
});

describe("CR 603.10a — a leaves-the-battlefield trigger looks back at the abilities the permanent left with (issue #8730)", () => {
    it("a Chromatic Star that dies as an Elk draws no card", () => {
        const state = okoBoard(victim(STAR));
        elkify(state, "victim");
        removePermanentTo(state, "victim", "graveyard");
        processPendingActionTriggers(state);
        expect(starDrawTriggers(state)).toBe(0);
        // And the card in the graveyard has its printed trigger again.
        expect(
            effectiveTriggeredAbilities(inZone(state, "graveyard", "victim"))
        ).toHaveLength(1);
    });

    it("a Chromatic Star that dies without having lost its abilities draws", () => {
        const state = okoBoard(victim(STAR));
        removePermanentTo(state, "victim", "graveyard");
        processPendingActionTriggers(state);
        expect(starDrawTriggers(state)).toBe(1);
    });

    it.each(DESTINATIONS)(
        "an Elk-ified permanent moved to %s fires no leaves-the-battlefield trigger of its own",
        (zone) => {
            // Goblin Shrine's trigger fires on EVERY destination (the paired
            // positive test below), so each row here is discriminating. The
            // resolution is driven straight (`elkify` skips announcement):
            // only the layer-6 strip matters, not Oko's target filter.
            const state = okoBoard(
                makeInstance(goblinShrine().id, {
                    id: "victim",
                    controllerId: "p2",
                    ownerId: "p2",
                })
            );
            elkify(state, "victim");
            expect(
                effectiveTriggeredAbilities(state.players[1].battlefield[0])
            ).toEqual([]);
            removePermanentTo(state, "victim", zone);
            processPendingActionTriggers(state);
            expect(state.stack).toHaveLength(0);
        }
    );

    it.each(DESTINATIONS)(
        "a leaves-the-battlefield trigger of a permanent that lost no abilities still fires on a move to %s",
        (zone) => {
            const shrine = makeInstance(goblinShrine().id, {
                id: "shrine",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = okoBoard(shrine);
            removePermanentTo(state, "shrine", zone);
            processPendingActionTriggers(state);
            expect(state.stack.map((item) => item.triggeredAbilityId)).toEqual([
                "goblin-shrine-leaves",
            ]);
        }
    );

    it("a Chromatic Star that dies under Titania's Song draws no card, and the graveyard card names no Song", () => {
        const star = victim(STAR);
        const song = makeInstance(titaniasSong().id, {
            id: "song",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = okoBoard(star);
        state.players[0].battlefield.push(song);
        beginApplyingStaticEffects(state, song);
        recomputeContinuousEffects(state);
        expect(
            state.players[1].battlefield[0].abilitiesSuppressedBy
        ).toBeDefined();

        removePermanentTo(state, "victim", "graveyard");
        processPendingActionTriggers(state);
        expect(starDrawTriggers(state)).toBe(0);
        const card = inZone(state, "graveyard", "victim");
        expect(card.abilitiesSuppressedBy).toBeUndefined();
        expect(card.types).toEqual(["Artifact"]);
        // Still printed after the Song itself has left.
        removePermanentTo(state, "song", "graveyard");
        recomputeContinuousEffects(state);
        expect(card.abilitiesSuppressedBy).toBeUndefined();
        expect(
            projected(state, "graveyard", "victim").abilitiesSuppressedBy
        ).toBeUndefined();
    });
});

describe("CR 400.7 — granted abilities end at every departure (issue #8730)", () => {
    it.each(["graveyard", "exile"] as const)(
        "a granted activated and triggered ability is gone from the %s card, kept only for the look-back",
        (zone) => {
            const planisphere = astrologiansPlanisphere();
            const bear = makeInstance(BEARS, {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
                // What a resolved grant writes on its target: the template
                // ids on the granting card's definition, with the timestamp.
                grantedTriggeredAbilities: [
                    {
                        sourceCardId: planisphere.id,
                        abilityId: "astrologians-planisphere-granted-counter",
                        seq: 1,
                    },
                ],
                grantedActivatedAbilities: [
                    {
                        sourceCardId: STAR,
                        abilityId: "chromatic-star-mana",
                        origin: "card-abilities",
                        seq: 1,
                    },
                ],
            });
            const state = okoBoard(bear);
            expect(
                effectiveTriggeredAbilities(state.players[1].battlefield[0])
            ).toHaveLength(1);
            expect(
                getEffectiveActivatedAbilities(state.players[1].battlefield[0])
            ).toHaveLength(1);

            removePermanentTo(state, "victim", zone);
            const card = inZone(state, zone, "victim");
            expect(card.grantedTriggeredAbilities).toBeUndefined();
            expect(card.grantedActivatedAbilities).toBeUndefined();
            expect(effectiveTriggeredAbilities(card)).toEqual([]);
            expect(getEffectiveActivatedAbilities(card)).toEqual([]);
            // CR 603.10a — the look-back still has the grant.
            expect(
                effectiveTriggeredAbilities(lookBackSelf(state, card))
            ).toHaveLength(1);
        }
    );
});
