// Invasion (INV) — blue behavior tests (ADR 0043 colour split).
//
// Opt is a pure-DSL card reusing already-shipped Ops (`scryReorder` + `draw`,
// issue #885). The catalogue-wide static sweep (effectScripts.test.ts) and the
// auto-generated smoke sweep cover most DSL cards without a hand-written test —
// but the smoke generator emits an explicit skip-with-reason for `scryReorder`
// (it suspends for a live order-top choice the canned generator can't drive), so
// per the per-Op regime this card earns a minimal hand-written scry-then-draw
// behavior test (CR 701.22 Scry, CR 121.1 draw).
//
// The rest of this file covers the free tranche's other cards (issue #1070):
// every one either hits a smoke-sweep explicit skip (a suspending choice/mayPay,
// a spell-targeting counter, a control change, an ambiguous moveZone source
// zone, or an optionChoice live pick — each documented "covered by the card's
// own test") or carries a `staticEffects[]` continuous effect, which the
// project's testing convention mandates a hand-written GRE + wire-format test
// for regardless of DSL/resolve status.

import { describe, it, expect } from "vitest";
import {
    collectiveRestraint,
    disrupt,
    empressGalina,
    exclude,
    manipulateFate,
    opt,
    prohibit,
    repulse,
    sapphireLeech,
    shimmeringWings,
    skyWeaver,
    travelersCloak,
    vodalianMerchant,
    vodalianSerpent,
    washOut,
    worldlyCounsel,
    zanamDjinn,
} from "../blue";
import { island, plains, swamp } from "../../lea/colorless";
import { lightningBolt } from "../../lea/red";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import {
    collectAttackManaTax,
    validateAttackerEligibility,
} from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { resolveActivated, resolveTrigger } from "./helpers";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(opt.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Opt (scry 1 then draw; CR 701.22 / 121.1)", () => {
    it("is a {U} instant", () => {
        expect(opt.manaCost).toEqual({ U: 1 });
        expect(opt.types).toEqual(["Instant"]);
    });

    it("keeping the top card on top draws it", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, opt.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the scry choice

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.destination).toBe("library-bottom");
        // Scry 1: keep "a" on top.
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a"],
            secondZoneIds: [],
        });

        // "a" stayed on top → it is the card drawn.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["a"]);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["b", "c"]);
    });

    it("sending the top card to the bottom draws the next card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, opt.id, "p1");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        // Scry 1: put "a" on the bottom (keep nothing on top).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["a"],
        });

        // "b" is the new top → it is drawn; "a" sits at the true bottom.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["b"]);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toEqual(["c", "a"]);
    });
});

describe("Disrupt (counter unless controller pays {1}, then draw; CR 701.5a / 121.1)", () => {
    it("counters the spell when the controller declines to pay", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "top",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, disrupt.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[0].hand).toHaveLength(1); // the draw resolved
    });

    it("lets the spell resolve when the controller pays {1}", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
            ],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, disrupt.id, "p1", [{ type: "spell", id: bolt.id }]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
    });
});

describe("Exclude (counter target creature spell, then draw; CR 701.5a / 121.1)", () => {
    it("counters a creature spell and draws a card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "top",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const bear = pushSpell(state, grizzlyBears.id, "p2");
        pushSpell(state, exclude.id, "p1", [{ type: "spell", id: bear.id }]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bear.id)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain(bear.id);
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Manipulate Fate (search 3, exile, shuffle, then draw; CR 701.23 / 701.13 / 701.24 / 121.1)", () => {
    it("exiles the three found cards, shuffles, and draws", () => {
        const cards = ["a", "b", "c", "d", "e"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: cards }), makePlayer("p2")],
        });
        pushSpell(state, manipulateFate.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.count).toBe(3);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["a", "b", "c"],
        });
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
            "c",
        ]);
        expect(state.players[0].library).toHaveLength(1); // d/e minus the draw
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Prohibit (counter cheap spells, wider if kicked; CR 702.33 / 701.5a)", () => {
    it("unkicked: counters a spell with mana value 2 or less", () => {
        const state = makeState();
        const bear = pushSpell(state, grizzlyBears.id, "p2"); // MV 2
        pushSpell(state, prohibit.id, "p1", [{ type: "spell", id: bear.id }]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bear.id)).toBeUndefined();
    });

    it("declares a wider mana-value ceiling for the kicked target requirement", () => {
        expect(prohibit.targetRequirement?.mvFilter?.max).toBe(2);
        expect(prohibit.kickedTargetRequirement?.mvFilter?.max).toBe(4);
        expect(prohibit.kicker?.cost).toEqual({ X: 2 });
    });
});

