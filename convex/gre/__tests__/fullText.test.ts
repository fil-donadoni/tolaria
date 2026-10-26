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
    binRevealedTopCard,
    buildSpellContext,
    createTokenPermanents,
    discardToGraveyard,
    getPlayer,
    payExileThisCost,
    payGraveyardCostCards,
    putReanimatedSetOnBattlefield,
    recomputeContinuousEffects,
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { applyCopy, presentedDefId } from "../copy";
import { turnFaceDown } from "../faceDown";
import { transformPermanent } from "../transform";
import { collectTriggers } from "../triggers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { getDefinition, withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { voiceOfAll } from "../../cards/sets/pls/white.cards";
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
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
/** Conspiracy — "Creatures you control are the chosen type." (layer 4) */
const CONSPIRACY = "411c9f22-2df0-4a63-b2be-fa02612a6ef8";
/** Frozen Shade — `{B}: This creature gets +1/+1 until end of turn.` */
const SHADE = "d0bd76c8-4cff-4c15-9686-7a299b589814";
const SHADE_PUMP = "frozen-shade-ability";
/** Clockwork Beast — "This creature enters with seven +1/+0 counters on it." */
const CLOCKWORK_BEAST = "27f916a2-0ace-44b5-99dc-72979af34db9";
/** Polar Kraken — "This creature enters tapped." */
const POLAR_KRAKEN = "aee01e9c-0445-4228-a73a-3e5744844ed3";
/** Containment Priest — "If a nontoken creature would enter and it wasn't
 *  cast, exile it instead." */
