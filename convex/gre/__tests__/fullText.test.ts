// CR 612.6 full-text effects (issue #6741) — a layer-3 (CR 613.1c)
// text-changing effect that gives a permanent the name, mana cost, colour,
// type line, rules text and P/T of the top card of its controller's graveyard.
//
//   CR 612.6 — "One card (Volrath's Shapeshifter) states that an object has the
//   'full text' of another object. This changes not just the text that appears
//   in the object's text box and type line, but also changes the text that
//   represents its name, mana cost, color indicator, power, and toughness."
//   CR 611.3a — the effect is not locked in; it applies at any moment.
//   CR 707.2 — text-changing effects are not copied.
//
// The mechanic ships ahead of its first card (issue #6704), so the subject is a
// test definition with the card's own shape, registered for each test.

import { describe, it, expect } from "vitest";
import {
    discardToGraveyard,
    getPlayer,
    recomputeContinuousEffects,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { applyCopy, presentedDefId } from "../copy";
import { turnFaceDown } from "../faceDown";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { getDefinition, withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";

const SHAPESHIFTER = "test-full-text-shapeshifter";
const DISCARD = "test-full-text-shapeshifter-discard";
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const CRAW_WURM = "bfed1a95-bd67-4e16-a781-81866028af2f"; // 6/4 green
const LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // Savannah Lions, 2/1 white
const CRUSADE = "057986c7-20c0-4157-b4df-beae4ef5c66d"; // white creatures +1/+1
const HUMILITY = "a2fb7128-806b-4148-80fe-eb967f248021";
const MAN_O_WAR = "4dbf9bf9-75cd-4b25-a3a1-43b7e029700b"; // ETB bounce
const RUKH_EGG = "b28f9e63-e5e4-44b5-a17e-8301ff17c623"; // dies trigger
const CLONE = "f00d33dd-4eb2-4446-9813-1923d8e2d2f3";
/** Frozen Shade — `{B}: This creature gets +1/+1 until end of turn.` */
const SHADE = "d0bd76c8-4cff-4c15-9686-7a299b589814";
const SHADE_PUMP = "frozen-shade-ability";

/** Volrath's Shapeshifter's shape: "As long as the top card of your graveyard
 *  is a creature card, this creature has the full text of that card and has
 *  the text '{2}: Discard a card.' / {2}: Discard a card." */
const shapeshifterDef: CardDefinition = {
    id: SHAPESHIFTER,
    name: "Full Text Test Shapeshifter",
    rarity: "rare",
    oracleText:
        'As long as the top card of your graveyard is a creature card, this creature has the full text of that card and has the text "{2}: Discard a card."\n{2}: Discard a card.',
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Shapeshifter"],
    power: 0,
    toughness: 1,
    fullText: {
        from: "controller-graveyard-top",
        requiresType: "Creature",
        retainedActivatedAbilityIds: [DISCARD],
    },
    activatedAbilities: [
        {
            id: DISCARD,
            oracleText: "{2}: Discard a card.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
};

function withShapeshifter<T>(fn: () => T): T {
    return withTemporaryDefinition(shapeshifterDef, fn);
}

function inGraveyard(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, { id, zone: "graveyard" });
}

/** p1 controls the Shapeshifter (plus `others`) over `graveyard`. */
function board(
    graveyard: CardInstanceState[],
    others: CardInstanceState[] = []
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(SHAPESHIFTER, { id: "shifter" }),
                    ...others,
                ],
                graveyard,
            }),
            makePlayer("p2"),
        ],
    });
    recomputeContinuousEffects(state);
    return state;
}

function find(state: GameState, id: string): CardInstanceState {
    const card = state.players
        .flatMap((p) => [...p.battlefield, ...p.graveyard, ...p.exile])
        .find((c) => c.id === id);
    if (!card) throw new Error(`no ${id}`);
    return card;
}

function pt(state: GameState, id: string): [number, number] {
    const card = find(state, id);
    return [getEffectivePower(state, card), getEffectiveToughness(state, card)];
}