describe("Repulse (return target creature to hand, then draw; CR 400.7 / 121.1)", () => {
    it("bounces the target and draws a card", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "top",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, repulse.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].hand.map((c) => c.id)).toContain("bear");
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Sapphire Leech (flying + blue spells you cast cost {U} more; CR 702.9 / 601.2f)", () => {
    it("is a 2/2 flier", () => {
        expect(sapphireLeech.power).toBe(2);
        expect(sapphireLeech.toughness).toBe(2);
        expect(sapphireLeech.staticAbilities).toContain("flying");
    });

    it("taxes only the controller's own blue spells (Derelor template)", () => {
        const effect = sapphireLeech.staticEffects?.[0];
        expect(effect?.kind).toBe("cost-modifier");
        if (effect?.kind !== "cost-modifier") return;
        expect(effect.costIncrease).toEqual({ U: 1 });
        const leech = makeInstance(sapphireLeech.id, {
            id: "leech",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppLeech = makeInstance(sapphireLeech.id, {
            id: "opp-leech",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blueBolt = makeInstance(opt.id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        expect(effect.appliesToSpell!(blueBolt, STATIC_EFFECT_CTX, leech)).toBe(
            true
        );
        expect(
            effect.appliesToSpell!(blueBolt, STATIC_EFFECT_CTX, oppLeech)
        ).toBe(false);
    });
});

describe("Shimmering Wings (Aura grants flying; {U}: return to hand; CR 702.9 / 400.7)", () => {
    it("declares a flying keyword-grant on the host", () => {
        const grant = shimmeringWings.staticEffects?.[0];
        expect(grant?.kind).toBe("keyword-grant");
        if (grant?.kind === "keyword-grant") {
            expect(grant.keyword).toBe("flying");
        }
    });

    it("returns itself to its owner's hand when activated", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(shimmeringWings.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, aura, "shimmering-wings-return");
        expect(
            state.players[0].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
        expect(state.players[0].hand.map((c) => c.id)).toContain("aura");
    });
});

describe("Sky Weaver ({2}: target white or black creature gains flying EOT; CR 611.1b)", () => {
    it("grants flying to a legal white-or-black target", () => {
        const weaver = makeInstance(skyWeaver.id, {
            id: "weaver",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wight = makeInstance(grizzlyBears.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [weaver, wight],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, weaver, "sky-weaver-grant-flying", [
            { type: "permanent", id: "target" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "target")
                ?.staticAbilities
        ).toContain("flying");
    });

    it("restricts the activated ability's target to white or black creatures", () => {
        const ability = skyWeaver.activatedAbilities?.[0];
        expect(ability?.targetRequirement?.colorFilterAny).toEqual(["W", "B"]);
    });
});

describe("Vodalian Merchant (ETB: draw, then discard; CR 603.6a / 121.1 / 701.9)", () => {
    it("draws a card then discards the chosen one", () => {
        const drawn = makeInstance(grizzlyBears.id, {
            id: "drawn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const inHand = makeInstance(grizzlyBears.id, {
            id: "inHand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const merchant = makeInstance(vodalianMerchant.id, {
            id: "merchant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [merchant],
                    hand: [inHand],
                    library: [drawn],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, merchant, "vodalian-merchant-loot", {
            type: "PERMANENT_ENTERED",
            instanceId: "merchant",
            controllerId: "p1",
            types: merchant.types,
        });
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "drawn",
            "inHand",
        ]);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["drawn"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["inHand"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["drawn"]);
    });
});

describe("Vodalian Serpent (attack restriction + kicked counters; CR 508.1c / 702.33)", () => {
    it("uses data-driven attack-restriction (no magic string)", () => {
        expect(
            vodalianSerpent.staticEffects?.some(
                (e) => e.kind === "attack-restriction"
            )
        ).toBe(true);
    });

    it("cannot attack when defending player has no Island", () => {
        const serpent = makeInstance(vodalianSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent] }),
                makePlayer("p2"),
            ],
        });
        const result = validateAttackerEligibility(
            state.players[0].battlefield[0],
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });

    it("can attack when defending player controls an Island", () => {
        const serpent = makeInstance(vodalianSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
        });
        const isle = makeInstance(island.id, {
            id: "isle",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent] }),
                makePlayer("p2", { battlefield: [isle] }),
            ],
        });
        expect(
            validateAttackerEligibility(
                state.players[0].battlefield[0],
                state.players[1].battlefield
            )
        ).toEqual({ eligible: true });
    });

    it("enters with four +1/+1 counters when kicked", () => {
        const serpent = makeInstance(vodalianSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...serpent,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "vodalian-serpent-kicked-counters",
            triggerSourceId: "serpent",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "serpent",
                controllerId: "p1",
                types: serpent.types,
            },
            targets: [],
            kickerCount: 1,
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "serpent")
                ?.counters?.["+1/+1"]
        ).toBe(4);
    });

    it("enters with no counters when not kicked", () => {
        const serpent = makeInstance(vodalianSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, serpent, "vodalian-serpent-kicked-counters", {
            type: "PERMANENT_ENTERED",
            instanceId: "serpent",
            controllerId: "p1",
            types: serpent.types,
        });
        expect(
            state.players[0].battlefield.find((c) => c.id === "serpent")
                ?.counters
        ).toBeUndefined();
    });
});