const CONTAINMENT_PRIEST = "c2c794b9-09da-49be-b258-b0e21f1663e3";

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
            // CR 404.2 — the TOP card, unfiltered: a creature under the Bolt
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
            expect(shifter.staticSeq).toBeDefined();
        });
    });

    it("is stamped at entry even while it shows nothing (CR 613.7a)", () => {
        withShapeshifter(() => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        graveyard: [inGraveyard(BOLT, "bolt")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            const shifter = find(state, spell.id);
            expect(presentedDefId(shifter)).toBe(SHAPESHIFTER);
            // The text it shows later takes THIS timestamp, not a later one.
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

    it("presents a creature card the general mover puts on top (a library bin)", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(BOLT, "bolt")]);
            getPlayer(state, "p1").library.push(
                makeInstance(CRAW_WURM, { id: "wurm", zone: "library" })
            );
            binRevealedTopCard(state, getPlayer(state, "p1"));
            expect(presentedDefId(find(state, "shifter"))).toBe(CRAW_WURM);
        });
    });

    it("presents a creature card milled mid-resolution", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(BOLT, "bolt")]);
            getPlayer(state, "p1").library.push(
                makeInstance(CRAW_WURM, { id: "wurm", zone: "library" })
            );
            const ctx = buildSpellContext(state, pushSpell(state, BOLT, "p1"));
            ctx.millCards("p1", 1);
            expect(presentedDefId(find(state, "shifter"))).toBe(CRAW_WURM);
        });
    });

    it("reverts when a graveyard cost exiles the top creature card", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(BOLT, "bolt"),
                inGraveyard(CRAW_WURM, "wurm"),
            ]);
            payGraveyardCostCards(
                state,
                getPlayer(state, "p1"),
                ["wurm"],
                undefined
            );
            expect(presentedDefId(find(state, "shifter"))).toBe(SHAPESHIFTER);
        });
    });

    it("reverts when an exile-this cost takes the top creature card from the graveyard", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(BOLT, "bolt"),
                inGraveyard(CRAW_WURM, "wurm"),
            ]);
            payExileThisCost(
                state,
                getPlayer(state, "p1"),
                "wurm",
                "graveyard"
            );
            expect(presentedDefId(find(state, "shifter"))).toBe(SHAPESHIFTER);
        });
    });

    it("reverts when the top creature card is cast from the graveyard", () => {
        withShapeshifter(() => {
            const state = board([
                inGraveyard(BOLT, "bolt"),
                inGraveyard(CRAW_WURM, "wurm"),
            ]);
            removeFromZone(
                state,
                getPlayer(state, "p1"),
                "wurm",
                "graveyard",
                "p1"
            );
            expect(presentedDefId(find(state, "shifter"))).toBe(SHAPESHIFTER);
        });
    });

    it("presents a creature that just died once the SBA pass re-evaluates it (CR 704.3)", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(BOLT, "bolt")],
                [makeInstance(CRAW_WURM, { id: "wurm" })]
            );
            removePermanentTo(state, "wurm", "graveyard");
            checkStateBasedActions(state);
            expect(presentedDefId(find(state, "shifter"))).toBe(CRAW_WURM);
        });
    });

    it("a funnel change of form recomposes the board's layer-4 effects on it", () => {
        withShapeshifter(() => {
            const state = board(
                [inGraveyard(BEARS, "bears")],
                [
                    makeInstance(CONSPIRACY, {
                        id: "conspiracy",
                        staticSeq: 1,
                        chosenSubtypes: ["Elf"],
                    }),
                ]
            );
            const shifter = find(state, "shifter");
            expect(shifter.subtypes).toEqual(["Elf"]);
            getPlayer(state, "p1").hand.push(
                makeInstance(CRAW_WURM, { id: "wurm", zone: "hand" })
            );
            discardToGraveyard(state, "p1", "wurm", { kind: "cost" });
            // No recompute: the discard funnel's own re-evaluation.
            expect(presentedDefId(shifter)).toBe(CRAW_WURM);
            expect(shifter.subtypes).toEqual(["Elf"]);
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

describe("full-text effect — simultaneous departures look back (CR 603.10a)", () => {
    /** The SBA pass puts the triggers it collected on the stack itself. */
    function firedIds(state: GameState): string[] {
        return state.stack.map((t) => t.triggeredAbilityId ?? "");
    }

    it("dying beside another creature, it leaves as the card it showed before the event", () => {
        withShapeshifter(() => {
            // The Bears die FIRST in the sweep and land on top of the graveyard.
            const state = board([inGraveyard(RUKH_EGG, "egg")]);
            const p1 = getPlayer(state, "p1");
            p1.battlefield.unshift(
                makeInstance(BEARS, { id: "bears", damageMarked: 2 })
            );
            find(state, "shifter").damageMarked = 3; // Rukh Egg is 0/3
            checkStateBasedActions(state);
            expect(p1.battlefield.map((c) => c.id)).toEqual([]);
            expect(state.lastKnownCopiable?.shifter?.fullTextDefId).toBe(
                RUKH_EGG
            );
            expect(firedIds(state)).toEqual(["rukh-egg-death"]);
        });
    });

    it("a creature card dying in the same event does not lend it its text", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(BOLT, "bolt")]);
            const p1 = getPlayer(state, "p1");
            p1.battlefield.unshift(
                makeInstance(RUKH_EGG, { id: "egg", damageMarked: 3 })
            );
            find(state, "shifter").damageMarked = 1; // a 0/1 as itself
            checkStateBasedActions(state);
            expect(p1.battlefield.map((c) => c.id)).toEqual([]);
            expect(
                state.lastKnownCopiable?.shifter?.fullTextDefId
            ).toBeUndefined();
            // One Rukh Egg trigger: the Egg's own, never the Shapeshifter's.
            expect(firedIds(state)).toEqual(["rukh-egg-death"]);
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

    it("a permanent that becomes a copy of it after entering is stamped when it first presents (CR 613.7a)", () => {
        withShapeshifter(() => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(SHAPESHIFTER, { id: "shifter" }),
                        ],
                        graveyard: [inGraveyard(CRAW_WURM, "wurm")],
                    }),
                    makePlayer("p2"),
                ],
            });
            const spell = pushSpell(state, BEARS, "p1");
            resolveTopOfStack(state);
            const bears = find(state, spell.id);
            // Grizzly Bears has no static ability: entry stamped nothing.
            expect(bears.staticSeq).toBeUndefined();
            applyCopy(state, bears, find(state, "shifter"));
            recomputeContinuousEffects(state);
            expect(presentedDefId(bears)).toBe(CRAW_WURM);
            expect(bears.staticSeq).toBeDefined();
        });
    });

    it("the departure LKI records the copiable identity, the shown one beside it", () => {
        withShapeshifter(() => {
            const state = board([inGraveyard(CRAW_WURM, "wurm")]);
            removePermanentTo(state, "shifter", "exile");
            // CR 400.7 — the card in exile is its printed self again.
            const exiled = find(state, "shifter");
            expect(presentedDefId(exiled)).toBe(SHAPESHIFTER);
            expect(exiled.fullTextAnchor).toBeUndefined();
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

    it("transforming it does nothing: it is not a double-faced card (CR 701.27c)", () => {
        const dfc: CardDefinition = {
            id: "test-full-text-dfc-front",
            name: "Full Text Test Front",
            rarity: "common",
            manaCost: { G: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
            backFace: {
                name: "Full Text Test Back",
                types: ["Creature"],
                power: 5,
                toughness: 5,
                staticAbilities: [],
            },
        };
        withShapeshifter(() =>
            withTemporaryDefinition(dfc, () => {
                const state = board([inGraveyard(dfc.id, "front")]);
                const shifter = find(state, "shifter");
                expect(presentedDefId(shifter)).toBe(dfc.id);
                transformPermanent(state, shifter);
                recomputeContinuousEffects(state);
                expect(shifter.transformed).toBeUndefined();
                expect(presentedDefId(shifter)).toBe(dfc.id);
                expect(pt(state, "shifter")).toEqual([1, 1]);
            })
        );
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

// CR 614.12 — "check the characteristics of the permanent as it would exist on
// the battlefield, taking into account … continuous effects from the
// permanent's own static abilities that would apply to it once it's on the
// battlefield". The full text is one of those, so the text it is about to
// present decides the entry replacements.
describe("full-text effect — entering presents first (CR 614.12)", () => {
    /** A creature that enters tapped AND owes a non-copy as-enters choice, so
     *  an entry parks on the choice and resumes presenting it. */
    const TAPPED_PAYER = "test-full-text-tapped-payer";
    const tappedPayerDef: CardDefinition = {
        id: TAPPED_PAYER,
        name: "Full Text Test Tapped Payer",
        rarity: "common",
        oracleText:
            "This creature enters tapped.\nAs this creature enters, pay up to 2 life.",
        manaCost: { B: 1 },
        types: ["Creature"],
        subtypes: ["Horror"],
        power: 3,
        toughness: 3,
        entersTapped: true,
        entersWith: { asEnters: [{ kind: "payLife", cap: 2 }] },
    };
    /** Exiles every creature that would enter, cast or not, token or not. */
    const EXILER = "test-full-text-entry-exiler";
    const exilerDef: CardDefinition = {
        id: EXILER,
        name: "Full Text Test Entry Exiler",
        rarity: "common",
        oracleText: "If a creature would enter, exile it instead.",
        types: ["Artifact"],
        replacementEffects: [
            {
                id: "test-full-text-exile-entering-creature",
                oracleText: "If a creature would enter, exile it instead.",
                eventKind: "enters-battlefield",
                appliesTo: (event) =>
                    event.kind === "enters-battlefield" &&
                    event.types.includes("Creature"),
                replace: (event) => ({
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                }),
            },
        ],
    };

    /** A 0/0 that owes a `body` choice ("As this enters, choose 2/2 or 4/4"):
     *  its answer writes the body onto the parked object. */
    const BODY_PICKER = "test-full-text-body-picker";
    const bodyPickerDef: CardDefinition = {
        id: BODY_PICKER,
        name: "Full Text Test Body Picker",
        rarity: "common",
        oracleText:
            "As this creature enters, it becomes your choice of 2/2 or 4/4.",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Shapeshifter"],
        power: 0,
        toughness: 0,
        entersWith: {
            asEnters: [
                {
                    kind: "body",
                    options: [
                        { id: "2-2", label: "2/2", power: 2, toughness: 2 },
                        { id: "4-4", label: "4/4", power: 4, toughness: 4 },
                    ],
                },
            ],
        },
    };
    /** Mox Diamond's shape: "If this would enter, you may discard a land card
     *  instead. If you do, put it onto the battlefield. If you don't, put it
     *  into its owner's graveyard." */
    const DISCARD_OR_BIN = "test-full-text-discard-or-bin";
    const discardOrBinDef: CardDefinition = {
        id: DISCARD_OR_BIN,
        name: "Full Text Test Discard Or Bin",
        rarity: "common",
        oracleText:
            "If this creature would enter, you may discard a land card instead. If you do, put it onto the battlefield. If you don't, put it into its owner's graveyard.",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Elf"],
        power: 1,
        toughness: 1,
        entersWith: {
            asEnters: [
                {
                    kind: "discard",
                    filter: { type: "Land" },
                    ifDeclined: "graveyard",
                },
            ],
        },
    };

    function withEntryFixtures<T>(fn: () => T): T {
        return withShapeshifter(() =>
            withTemporaryDefinition(tappedPayerDef, () =>
                withTemporaryDefinition(exilerDef, () =>
                    withTemporaryDefinition(bodyPickerDef, () =>
                        withTemporaryDefinition(discardOrBinDef, fn)
                    )
                )
            )
        );
    }

    function graveyardOf(
        graveyard: CardInstanceState[],
        opponentBoard: CardInstanceState[] = []
    ): GameState {
        return makeState({
            players: [
                makePlayer("p1", { life: 20, graveyard }),
                makePlayer("p2", { battlefield: opponentBoard }),
            ],
        });
    }

    function onP2Battlefield(cardId: string, id: string): CardInstanceState {
        return makeInstance(cardId, { id, controllerId: "p2", ownerId: "p2" });
    }

    /** Census row B: the Shapeshifter (top of p1's graveyard) is lifted out
     *  and put onto the battlefield by an effect. */
    function reanimateShifter(state: GameState): void {
        const graveyard = getPlayer(state, "p1").graveyard;
        const [card] = graveyard.splice(
            graveyard.findIndex((c) => c.id === "shifter"),
            1
        );
        putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);
    }

    /** Census row C: a token copy of the Shapeshifter. */
    function tokenCopyOfShifter(state: GameState): string | undefined {
        return createTokenPermanents(
            state,
            { name: "Copy", types: ["Creature"], power: 0, toughness: 0 },
            "p1",
            1,
            undefined,
            { copyOf: { source: { card: { id: SHAPESHIFTER } } } }
        )[0];
    }

    function answerHead(state: GameState, ids: string[]): void {
        const head = (state.pendingChoices ?? [])[0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ids,
        });
    }

    function onBattlefield(state: GameState, id: string): CardInstanceState {
        const card = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === id
        );
        if (!card) throw new Error(`${id} is not on p1's battlefield`);
        return card;
    }

    it("a cast entry gets the presented card's entry counters (CR 614.1c)", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(CLOCKWORK_BEAST, "beast")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            const shifter = onBattlefield(state, spell.id);
            expect(presentedDefId(shifter)).toBe(CLOCKWORK_BEAST);
            expect(shifter.counters?.["+1/+0"]).toBe(7);
            expect(pt(state, spell.id)).toEqual([7, 4]);
        });
    });

    it("a reanimated entry reads the card under it once it has left the graveyard", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([
                inGraveyard(CLOCKWORK_BEAST, "beast"),
                inGraveyard(SHAPESHIFTER, "shifter"),
            ]);
            reanimateShifter(state);
            const shifter = onBattlefield(state, "shifter");
            expect(presentedDefId(shifter)).toBe(CLOCKWORK_BEAST);
            expect(shifter.counters?.["+1/+0"]).toBe(7);
            expect(abilityIds(shifter)).toContain(DISCARD);
        });
    });

    it("a token copy enters with them too (CR 707.2: the copy is the printed Shapeshifter)", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(CLOCKWORK_BEAST, "beast")]);
            const id = tokenCopyOfShifter(state)!;
            const token = onBattlefield(state, id);
            expect(presentedDefId(token)).toBe(CLOCKWORK_BEAST);
            expect(token.counters?.["+1/+0"]).toBe(7);
        });
    });

    it("enters tapped when the presented card does (CR 614.1c)", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(POLAR_KRAKEN, "kraken")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            const shifter = onBattlefield(state, spell.id);
            expect(presentedDefId(shifter)).toBe(POLAR_KRAKEN);
            expect(shifter.isTapped).toBe(true);
        });
    });

    it("a Clone on top offers the as-enters copy choice; copying replaces the full text", () => {
        withEntryFixtures(() => {
            const state = graveyardOf(
                [inGraveyard(CLONE, "clone")],
                [onP2Battlefield(BEARS, "bears")]
            );
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.asEntersKind).toBe("copy");
            expect(state.pendingChoices?.[0]?.candidateIds).toEqual(["bears"]);
            const parked = state.stagedEntries?.[0]?.card;
            expect(parked?.id).toBe(spell.id);
            expect(presentedDefId(parked!)).toBe(CLONE);

            answerHead(state, ["bears"]);

            // CR 613.1a — the copy effect replaces layer 1, the full-text
            // ability with it.
            const copy = onBattlefield(state, spell.id);
            expect(presentedDefId(copy)).toBe(BEARS);
            expect(copy.fullTextAnchor).toBeUndefined();
        });
    });

    it("a parked cast entry presents again when its choice is answered", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(TAPPED_PAYER, "payer")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.asEntersKind).toBe("payLife");

            answerHead(state, ["2"]);

            const shifter = onBattlefield(state, spell.id);
            expect(presentedDefId(shifter)).toBe(TAPPED_PAYER);
            expect(shifter.isTapped).toBe(true);
            expect(getPlayer(state, "p1").life).toBe(18);
        });
    });

    it("a parked token entry presents again when its choice is answered", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(TAPPED_PAYER, "payer")]);
            const id = tokenCopyOfShifter(state)!;
            expect(state.pendingChoices?.[0]?.asEntersKind).toBe("payLife");

            answerHead(state, ["2"]);

            const token = onBattlefield(state, id);
            expect(presentedDefId(token)).toBe(TAPPED_PAYER);
            expect(token.isTapped).toBe(true);
        });
    });

    it("a presented as-enters mode is offered with the presented card's modes", () => {
        withEntryFixtures(() => {
            const voice = voiceOfAll();
            const state = graveyardOf([inGraveyard(voice.id, "voice")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            const head = state.pendingChoices?.[0];
            expect(head?.asEntersKind).toBe("mode");
            expect(head?.options?.map((o) => o.id)).toEqual(
                voice.modes!.map((m) => m.id)
            );

            answerHead(state, [voice.modes![0].id]);

            const shifter = onBattlefield(state, spell.id);
            expect(presentedDefId(shifter)).toBe(voice.id);
            expect(shifter.chosenModeId).toBe(voice.modes![0].id);
        });
    });

    it("a presented body answer survives a cast entry's resume (CR 614.12c)", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(BODY_PICKER, "picker")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            expect(state.pendingChoices?.[0]?.asEntersKind).toBe("body");

            answerHead(state, ["4-4"]);

            expect(presentedDefId(onBattlefield(state, spell.id))).toBe(
                BODY_PICKER
            );
            expect(pt(state, spell.id)).toEqual([4, 4]);
        });
    });

    it("a parked reanimated entry keeps its full text and its retained text", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([
                inGraveyard(TAPPED_PAYER, "payer"),
                inGraveyard(SHAPESHIFTER, "shifter"),
            ]);
            reanimateShifter(state);
            expect(state.pendingChoices?.[0]?.asEntersKind).toBe("payLife");

            answerHead(state, ["2"]);

            const shifter = onBattlefield(state, "shifter");
            expect(presentedDefId(shifter)).toBe(TAPPED_PAYER);
            expect(shifter.isTapped).toBe(true);
            expect(abilityIds(shifter)).toEqual([DISCARD]);
        });
    });

    it("an aborted as-enters entry goes to the graveyard as its own card", () => {
        withEntryFixtures(() => {
            const state = graveyardOf([inGraveyard(DISCARD_OR_BIN, "binner")]);
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            if (state.pendingChoices?.[0]?.asEntersKind === "discard") {
                answerHead(state, []);
            }
            expect(state.stagedEntries).toBeUndefined();
            const binned = getPlayer(state, "p1").graveyard.find(
                (c) => c.id === spell.id
            );
            expect(binned).toBeDefined();
            expect(binned!.fullTextAnchor).toBeUndefined();
            expect(presentedDefId(binned!)).toBe(SHAPESHIFTER);
            expect(binned!.grantedActivatedAbilities).toBeUndefined();
        });
    });

    function expectExiledAsItself(state: GameState, id: string): void {
        const exiled = getPlayer(state, "p1").exile.find((c) => c.id === id);
        expect(exiled).toBeDefined();
        expect(exiled!.fullTextAnchor).toBeUndefined();
        expect(presentedDefId(exiled!)).toBe(SHAPESHIFTER);
        expect(exiled!.grantedActivatedAbilities).toBeUndefined();
        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
    }

    it("a reanimated entry exiled by Containment Priest leaves no presented identity in exile", () => {
        withEntryFixtures(() => {
            const state = graveyardOf(
                [
                    inGraveyard(CRAW_WURM, "wurm"),
                    inGraveyard(SHAPESHIFTER, "shifter"),
                ],
                [onP2Battlefield(CONTAINMENT_PRIEST, "priest")]
            );
            reanimateShifter(state);
            expectExiledAsItself(state, "shifter");
        });
    });

    it("a cast entry exiled by a replacement leaves no presented identity in exile", () => {
        withEntryFixtures(() => {
            const state = graveyardOf(
                [inGraveyard(CRAW_WURM, "wurm")],
                [onP2Battlefield(EXILER, "exiler")]
            );
            const spell = pushSpell(state, SHAPESHIFTER, "p1");
            resolveTopOfStack(state);
            expectExiledAsItself(state, spell.id);
        });
    });

    it("a token entry exiled by a replacement leaves no presented identity in exile", () => {
        withEntryFixtures(() => {
            const state = graveyardOf(
                [inGraveyard(CRAW_WURM, "wurm")],
                [onP2Battlefield(EXILER, "exiler")]
            );
            const id = tokenCopyOfShifter(state)!;
            expectExiledAsItself(state, id);
        });
    });
});