function abilityIds(card: CardInstanceState): string[] {
    return getEffectiveActivatedAbilities(card).map((a) => a.ability.id);
}

describe("full-text effect — presenting (CR 612.6 / 613.1c)", () => {
    it("has the top creature card's name, mana cost, colour, types, abilities and P/T", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(SHADE, "shade")]);
            const shifter = find(state, "shifter");
            expect(presentedDefId(shifter)).toBe(SHADE);
            expect(shifter.fullTextAnchor).toEqual({
                underlyingDefId: SHAPESHIFTER,
            });
            const shade = getDefinition(SHADE);
            expect(pt(state, "shifter")).toEqual([
                shade.power,
                shade.toughness,
            ]);
            expect(shifter.subtypes).toEqual(shade.subtypes ?? []);
            expect(getEffectiveColors(shifter)).toEqual(["B"]);
            // The presented card's activated ability, plus the retained text.
            expect(abilityIds(shifter)).toEqual([SHADE_PUMP, DISCARD]);
            const retained = getEffectiveActivatedAbilities(shifter).find(
                (a) => a.ability.id === DISCARD
            );
            expect(retained?.grantedSourceCardId).toBe(SHAPESHIFTER);
        });
    });

    it("is its printed 0/1 blue self while the top card is not a creature card", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(CRAW_WURM, "wurm"),
                inGraveyard(BOLT, "bolt"),
            ]);
            const shifter = find(state, "shifter");
            // CR 404.3 — the TOP card, unfiltered: a creature under the Bolt
            // does not count.
            expect(presentedDefId(shifter)).toBe(SHAPESHIFTER);
            expect(shifter.fullTextAnchor).toBeUndefined();
            expect(pt(state, "shifter")).toEqual([0, 1]);
            expect(getEffectiveColors(shifter)).toEqual(["U"]);
            expect(abilityIds(shifter)).toEqual([DISCARD]);
        });
    });

    it("a creature TOKEN on top is not a creature card (CR 108.2b)", () => {
        withShapeshifter(() => {
            const state = board([
                makeInstance(CRAW_WURM, {
                    id: "token",
                    zone: "graveyard",
                    isToken: true,
                }),
            ]);
            expect(presentedDefId(find(state, "shifter"))).toBe(SHAPESHIFTER);
        });
    });

    it("reads the CONTROLLER's graveyard, not an opponent's", () => {
        withShapeshifter(() => {
            const state = board([]);
            getPlayer(state, "p2").graveyard.push(
                inGraveyard(CRAW_WURM, "wurm")
            );
            recomputeContinuousEffects(state);
            expect(presentedDefId(find(state, "shifter"))).toBe(SHAPESHIFTER);
        });
    });

    it("presents on entry through the real cast path", () => {
        withShapeshifter(() => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [inGraveyard(CRAW_WURM, "wurm")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            const shifter = find(state, spell.id);
            expect(presentedDefId(shifter)).toBe(CRAW_WURM);
            expect(pt(state, spell.id)).toEqual([6, 4]);
            // CR 613.7a — stamped at entry like any static-ability source.
            expect(shifter.staticSeq).toBeDefined();
        });
    });
});