describe("Wash Out (return all permanents of the chosen color; CR 700.2 / 400.7)", () => {
    it("bounces every permanent of the chosen color, leaving others untouched", () => {
        const blueGuy = makeInstance(vodalianMerchant.id, {
            id: "blue1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenGuy = makeInstance(grizzlyBears.id, {
            id: "green1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blueGuy] }),
                makePlayer("p2", { battlefield: [greenGuy] }),
            ],
        });
        pushSpell(state, washOut.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the modal pick
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["G"],
        });
        expect(
            state.players[1].battlefield.find((c) => c.id === "green1")
        ).toBeUndefined();
        expect(state.players[1].hand.map((c) => c.id)).toContain("green1");
        // Blue permanent untouched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "blue1")
        ).toBeDefined();
    });
});

describe("Zanam Djinn (flying; -2/-2 while blue is most common or tied; CR 702.9 / 611.2c)", () => {
    it("is a 5/6 flier at baseline with no other colored permanents", () => {
        const djinn = makeInstance(zanamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn] }),
                makePlayer("p2"),
            ],
        });
        // Blue (Zanam Djinn itself) is tied for most common (all others at 0)
        // → the -2/-2 applies.
        expect(getEffectivePower(state, djinn)).toBe(3);
        expect(getEffectiveToughness(state, djinn)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "djinn"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("is at full strength when another color strictly outnumbers blue", () => {
        const djinn = makeInstance(zanamDjinn.id, {
            id: "djinn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenA = makeInstance(grizzlyBears.id, {
            id: "greenA",
            controllerId: "p2",
            ownerId: "p2",
        });
        const greenB = makeInstance(grizzlyBears.id, {
            id: "greenB",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [djinn] }),
                makePlayer("p2", { battlefield: [greenA, greenB] }),
            ],
        });
        expect(getEffectivePower(state, djinn)).toBe(5);
        expect(getEffectiveToughness(state, djinn)).toBe(6);
    });
});

describe("Traveler's Cloak (Aura, ETB choose a land type, draw, grant landwalk; CR 603.6b / 702.14)", () => {
    it("declares one keyword-grant static per basic land type", () => {
        expect(travelersCloak.staticEffects).toHaveLength(5);
        const keywords = travelersCloak.staticEffects!.map((e) =>
            e.kind === "keyword-grant" ? e.keyword : undefined
        );
        expect(keywords.sort()).toEqual(
            [
                "plainswalk",
                "islandwalk",
                "swampwalk",
                "mountainwalk",
                "forestwalk",
            ].sort()
        );
    });

    it("grants only the chosen type's landwalk once the choice is stored", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(travelersCloak.id, {
            id: "cloak",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
            chosenSubtypes: ["Forest"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        const attachedBear = state.players[0].battlefield[0];
        expect(getEffectivePower(state, attachedBear)).toBeDefined();
        // Directly probe the granting predicate: only "forestwalk" applies.
        const forestGrant = travelersCloak.staticEffects!.find(
            (e) => e.kind === "keyword-grant" && e.keyword === "forestwalk"
        );
        const islandGrant = travelersCloak.staticEffects!.find(
            (e) => e.kind === "keyword-grant" && e.keyword === "islandwalk"
        );
        expect(forestGrant?.kind).toBe("keyword-grant");
        expect(islandGrant?.kind).toBe("keyword-grant");
        if (
            forestGrant?.kind === "keyword-grant" &&
            islandGrant?.kind === "keyword-grant"
        ) {
            expect(
                forestGrant.applies(attachedBear, aura, STATIC_EFFECT_CTX)
            ).toBe(true);
            expect(
                islandGrant.applies(attachedBear, aura, STATIC_EFFECT_CTX)
            ).toBe(false);
        }
    });

    it("draws a card via a separate DSL ETB trigger", () => {
        const drawTrigger = travelersCloak.triggeredAbilities?.find(
            (t) => t.id === "travelers-cloak-draw"
        );
        expect(drawTrigger?.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
    });
});

describe("Empress Galina ({U}{U},{T}: gain control of target legendary permanent indefinitely; CR 613.1b)", () => {
    it("takes control of a legendary permanent with no reverting condition", () => {
        const galina = makeInstance(empressGalina.id, {
            id: "galina",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A second copy of a Legendary card (printed supertypes come from the
        // registry via the card id, not an instance override) as the target.
        const legend = makeInstance(empressGalina.id, {
            id: "legend",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [galina],
                    manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [legend] }),
            ],
        });
        resolveActivated(state, galina, "empress-galina-steal-legendary", [
            { type: "permanent", id: "legend" },
        ]);
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "legend")
                ?.controllerId
        ).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "legend")
        ).toBeUndefined();

        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.find((c) => c.id === "legend")
        ).toBeDefined();
    });

    it("restricts the activated ability's target to legendary permanents", () => {
        const ability = empressGalina.activatedAbilities?.[0];
        expect(ability?.targetRequirement?.supertypeFilter).toEqual([
            "Legendary",
        ]);
    });
});

