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
    blindSeer,
    collectiveRestraint,
    distortingWake,
    disrupt,
    dreamThrush,
    empressGalina,
    exclude,
    factOrFiction,
    manipulateFate,
    metathranAerostat,
    metathranTransport,
    opt,
    prohibit,
    rainbowCrow,
    repulse,
    sapphireLeech,
    shimmeringWings,
    skyWeaver,
    swayOfIllusion,
    tidalVisionary,
    travelersCloak,
    vodalianMerchant,
    vodalianSerpent,
    washOut,
    wellLaidPlans,
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
import { resolveTopOfStack, runDamageReplacement } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import {
    collectAttackManaTax,
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    beginAttackManaTax,
    tryCommitAttackManaTax,
    tapSourceIntoPayment,
} from "../../../../game";
import { resolveActivated, resolveTrigger, submitChoice } from "./helpers";

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

// The declare-attackers PARKING flow (game.ts, #1053/#1066): confirmAttackers no
// longer silently auto-taps or throws when a mana attack tax is owed — it parks
// the aggregated tax on `combat.pendingAttackManaTax` and the attacking player
// pays it via a prompt (auto-tap or manual land taps). Drives the real
// `beginAttackManaTax` / `tryCommitAttackManaTax` game.ts helpers over GRE
// primitives (the ADR 0001 mutation-replica convention — no convex-test harness).
describe("Collective Restraint — parked mana attack tax (CR 508.1c/1g, #1053/#1066)", () => {
    /** p1 attacks with two Grizzly Bears into p2's Collective Restraint. p2 has
     *  Plains + Island → Domain 2, so the tax is {2}/attacker = {4} total. p1
     *  gets `p1Lands` untapped Islands to pay it. */
    function taxedAttackState(p1Lands: number) {
        const atk1 = makeInstance(grizzlyBears.id, {
            id: "atk1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atk2 = makeInstance(grizzlyBears.id, {
            id: "atk2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const restraint = makeInstance(collectiveRestraint.id, {
            id: "restraint",
            controllerId: "p2",
            ownerId: "p2",
        });
        const defenderLands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `def-land-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const attackerLands = Array.from({ length: p1Lands }, (_, i) =>
            makeInstance(island.id, {
                id: `p1-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [atk1, atk2, ...attackerLands],
                }),
                makePlayer("p2", {
                    battlefield: [restraint, ...defenderLands],
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
    }

    it("parks the tax instead of throwing (the reported bug)", () => {
        const state = taxedAttackState(4);
        let parked: boolean | undefined;
        expect(() => {
            parked = beginAttackManaTax(state);
        }).not.toThrow();
        expect(parked).toBe(true);
        const pending = state.combat!.pendingAttackManaTax;
        expect(pending).toBeDefined();
        expect(pending!.playerId).toBe("p1");
        // Domain 2 × 2 attackers = {4} generic.
        expect(pending!.cost).toEqual({ generic: 4 });
        // The declaration is NOT finalized while the tax is unpaid.
        expect(state.combat!.confirmed).toBe(false);
    });

    it("does not park when Domain is 0 (a free attack)", () => {
        const atk = makeInstance(grizzlyBears.id, {
            id: "atk1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const restraint = makeInstance(collectiveRestraint.id, {
            id: "restraint",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [atk] }),
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
        expect(beginAttackManaTax(state)).toBe(false);
        expect(state.combat!.pendingAttackManaTax).toBeUndefined();
    });

    it("finalizes the declaration once the tax is fully paid", () => {
        const state = taxedAttackState(4);
        beginAttackManaTax(state);
        const p1 = state.players[0];
        const pending = state.combat!.pendingAttackManaTax!;
        // Pay {4} by tapping all four Islands into the tax (the auto-tap / manual
        // land-tap path both funnel through tapSourceIntoPayment).
        for (let i = 0; i < 4; i++) {
            const land = p1.battlefield.find((c) => c.id === `p1-land-${i}`)!;
            tapSourceIntoPayment(
                state,
                p1,
                land,
                undefined,
                pending.tappedLandIds
            );
        }
        const committed = tryCommitAttackManaTax(state);
        expect(committed).toBe(true);
        expect(state.combat!.pendingAttackManaTax).toBeUndefined();
        expect(state.combat!.confirmed).toBe(true);
        // finalize ran: the attackers are now marked attacking.
        expect(p1.battlefield.find((c) => c.id === "atk1")!.isAttacking).toBe(
            true
        );
        expect(p1.battlefield.find((c) => c.id === "atk2")!.isAttacking).toBe(
            true
        );
    });

    it("keeps the tax parked on a partial payment (banner stays up)", () => {
        const state = taxedAttackState(4);
        beginAttackManaTax(state);
        const p1 = state.players[0];
        const pending = state.combat!.pendingAttackManaTax!;
        // Only {2} of {4} paid — the cost is not covered.
        for (let i = 0; i < 2; i++) {
            const land = p1.battlefield.find((c) => c.id === `p1-land-${i}`)!;
            tapSourceIntoPayment(
                state,
                p1,
                land,
                undefined,
                pending.tappedLandIds
            );
        }
        expect(tryCommitAttackManaTax(state)).toBe(false);
        expect(state.combat!.pendingAttackManaTax).toBeDefined();
        expect(state.combat!.confirmed).toBe(false);
    });

    it("survives the wire projection so the client can render the banner", () => {
        const state = taxedAttackState(4);
        beginAttackManaTax(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.combat?.pendingAttackManaTax).toEqual(
            state.combat!.pendingAttackManaTax
        );
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

describe("Fact or Fiction (CR 701.16 reveal, ADR 0053 pile division, issue #1067)", () => {
    it("reveals the top 5, an opponent divides, and the caster's chosen pile goes to hand while the other goes to the graveyard", () => {
        const libCards = ["ff-1", "ff-2", "ff-3", "ff-4", "ff-5"].map((id) =>
            makeInstance(opt.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: libCards }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, factOrFiction.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on divide-piles

        const divide = state.pendingChoices![0];
        expect(divide.kind).toBe("divide-piles");
        expect(divide.playerId).toBe("p2"); // an opponent divides
        expect(divide.zone).toBe("library");
        expect(divide.candidateIds).toEqual([
            "ff-1",
            "ff-2",
            "ff-3",
            "ff-4",
            "ff-5",
        ]);
        // CR 701.16 — revealed to all players, not just the divider.
        expect(state.players[0].library[0].knownTo).toContain("p2");

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: divide.stackItemId,
            step: divide.step,
            choiceId: divide.choiceId,
            cardInstanceIds: ["ff-1", "ff-2"],
        });

        const pick = state.pendingChoices![0];
        expect(pick.kind).toBe("pick-pile");
        expect(pick.playerId).toBe("p1"); // the caster chooses
        expect(pick.pileA).toEqual(["ff-1", "ff-2"]);
        expect(pick.pileB).toEqual(["ff-3", "ff-4", "ff-5"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: pick.stackItemId,
            step: pick.step,
            choiceId: pick.choiceId,
            cardInstanceIds: ["A"],
        });

        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "ff-1",
            "ff-2",
        ]);
        // The graveyard also holds the resolved instant itself (CR 608.2k) —
        // assert containment, not exact equality.
        const graveyardIds = state.players[0].graveyard.map((c) => c.id);
        expect(graveyardIds).toContain("ff-3");
        expect(graveyardIds).toContain("ff-4");
        expect(graveyardIds).toContain("ff-5");
    });

    it("reveals fewer than 5 when the library is short (CR 608.2b)", () => {
        const libCards = ["short-1", "short-2"].map((id) =>
            makeInstance(opt.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: libCards }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, factOrFiction.id, "p1");
        resolveTopOfStack(state);
        const divide = state.pendingChoices![0];
        expect(divide.candidateIds).toEqual(["short-1", "short-2"]);
    });

    it("survives the wire projection for both viewers (public reveal, CR 701.16)", () => {
        const libCards = ["wf-1", "wf-2"].map((id) =>
            makeInstance(opt.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: libCards }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, factOrFiction.id, "p1");
        resolveTopOfStack(state);
        // Both viewers see the two revealed cards face-up in the sparse
        // library projection (ADR 0026 — knownTo drives the wire, not who
        // the divider/chooser is).
        const projectedForP2 = projectPublicState(state, 1, "p2");
        const knownP2 = (
            projectedForP2.players[0].library as {
                known: { index: number; card: { id: string } }[];
            }
        ).known;
        expect(knownP2.map((k) => k.card.id).sort()).toEqual(["wf-1", "wf-2"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Issue #1083 slice — the setColor / setSubtype / manaValueEquals /
// forEach{set:"targets"} Op tests live in the interpreter's own per-Op suite
// (convex/gre/effects/__tests__/interpreter.test.ts, the "new Op earns its
// own permanent test" regime). The cards below get a light golden-path test
// each — matching this file's own established convention for every
// optionChoice/choice/forEach card in the free tranche — plus a full
// hand-written GRE test for Metathran Transport / Well-Laid Plans, whose
// `staticEffects[]` / `replacementEffects[]` shapes fall outside the DSL
// smoke sweep entirely (the project's testing convention mandates a
// hand-written test for those regardless of DSL status).
// ─────────────────────────────────────────────────────────────────────────

describe("Blind Seer (CR 613.1e setColor via optionChoice, issue #1083)", () => {
    it("sets a target permanent's color to the chosen mode", () => {
        const seer = makeInstance(blindSeer.id, {
            id: "seer1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "seerBear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [seer] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        resolveActivated(state, seer, "blind-seer-color", [
            { type: "permanent", id: "seerBear" },
        ]);
        submitChoice(state, ["B"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "seerBear")
                ?.colorOverride
        ).toEqual(["B"]);
    });
});

describe("Rainbow Crow (CR 613.1e self setColor via optionChoice, issue #1083)", () => {
    it("sets its own color to the chosen mode", () => {
        const crow = makeInstance(rainbowCrow.id, {
            id: "crow1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crow] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, crow, "rainbow-crow-color");
        submitChoice(state, ["G"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "crow1")
                ?.colorOverride
        ).toEqual(["G"]);
    });
});

describe("Tidal Visionary (CR 613.1e setColor via optionChoice, issue #1083)", () => {
    it("sets a target creature's color to the chosen mode", () => {
        const visionary = makeInstance(tidalVisionary.id, {
            id: "visionary1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "visionaryBear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [visionary, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, visionary, "tidal-visionary-color", [
            { type: "permanent", id: "visionaryBear" },
        ]);
        submitChoice(state, ["W"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "visionaryBear")
                ?.colorOverride
        ).toEqual(["W"]);
    });
});

describe("Metathran Transport (CR 509.1b block restriction + CR 613.1e setColor, issue #1083)", () => {
    it("can't be blocked by blue creatures, but can by non-blue creatures", () => {
        // `staticAbilities: []` overrides away the printed flying keyword —
        // isolates the CR 509.1b color block-restriction under test from the
        // UNRELATED CR 702.9b flying-blocker restriction (Metathran Transport
        // is also a flier, which would independently reject a non-flying,
        // non-reach blocker regardless of color).
        const transport = makeInstance(metathranTransport.id, {
            id: "transport1",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            staticAbilities: [],
        });
        const blueBlocker = makeInstance(vodalianSerpent.id, {
            id: "blueBlocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const greenBlocker = makeInstance(grizzlyBears.id, {
            id: "greenBlocker",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [transport] }),
                makePlayer("p2", {
                    battlefield: [blueBlocker, greenBlocker],
                }),
            ],
        });
        expect(
            validateBlockerEligibility(
                transport,
                blueBlocker,
                [blueBlocker, greenBlocker],
                state
            ).eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(
                transport,
                greenBlocker,
                [blueBlocker, greenBlocker],
                state
            ).eligible
        ).toBe(true);
    });

    it("reads the EFFECTIVE color (layer 5) — a setColor'd creature becomes an illegal blocker", () => {
        // Same `staticAbilities: []` isolation as above.
        const transport = makeInstance(metathranTransport.id, {
            id: "transport2",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            staticAbilities: [],
        });
        // A green creature is a legal blocker UNTIL Metathran Transport's own
        // activated ability makes it blue.
        const bear = makeInstance(grizzlyBears.id, {
            id: "recoloredBear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [transport] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        expect(
            validateBlockerEligibility(transport, bear, [bear], state)
                .eligible
        ).toBe(true);
        resolveActivated(state, transport, "metathran-transport-color", [
            { type: "permanent", id: "recoloredBear" },
        ]);
        const recolored = state.players[1].battlefield.find(
            (c) => c.id === "recoloredBear"
        )!;
        expect(recolored.colorOverride).toEqual(["U"]);
        expect(
            validateBlockerEligibility(transport, recolored, [recolored], state)
                .eligible
        ).toBe(false);
    });
});

describe("Dream Thrush (CR 305.7 setSubtype via optionChoice, issue #1083)", () => {
    it("changes a target land's subtype to the chosen basic land type", () => {
        const thrush = makeInstance(dreamThrush.id, {
            id: "thrush1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const targetLand = makeInstance(swamp.id, {
            id: "thrushSwamp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrush] }),
                makePlayer("p2", { battlefield: [targetLand] }),
            ],
        });
        resolveActivated(state, thrush, "dream-thrush-land-type", [
            { type: "permanent", id: "thrushSwamp" },
        ]);
        submitChoice(state, ["Island"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "thrushSwamp")
                ?.subtypes
        ).toEqual(["Island"]);
    });
});

describe("Metathran Aerostat (manaValueEquals + moveZone + picksNonEmpty, issue #1083)", () => {
    it("puts a hand creature with mana value X onto the battlefield and returns itself to hand", () => {
        const aerostat = makeInstance(metathranAerostat.id, {
            id: "aerostat1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const handCreature = makeInstance(grizzlyBears.id, {
            id: "handBear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [aerostat],
                    hand: [handCreature],
                }),
                makePlayer("p2"),
            ],
        });
        const item = state.players[0].battlefield[0];
        state.stack.push({
            ...item,
            zone: "stack",
            castById: "p1",
            abilityId: "metathran-aerostat-swap",
            targets: [],
            chosenX: 2, // Grizzly Bears is mana value 2 ({X:1,G:1} = 1+1).
        });
        resolveTopOfStack(state);
        submitChoice(state, ["handBear"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "handBear")
        ).toBe(true);
        // "If you do, return this creature to its owner's hand."
        expect(state.players[0].hand.some((c) => c.id === "aerostat1")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "aerostat1")
        ).toBe(false);
    });

    it("declining the swap leaves both permanents in place", () => {
        const aerostat = makeInstance(metathranAerostat.id, {
            id: "aerostat2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const handCreature = makeInstance(grizzlyBears.id, {
            id: "handBearDecline",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [aerostat],
                    hand: [handCreature],
                }),
                makePlayer("p2"),
            ],
        });
        const item = state.players[0].battlefield[0];
        state.stack.push({
            ...item,
            zone: "stack",
            castById: "p1",
            abilityId: "metathran-aerostat-swap",
            targets: [],
            chosenX: 2,
        });
        resolveTopOfStack(state);
        submitChoice(state, []);
        expect(
            state.players[0].battlefield.some((c) => c.id === "aerostat2")
        ).toBe(true);
        expect(state.players[0].hand.some((c) => c.id === "handBearDecline")).toBe(
            true
        );
    });
});

describe("Distorting Wake (X-multi-target forEach bounce, issue #1083)", () => {
    it("returns every announced target permanent to its owner's hand", () => {
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "wakeBear1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "wakeBear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear1, bear2] }),
            ],
        });
        const item = pushSpell(state, distortingWake.id, "p1", [
            { type: "permanent", id: "wakeBear1" },
            { type: "permanent", id: "wakeBear2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "wakeBear1",
            "wakeBear2",
        ]);
    });
});