describe("full-text effect — re-evaluated at once (CR 611.3a)", () => {
    it("flips form when a creature card is discarded, with no enters trigger", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(BOLT, "bolt")]);
            const shifter = find(state, "shifter");
            shifter.isTapped = true;
            shifter.counters = { "+1/+1": 1 };
            shifter.damageMarked = 1;
            getPlayer(state, "p1").hand.push(
                makeInstance(MAN_O_WAR, { id: "mow", zone: "hand" })
            );
            state.pendingEvents = [];
            discardToGraveyard(state, "p1", "mow", { kind: "cost" });

            // No SBA, no recompute: the discard funnel re-synced on its own.
            expect(presentedDefId(shifter)).toBe(MAN_O_WAR);
            // CR 400.7 — the same object: counters, damage, tap state kept.
            expect(shifter.isTapped).toBe(true);
            expect(shifter.counters).toEqual({ "+1/+1": 1 });
            expect(shifter.damageMarked).toBe(1);
            // Gatherer ruling — changing form fires no "enters" ability.
            const fired = collectTriggers(state, state.pendingEvents ?? []).map(
                (t) => t.triggeredAbilityId
            );
            expect(fired).not.toContain("man-o-war-etb-bounce");
        });
    });

    it("reverts when the top creature card leaves the graveyard", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(BOLT, "bolt"),
                inGraveyard(CRAW_WURM, "wurm"),
            ]);
            expect(presentedDefId(find(state, "shifter"))).toBe(CRAW_WURM);
            const gy = getPlayer(state, "p1").graveyard;
            getPlayer(state, "p1").exile.push(gy.pop()!);
            recomputeContinuousEffects(state);
            const shifter = find(state, "shifter");
            expect(presentedDefId(shifter)).toBe(SHAPESHIFTER);
            expect(shifter.fullTextAnchor).toBeUndefined();
            expect(pt(state, "shifter")).toEqual([0, 1]);
            expect(shifter.grantedActivatedAbilities).toBeUndefined();
        });
    });

    it("presents a creature that just died onto the top of the graveyard", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(BOLT, "bolt")],
                [makeInstance(CRAW_WURM, { id: "wurm" })]
            );
            removePermanentTo(state, "wurm", "graveyard");
            expect(presentedDefId(find(state, "shifter"))).toBe(CRAW_WURM);
        });
    });

    it("a 0/1 with damage that loses a bigger body dies to the SBA (CR 704.5g)", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(BOLT, "bolt"),
                inGraveyard(CRAW_WURM, "wurm"),
            ]);
            find(state, "shifter").damageMarked = 3;
            expect(pt(state, "shifter")).toEqual([6, 4]);
            const gy = getPlayer(state, "p1").graveyard;
            getPlayer(state, "p1").exile.push(gy.pop()!);
            checkStateBasedActions(state);
            expect(
                getPlayer(state, "p1").battlefield.some(
                    (c) => c.id === "shifter"
                )
            ).toBe(false);
            // It went to the graveyard as its printed self.
            const dead = find(state, "shifter");
            expect(dead.zone).toBe("graveyard");
            expect(presentedDefId(dead)).toBe(SHAPESHIFTER);
            expect(dead.fullTextAnchor).toBeUndefined();
        });
    });
});

describe("full-text effect — layers 4-7 apply on top (CR 613.1c)", () => {
    it("an anthem matching the presented colour and a counter stack on the presented P/T", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(LIONS, "lions")],
                [makeInstance(CRUSADE, { id: "crusade", staticSeq: 1 })]
            );
            find(state, "shifter").counters = { "+1/+1": 1 };
            // Savannah Lions 2/1, white: Crusade +1/+1, counter +1/+1.
            expect(pt(state, "shifter")).toEqual([4, 3]);
        });
    });

    it("Humility strips the presented abilities AND the retained text, and sets 1/1", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(SHADE, "shade")],
                [makeInstance(HUMILITY, { id: "humility", staticSeq: 1 })]
            );
            const shifter = find(state, "shifter");
            // Layer 3 survives — it is still a Frozen Shade by name and type.
            expect(presentedDefId(shifter)).toBe(SHADE);
            expect(pt(state, "shifter")).toEqual([1, 1]);
            expect(abilityIds(shifter)).toEqual([]);
        });
    });
});