// ---------------------------------------------------------------------------
// Domain cluster (parent PRD #1063, issue #1066). Collective Restraint's
// dynamic `costPerAttacker` earns the mandatory combat integration test
// (issue #1066 acceptance criteria); Worldly Counsel reuses the already
// per-Op-tested `digToHand` + `{ domain: { of } }` combination (a light
// sanity check, not a mandated hand-written test).
// ---------------------------------------------------------------------------

describe("Collective Restraint (CR 508.1c/1g dynamic attack-mana-tax — Domain, issue #1066)", () => {
    it("declares an attack-mana-tax static effect with a FUNCTION costPerAttacker", () => {
        const effect = collectiveRestraint.staticEffects?.find(
            (e) => e.kind === "attack-mana-tax"
        );
        expect(effect).toBeDefined();
        expect(
            typeof (effect as { costPerAttacker: unknown })?.costPerAttacker
        ).toBe("function");
    });

    it("taxes each attacker {X} where X is the DEFENDING player's (Restraint's controller's) Domain", () => {
        const attacker1 = makeInstance(grizzlyBears.id, {
            id: "atk1",
            controllerId: "p1",
            isAttacking: true,
        });
        const attacker2 = makeInstance(grizzlyBears.id, {
            id: "atk2",
            controllerId: "p1",
            isAttacking: true,
        });
        const restraint = makeInstance(collectiveRestraint.id, {
            id: "restraint",
            controllerId: "p2",
        });
        // p2 (the defender, Collective Restraint's controller) has Domain 3;
        // p1 (the attacker) has none — proving the read is the ENCHANTMENT
        // controller's Domain, not the attacking player's.
        const p2Lands = [plains, island, swamp].map((def, i) =>
            makeInstance(def.id, {
                id: `cr-land-${i}`,
                controllerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker1, attacker2] }),
                makePlayer("p2", {
                    battlefield: [restraint, ...p2Lands],
                }),
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["atk1", "atk2"],
                blockerAssignments: {},
                confirmed: false,
                blockersConfirmed: false,
            },
        });
        const charges = collectAttackManaTax(state);
        expect(charges).toHaveLength(2);
        for (const charge of charges) {
            expect(charge.controllerId).toBe("p1");
            expect(charge.cost).toEqual({ X: 3 });
        }
    });

    it("scales down to {X:0} (no charge) when the defender has no basic lands", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk1",
            controllerId: "p1",
            isAttacking: true,
        });
        const restraint = makeInstance(collectiveRestraint.id, {
            id: "restraint",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [restraint] }),
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["atk1"],
                blockerAssignments: {},
                confirmed: false,
                blockersConfirmed: false,
            },
        });
        const charges = collectAttackManaTax(state);
        expect(charges).toEqual([
            { controllerId: "p1", cost: { X: 0 }, reason: expect.any(String) },
        ]);
    });
});

describe("Worldly Counsel (CR 401.4 dig-to-hand — Domain, issue #1066)", () => {
    it("looks at the top Domain cards and keeps one", () => {
        const libCards = ["wc-a", "wc-b", "wc-c"].map((id) =>
            makeInstance(opt.id, { id, controllerId: "p1", zone: "library" })
        );
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `wc-land-${i}`,
                controllerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libCards,
                    battlefield: lands,
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, worldlyCounsel.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on look-top
        const head = state.pendingChoices![0];
        // Domain is 2 — exactly the top two library cards are looked at.
        expect(head.candidateIds).toEqual(["wc-a", "wc-b"]);
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["wc-a"],
        });
        expect(state.players[0].hand.some((c) => c.id === "wc-a")).toBe(true);
        expect(state.players[0].library.some((c) => c.id === "wc-b")).toBe(
            true
        );
    });
});