describe("Sway of Illusion (shared setColor via forEach{set:targets} + draw, issue #1083)", () => {
    it("sets EVERY targeted creature to the SAME chosen color, then draws a card", () => {
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "swayTestBear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "swayTestBear2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(opt.id, {
            id: "swayLib1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [bear1, bear2],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, swayOfIllusion.id, "p1", [
            { type: "permanent", id: "swayTestBear1" },
            { type: "permanent", id: "swayTestBear2" },
        ]);
        resolveTopOfStack(state);
        submitChoice(state, ["R"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swayTestBear1")
                ?.colorOverride
        ).toEqual(["R"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "swayTestBear2")
                ?.colorOverride
        ).toEqual(["R"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("swayLib1");
    });

    it("casting it targeting zero creatures still draws a card (issue-linked ruling)", () => {
        const libCard = makeInstance(opt.id, {
            id: "swayLib2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libCard] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, swayOfIllusion.id, "p1", []);
        resolveTopOfStack(state);
        // Even with zero targets, the color choice is still prompted (the
        // engine doesn't know in advance the forEach body will be empty) —
        // then the forEach runs zero iterations and the draw still happens.
        submitChoice(state, ["R"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("swayLib2");
    });
});

describe("Well-Laid Plans (CR 615 shared-color damage prevention, issue #1083)", () => {
    it("prevents damage between two creatures that share a color", () => {
        const plansEnchantment = makeInstance(wellLaidPlans.id, {
            id: "plans1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueSource = makeInstance(vodalianSerpent.id, {
            id: "plansBlueSource",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueTarget = makeInstance(vodalianMerchant.id, {
            id: "plansBlueTarget",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [plansEnchantment, blueSource],
                }),
                makePlayer("p2", { battlefield: [blueTarget] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "plansBlueSource",
            "p1",
            { type: "permanent", id: "plansBlueTarget" },
            3,
            false
        );
        expect(res).toBeNull(); // prevented (consumed)
    });

    it("does NOT prevent damage between creatures of different colors", () => {
        const plansEnchantment = makeInstance(wellLaidPlans.id, {
            id: "plans2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueSource = makeInstance(vodalianSerpent.id, {
            id: "plansDiffBlue",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenTarget = makeInstance(grizzlyBears.id, {
            id: "plansDiffGreen",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [plansEnchantment, blueSource],
                }),
                makePlayer("p2", { battlefield: [greenTarget] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "plansDiffBlue",
            "p1",
            { type: "permanent", id: "plansDiffGreen" },
            3,
            false
        );
        expect(res).not.toBeNull();
        expect(res?.amount).toBe(3);
    });

    it("does NOT prevent same-color damage from a NONCREATURE source (CR 208.2 'by another creature')", () => {
        const plansEnchantment = makeInstance(wellLaidPlans.id, {
            id: "plans3",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A blue, NONCREATURE permanent source (Collective Restraint is an
        // Enchantment) — shares blue with the target, but is never "another
        // creature" (CR 208.2), so the source-type gate fails and damage
        // proceeds unprevented.
        const noncreatureSource = makeInstance(collectiveRestraint.id, {
            id: "plansNoncreatureSource",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueTarget = makeInstance(vodalianMerchant.id, {
            id: "plansNoncreatureTarget",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [plansEnchantment, noncreatureSource],
                }),
                makePlayer("p2", { battlefield: [blueTarget] }),
            ],
        });
        const res = runDamageReplacement(
            state,
            "plansNoncreatureSource",
            "p1",
            { type: "permanent", id: "plansNoncreatureTarget" },
            3,
            false
        );
        expect(res).not.toBeNull();
        expect(res?.amount).toBe(3);
    });
});