describe("full-text effect — not copiable (CR 707.2)", () => {
    it("a copy of the Shapeshifter gets its printed text, shapeshifting ability included", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(CRAW_WURM, "wurm")]);
            const clone = makeInstance(CLONE, {
                id: "clone",
                controllerId: "p2",
                ownerId: "p2",
            });
            getPlayer(state, "p2").battlefield.push(clone);
            applyCopy(state, clone, find(state, "shifter"));
            recomputeContinuousEffects(state);
            // p2's graveyard is empty: the copy is a plain 0/1 Shapeshifter.
            expect(presentedDefId(clone)).toBe(SHAPESHIFTER);
            expect(clone.copiedFrom).toBe(CLONE);
            expect(pt(state, "clone")).toEqual([0, 1]);
            // ... and it HAS the shapeshifting ability (Gatherer ruling).
            getPlayer(state, "p2").graveyard.push(inGraveyard(LIONS, "lions"));
            recomputeContinuousEffects(state);
            expect(presentedDefId(clone)).toBe(LIONS);
            expect(clone.fullTextAnchor?.underlyingDefId).toBe(SHAPESHIFTER);
        });
    });

    it("becoming a copy replaces layer 1 and ends the full text with it (CR 613.1a)", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(CRAW_WURM, "wurm")],
                [makeInstance(LIONS, { id: "lions" })]
            );
            const shifter = find(state, "shifter");
            expect(presentedDefId(shifter)).toBe(CRAW_WURM);
            applyCopy(state, shifter, find(state, "lions"));
            recomputeContinuousEffects(state);
            // The copy's printed anchor is the Shapeshifter, never the Wurm it
            // was showing, and a Savannah Lions has no shapeshifting text.
            expect(shifter.copiedFrom).toBe(SHAPESHIFTER);
            expect(presentedDefId(shifter)).toBe(LIONS);
            expect(shifter.fullTextAnchor).toBeUndefined();
            expect(pt(state, "shifter")).toEqual([2, 1]);
        });
    });

    it("the departure LKI records the copiable identity, the shown one beside it", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(CRAW_WURM, "wurm")]);
            removePermanentTo(state, "shifter", "exile");
            expect(state.lastKnownCopiable?.shifter).toMatchObject({
                defId: SHAPESHIFTER,
                fullTextDefId: CRAW_WURM,
            });
            const back = expandState(compactState(state));
            expect(back.lastKnownCopiable?.shifter).toMatchObject({
                defId: SHAPESHIFTER,
                fullTextDefId: CRAW_WURM,
            });
        });
    });
});

describe("full-text effect — identity swaps and departures", () => {
    it("a face-down permanent has no text (CR 708.2)", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(CRAW_WURM, "wurm")]);
            const shifter = find(state, "shifter");
            turnFaceDown(state, shifter, "morph");
            recomputeContinuousEffects(state);
            expect(shifter.fullTextAnchor).toBeUndefined();
            expect(shifter.faceDownOf).toBe(SHAPESHIFTER);
            expect(pt(state, "shifter")).toEqual([2, 2]);
        });
    });

    it("dies with the presented card's dies trigger (CR 603.10 look-back)", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(RUKH_EGG, "egg")]);
            state.pendingEvents = [];
            removePermanentTo(state, "shifter", "graveyard");
            const fired = collectTriggers(state, state.pendingEvents ?? []).map(
                (t) => t.triggeredAbilityId
            );
            expect(fired).toContain("rukh-egg-death");
        });
    });

    it("survives a save round trip with its anchor and retained text", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(SHADE, "shade")]);
            const back = expandState(compactState(state));
            recomputeContinuousEffects(back);
            const shifter = find(back, "shifter");
            expect(presentedDefId(shifter)).toBe(SHADE);
            expect(shifter.fullTextAnchor?.underlyingDefId).toBe(SHAPESHIFTER);
            expect(abilityIds(shifter)).toEqual([SHADE_PUMP, DISCARD]);
        });
    });
});

describe("full-text effect — wire format (projectPublicState)", () => {
    it("the projected permanent presents the shown card, its P/T and both abilities' rows", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(CRAW_WURM, "wurm")]);
            const projected = projectPublicState(state, 1, "p2");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "shifter"
            )!;
            expect(slim.card.id).toBe(CRAW_WURM);
            expect(slim.fullTextAnchor?.underlyingDefId).toBe(SHAPESHIFTER);
            expect(getEffectivePower(projected, slim as never)).toBe(6);
            expect(getEffectiveToughness(projected, slim as never)).toBe(4);
            expect(slim.grantedActivatedAbilities).toEqual([
                {
                    sourceCardId: SHAPESHIFTER,
                    abilityId: DISCARD,
                    origin: "card-abilities",
                },
            ]);
        });
    });
});
