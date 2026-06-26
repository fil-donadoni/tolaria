// Ice Age (ICE) — multicolor card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    fireCovenant,
    fieryJustice,
    diabolicVision,
    elementalAugury,
    glaciers,
    skeletonShip,
    altarOfBone,
    centaurArcher,
    essenceVortex,
    giantTrapDoorSpider,
    spectralShield,
    stormSpirit,
    wingsOfAesthir,
    moorFiend,
    stormbind,
    islandIce,
    forestIce,
    earthlink,
    kjeldoranFrostbeast,
    meriekeRiBerit,
    monsoon,
    mountainTitan,
    ghostlyFlame,
} from "../../ice";
import { getCardById, getCardByName } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { describeDamageSource } from "../../../../gre/replacements";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { projectPublicState } from "../../../../gameProjections";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { getLegalTargets } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    answerMayPay,
    PHASE_EVENT,
    PHASE_EVENT_EOC,
    makeTargetCreature,
} from "./helpers";

// --- Diabolic Vision / Elemental Augury (library look, CR 401) -------------

describe("Diabolic Vision (look top five, CR 401)", () => {
    it("is a sorcery with a resolve body", () => {
        expect(diabolicVision.types).toEqual(["Sorcery"]);
        expect(typeof diabolicVision.resolve).toBe("function");
    });
});

describe("Elemental Augury ({3}: look top three of target player, CR 401)", () => {
    it("activated ability targets a player and costs {3}", () => {
        const ability = elementalAugury.activatedAbilities!.find(
            (a) => a.id === "elemental-augury-look"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "player" });
        expect(ability.cost).toMatchObject({ mana: { X: 3 } });
    });
});

describe("Storm Spirit ({T}: 2 damage to a creature, CR 120.1)", () => {
    it("is a flier with a tap-to-zap ability", () => {
        expect(stormSpirit.staticAbilities).toEqual(["flying"]);
        const ability = stormSpirit.activatedAbilities!.find(
            (a) => a.id === "storm-spirit-zap"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "Creature" });
    });
    it("deals 2 damage to the target creature", () => {
        const spirit = makeInstance(stormSpirit.id, {
            id: "storm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, spirit, "storm-spirit-zap", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "v")!;
        expect(live.damageMarked ?? 0).toBe(2);
    });
});

// --- Skeleton Ship ({T}: -1/-1 counter + no-Islands sac, CR 122 / 603.8) ---

describe("Skeleton Ship (-1/-1 counter, CR 122 / layer 7d)", () => {
    function setup() {
        const ship = makeInstance(skeletonShip.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ship] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, victim };
    }
    it("puts a -1/-1 counter on the target creature, shrinking it", () => {
        const { state } = setup();
        const ship = state.players[0].battlefield.find((c) => c.id === "ship")!;
        resolveActivated(state, ship, "skeleton-ship-weaken", [
            { type: "permanent", id: "victim" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(live.counters?.["-1/-1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
    it("wire format: the shrink survives projectPublicState", () => {
        const { state } = setup();
        const ship = state.players[0].battlefield.find((c) => c.id === "ship")!;
        resolveActivated(state, ship, "skeleton-ship-weaken", [
            { type: "permanent", id: "victim" },
        ]);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

// --- Auras (static buffs + grants, CR 611/613) -----------------------------

describe("Wings of Aesthir (Aura +1/+0 + flying + first strike, CR 611/613)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(wingsOfAesthir.id, {
            id: "wings",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("grants +1/+0 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });
    it("wire format: the +1/+0 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
    it("declares flying + first strike keyword grants", () => {
        const keywords = (wingsOfAesthir.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(keywords).toEqual(["flying", "first strike"]);
    });
});

describe("Spectral Shield (Aura +0/+2 + can't be targeted by spells, CR 113.3)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(spectralShield.id, {
            id: "shield",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }
    it("grants +0/+2 to the enchanted creature", () => {
        const { state } = setup();
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectiveToughness(state, host)).toBe(4);
    });
    it("wire format: the +0/+2 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
    it("declares a spells-only targeting guard", () => {
        const guard = (spectralShield.staticEffects ?? []).find(
            (e) => e.kind === "permanent-guard"
        );
        expect(guard).toMatchObject({
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
        });
    });
});

// --- Multicolour free tranche (#635) ---------------------------------------

describe("Altar of Bone (sac-creature additional cost + tutor to hand, CR 117.9 / 701.19)", () => {
    it("declares the sacrifice additional cost and a resolve body", () => {
        expect(altarOfBone.types).toEqual(["Sorcery"]);
        expect(altarOfBone.additionalCosts).toMatchObject({
            sacrificeFilter: { types: "Creature", controllerRelation: "you" },
        });
        expect(typeof altarOfBone.resolve).toBe("function");
    });
    it("searches a creature card into hand and shuffles the library", () => {
        const creature = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "tutored",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const noncreature = makeInstance(getCardByName("Brainstorm").id, {
            id: "noncreature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [creature, noncreature] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, altarOfBone.id, "p1", []);
        resolveTopOfStack(state);
        // The search suspends; only the creature is a legal candidate.
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["tutored"]);
        submitChoice(state, ["tutored"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("tutored");
        expect(state.players[0].library.some((c) => c.id === "tutored")).toBe(
            false
        );
    });
});

describe("Centaur Archer ({T}: 1 damage to a flyer, CR 605 / 120.1)", () => {
    it("only flyers are legal targets (requireAbility)", () => {
        const flyer = makeInstance(getCardByName("Serra Angel").id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ground = vanilla("ground", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [flyer, ground] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            centaurArcher.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("flyer");
        expect(legal).not.toContain("ground");
    });
    it("deals 1 damage to the targeted flyer", () => {
        const archer = makeInstance(centaurArcher.id, {
            id: "archer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = vanilla("flyer", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [archer] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, archer, "centaur-archer-ping", [
            { type: "permanent", id: "flyer" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(live.damageMarked ?? 0).toBe(1);
    });
    it("wire format: the damage survives projectPublicState", () => {
        const archer = makeInstance(centaurArcher.id, {
            id: "archer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = vanilla("flyer", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [archer] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, archer, "centaur-archer-ping", [
            { type: "permanent", id: "flyer" },
        ]);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(slim.damageMarked ?? 0).toBe(1);
    });
});

describe("Essence Vortex (destroy unless pay life = toughness, CR 118.4 / 701.15a)", () => {
    function answerMayPay(state: GameState, accept: boolean): void {
        // applyMayPaySubmit commits the answer and re-resumes the suspended
        // resolution itself when the choice queue empties — no extra resolve.
        const head = state.pendingChoices![0];
        applyMayPaySubmit(state, { playerId: head.playerId, accept });
    }
    function setup(toughness: number, life = 20) {
        const victim = vanilla("v", 2, toughness, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim], life }),
            ],
        });
        return state;
    }
    it("paying life equal to toughness keeps the creature", () => {
        const state = setup(3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state); // suspends at the controller's may-pay
        answerMayPay(state, true);
        expect(state.players[1].battlefield.some((c) => c.id === "v")).toBe(
            true
        );
        expect(state.players[1].life).toBe(17);
    });
    it("declining destroys the creature (can't be regenerated)", () => {
        const state = setup(3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        answerMayPay(state, false);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
        expect(state.players[1].life).toBe(20);
    });
    it("destroys outright when the controller cannot afford the life (CR 118.4)", () => {
        const state = setup(5, 3);
        pushSpell(state, essenceVortex.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        // No may-pay was offered — the creature is already gone.
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(3);
    });
});

describe("Giant Trap Door Spider ({1}{R}{G},{T}: exile self + attacker, CR 605 / 118.5)", () => {
    it("only non-flying attackers are legal targets", () => {
        const groundAttacker = vanilla("ground", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const flyingAttacker = vanilla("flyer", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
            staticAbilities: ["flying"],
        });
        const idleGround = vanilla("idle", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [groundAttacker, flyingAttacker, idleGround],
                }),
            ],
        });
        const legal = getLegalTargets(
            state,
            giantTrapDoorSpider.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("ground");
        expect(legal).not.toContain("flyer"); // flying excluded
        expect(legal).not.toContain("idle"); // not attacking
    });
    it("exiles both the spider and the targeted attacker", () => {
        const spider = makeInstance(giantTrapDoorSpider.id, {
            id: "spider",
            controllerId: "p1",
            ownerId: "p1",
        });
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spider] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, spider, "giant-trap-door-spider-exile", [
            { type: "permanent", id: "atk" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "spider")
        ).toBeUndefined();
        expect(state.players[0].exile.some((c) => c.id === "spider")).toBe(
            true
        );
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
        ).toBeUndefined();
        expect(state.players[1].exile.some((c) => c.id === "atk")).toBe(true);
    });
});

// --- Glaciers (subtype-set + upkeep tax, CR 305.7) -------------------------

describe("Glaciers (All Mountains are Plains, CR 305.7)", () => {
    it("replaces Mountain subtypes with Plains via a subtype-set static", () => {
        const effect = (glaciers.staticEffects ?? []).find(
            (e) => e.kind === "subtype-set"
        )!;
        expect(effect).toMatchObject({ subtypes: ["Plains"] });
    });
});

// --- Stormbind (R/G enchantment, discard-at-random cost) -------------------

describe("Stormbind (CR 605 activated, discard-at-random cost)", () => {
    it("the {2}, discard cost deals 2 damage to any target", () => {
        const ability = stormbind.activatedAbilities![0];
        expect(ability.cost).toMatchObject({
            mana: { X: 2 },
            discardAtRandom: 1,
        });
        expect(ability.targetRequirement).toMatchObject({ type: "any" });
    });
});

// ---------------------------------------------------------------------------
// Gold / miscellaneous buildable-now completion (#659)
// ---------------------------------------------------------------------------

describe("Earthlink — upkeep pay {2} or sac + dies→sac-land (CR 603.6a / 603.2 / 701.16)", () => {
    it("paying {2} at upkeep keeps Earthlink on the battlefield", () => {
        const link = makeInstance(earthlink.id, {
            id: "link",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [link] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        state.players[0].manaPool = { C: 2 }; // enough to pay {2}
        resolveTrigger(
            state,
            link,
            "earthlink-upkeep",
            PHASE_EVENT("UPKEEP", "p1")
        );
        answerMayPay(state, true); // pay {2}
        expect(state.players[0].battlefield.some((c) => c.id === "link")).toBe(
            true
        );
    });

    it("declining the {2} sacrifices Earthlink", () => {
        const link = makeInstance(earthlink.id, {
            id: "link",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [link] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(
            state,
            link,
            "earthlink-upkeep",
            PHASE_EVENT("UPKEEP", "p1")
        );
        answerMayPay(state, false); // decline → sacrifice
        expect(state.players[0].battlefield.some((c) => c.id === "link")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "link")).toBe(
            true
        );
    });

    it("when a creature dies, its controller sacrifices a land of their choice", () => {
        const link = makeInstance(earthlink.id, {
            id: "link",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forestIce.printId, {
            id: "p2-forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [link] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveTrigger(state, link, "earthlink-dies-sac-land", {
            type: "CREATURE_DIED",
            creatureInstanceId: "dead",
            creatureControllerId: "p2",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        } as StackItem["triggerEvent"]);
        // p2 (the dead creature's controller) chooses which land to sacrifice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("sacrifice-permanents");
        expect(head.playerId).toBe("p2");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["p2-forest"],
        });
        expect(
            state.players[1].battlefield.some((c) => c.id === "p2-forest")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "p2-forest")
        ).toBe(true);
    });
});

describe("Kjeldoran Frostbeast — end-of-combat destroy blockers/blocked-by (CR 511.3 / 701.7)", () => {
    function combatState(frostbeastAttacks: boolean) {
        const frostbeast = makeInstance(kjeldoranFrostbeast.id, {
            id: "frost",
            controllerId: "p1",
            ownerId: "p1",
        });
        const partner = vanilla("partner", 5, 5, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const blockerAssignments: Record<string, string[]> = frostbeastAttacks
            ? { frost: ["partner"] } // frost attacks, partner blocks it
            : { partner: ["frost"] }; // partner attacks, frost blocks it
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [frostbeast] }),
                makePlayer("p2", { battlefield: [partner] }),
            ],
            combat: {
                attackerIds: [frostbeastAttacks ? "frost" : "partner"],
                confirmed: true,
                blockerAssignments,
                blockedAttackerIds: [frostbeastAttacks ? "frost" : "partner"],
                blockersConfirmed: true,
            },
        });
        return { state, frostbeast };
    }

    it("destroys the creature blocking Frostbeast (Frostbeast attacking)", () => {
        const { state, frostbeast } = combatState(true);
        resolveTrigger(
            state,
            frostbeast,
            "kjeldoran-frostbeast-end-of-combat",
            PHASE_EVENT_EOC("p1")
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "partner")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "partner")).toBe(
            true
        );
    });

    it("destroys the attacker Frostbeast blocked (Frostbeast blocking)", () => {
        const { state, frostbeast } = combatState(false);
        resolveTrigger(
            state,
            frostbeast,
            "kjeldoran-frostbeast-end-of-combat",
            PHASE_EVENT_EOC("p1")
        );
        expect(
            state.players[1].battlefield.some((c) => c.id === "partner")
        ).toBe(false);
    });
});

describe("Merieke Ri Berit — does-not-untap + {T} gain control + destroy-on-leave (CR 502.1 / 613.1b / 603.10)", () => {
    it("carries the does-not-untap keyword", () => {
        expect(meriekeRiBerit.staticAbilities).toContain("does-not-untap");
    });

    function setup() {
        const merieke = makeInstance(meriekeRiBerit.id, {
            id: "merieke",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [merieke] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, merieke, victim };
    }

    it("{T} gains control of the target creature", () => {
        const { state } = setup();
        const merieke = state.players[0].battlefield.find(
            (c) => c.id === "merieke"
        )!;
        resolveActivated(state, merieke, "merieke-ri-berit-steal", [
            { type: "permanent", id: "victim" },
        ]);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(stolen?.controllerId).toBe("p1");
    });

    it("destroys the stolen creature when Merieke leaves the battlefield", () => {
        const { state } = setup();
        const merieke = state.players[0].battlefield.find(
            (c) => c.id === "merieke"
        )!;
        resolveActivated(state, merieke, "merieke-ri-berit-steal", [
            { type: "permanent", id: "victim" },
        ]);
        const meriekeLive = state.players[0].battlefield.find(
            (c) => c.id === "merieke"
        )!;
        resolveTrigger(state, meriekeLive, "merieke-ri-berit-on-leave", {
            type: "PERMANENT_LEFT",
            instanceId: "merieke",
            controllerId: "p1",
            ownerId: "p1",
        } as StackItem["triggerEvent"]);
        // The stolen creature is destroyed (and reverts to its owner first via
        // the conditional-control SBA); it ends up in p2's graveyard.
        const anyBoard = state.players.some((p) =>
            p.battlefield.some((c) => c.id === "victim")
        );
        expect(anyBoard).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });
});

describe("Monsoon — each end step: tap Islands + damage = count (CR 603.6a / 701.20a / 120.1)", () => {
    function makeIsland(id: string, controllerId: string) {
        return makeInstance(islandIce.printId, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    it("taps the player's untapped Islands and deals damage equal to the count", () => {
        const monsoonPerm = makeInstance(monsoon.id, {
            id: "monsoon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const i1 = makeIsland("i1", "p2");
        const i2 = makeIsland("i2", "p2");
        const alreadyTapped = makeIsland("i3", "p2");
        alreadyTapped.isTapped = true;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monsoonPerm] }),
                makePlayer("p2", {
                    battlefield: [i1, i2, alreadyTapped],
                    life: 20,
                }),
            ],
        });
        resolveTrigger(
            state,
            monsoonPerm,
            "monsoon-end-step",
            PHASE_EVENT("END_STEP", "p2")
        );
        // Only the two untapped Islands are tapped this way → 2 damage.
        expect(
            state.players[1].battlefield.find((c) => c.id === "i1")?.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "i2")?.isTapped
        ).toBe(true);
        expect(state.players[1].life).toBe(18);
    });

    it("deals no damage when the player controls no untapped Islands", () => {
        const monsoonPerm = makeInstance(monsoon.id, {
            id: "monsoon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monsoonPerm] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveTrigger(
            state,
            monsoonPerm,
            "monsoon-end-step",
            PHASE_EVENT("END_STEP", "p2")
        );
        expect(state.players[1].life).toBe(20);
    });
});

describe("Mountain Titan — arms an until-EOT black-cast +1/+1 rider (CR 605 / 611.1b / 122.1)", () => {
    it("the activated ability grants the cast-watch rider to self until end of turn", () => {
        const titan = makeInstance(mountainTitan.id, {
            id: "titan",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [titan] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, titan, "mountain-titan-arm-cast-watch");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "titan"
        )!;
        const triggers = effectiveTriggeredAbilities(live);
        expect(
            triggers.some((t) => t.id === "mountain-titan-black-cast-rider")
        ).toBe(true);
    });

    it("the rider adds a +1/+1 counter when you cast a black spell", () => {
        const titan = makeInstance(mountainTitan.id, {
            id: "titan",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [titan] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, titan, "mountain-titan-arm-cast-watch");
        const titanLive = state.players[0].battlefield.find(
            (c) => c.id === "titan"
        )!;
        resolveTrigger(state, titanLive, "mountain-titan-black-cast-rider", {
            type: "SPELL_CAST",
            casterId: "p1",
            spellInstanceId: "some-black-spell",
            spellCardId: "fake-black",
            spellTypes: ["Sorcery"],
            spellSubtypes: [],
            spellColors: ["B"],
        } as StackItem["triggerEvent"]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "titan"
        )!;
        expect(live.counters?.["+1/+1"] ?? 0).toBe(1);
        // The buff is visible on the board (wire format): power/toughness up.
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "titan"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Fire Covenant ({1}{B}{R} — pay X life, X damage divided as you choose among target creatures, CR 601.2b / 601.2d / 120.4)", () => {
    function setup(targetIds: string[]): GameState {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: targetIds.map((id) => makeTargetCreature(id)),
                }),
            ],
        });
    }

    it("has no variable X in its mana cost ({1}{B}{R}); the {1} is numeric generic", () => {
        // The variable X (the life) lives in additionalCosts.payXLife, NOT the
        // mana cost. The {1} is numeric generic (X: 1), not the string "X".
        expect(fireCovenant.manaCost).toEqual({ X: 1, B: 1, R: 1 });
        expect(typeof (fireCovenant.manaCost as { X?: unknown }).X).toBe(
            "number"
        );
        expect(fireCovenant.additionalCosts?.payXLife).toBe(true);
        expect(fireCovenant.targetRequirement?.divideAsChosen).toEqual({
            total: "X",
        });
    });

    it("divides an UNEVEN chosen split summing to X across the targets", () => {
        // X = 5 split 4/1 across two targets (an uneven, legal split). The
        // amounts are snapshotted on the stack item as the engine would after
        // selectTarget.
        const state = setup(["a", "b"]);
        const item = pushSpell(state, fireCovenant.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 5;
        item.targetAmounts = { "permanent:a": 4, "permanent:b": 1 };
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        const b = state.players[1].battlefield.find((c) => c.id === "b")!;
        // 4 + 1 = 5 marked total; toughness 5 so both survive (verifies the
        // exact split, not just lethality).
        expect(a.damageMarked).toBe(4);
        expect(b.damageMarked).toBe(1);
    });

    it("respects the ≥1-each rule and sums to the total when amounts are absent (auto-divide fallback)", () => {
        // No explicit split → deterministic ≥1-each division of 5 across 2
        // targets: 3 / 2 (remainder front-loaded). Sums to 5; each ≥ 1.
        const state = setup(["a", "b"]);
        const item = pushSpell(state, fireCovenant.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        const b = state.players[1].battlefield.find((c) => c.id === "b")!;
        expect(a.damageMarked).toBe(3);
        expect(b.damageMarked).toBe(2);
        expect((a.damageMarked ?? 0) + (b.damageMarked ?? 0)).toBe(5);
    });

    it("deals the whole total to a single target", () => {
        const state = setup(["a"]);
        state.players[1].battlefield[0].toughness = 3;
        const item = pushSpell(state, fireCovenant.id, "p1", [
            { type: "permanent", id: "a" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        // 4 damage ≥ toughness 3 → dies.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });

    it("pays X life and writes targetAmounts through the real cast commit (finalizeTargetSelection)", () => {
        // Integration: drive the actual cost/commit path. The caster has the
        // mana in pool; finalizeTargetSelection pays the life and pushes the
        // spell with the split.
        const state = setup(["a", "b"]);
        const p1 = state.players[0];
        p1.life = 20;
        p1.manaPool = { W: 0, U: 0, B: 1, R: 1, G: 0, C: 1 };
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "fc-1",
            targetType: "Creature",
            count: { min: 1, max: 3 },
            selected: [
                { type: "permanent", id: "a" },
                { type: "permanent", id: "b" },
            ],
            chosenX: 3,
            divideTotal: 3,
            divideAmounts: { "permanent:a": 2, "permanent:b": 1 },
        };
        // Put the card in hand so removeFromZone finds it.
        p1.hand.push(
            makeInstance(fireCovenant.id, {
                id: "fc-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        // 3 life paid.
        expect(state.players[0].life).toBe(17);
        const item = state.stack[state.stack.length - 1];
        expect(item.targetAmounts).toEqual({
            "permanent:a": 2,
            "permanent:b": 1,
        });
        expect(item.chosenX).toBe(3);
    });

    it("wire format: the divided damage survives projectPublicState", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, fireCovenant.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 5;
        item.targetAmounts = { "permanent:a": 4, "permanent:b": 1 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const a = projected.players[1].battlefield.find((c) => c.id === "a")!;
        const b = projected.players[1].battlefield.find((c) => c.id === "b")!;
        expect(a.damageMarked).toBe(4);
        expect(b.damageMarked).toBe(1);
    });
});

describe("Fiery Justice ({R}{G}{W} — 5 damage divided as you choose; target opponent gains 5 life, CR 601.2d / 120.4)", () => {
    function setup(targetIds: string[]): GameState {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: targetIds.map((id) => makeTargetCreature(id)),
                }),
            ],
        });
    }

    it("declares a fixed total of 5 and {R}{G}{W}", () => {
        expect(fieryJustice.manaCost).toEqual({ R: 1, G: 1, W: 1 });
        expect(fieryJustice.targetRequirement?.divideAsChosen).toEqual({
            total: 5,
        });
    });

    it("divides 5 unevenly across targets and the opponent gains 5 life", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, fieryJustice.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.targetAmounts = { "permanent:a": 1, "permanent:b": 4 };
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        const b = state.players[1].battlefield.find((c) => c.id === "b")!;
        expect(a.damageMarked).toBe(1);
        expect(b.damageMarked).toBe(4);
        // p2 is the opponent → gains 5 life.
        expect(state.players[1].life).toBe(25);
    });

    it("can put all 5 on a single target (sums to total)", () => {
        const state = setup(["a"]);
        state.players[1].battlefield[0].toughness = 6; // survives 5 damage
        pushSpell(state, fieryJustice.id, "p1", [
            { type: "permanent", id: "a" },
        ]);
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        expect(a.damageMarked).toBe(5);
        expect(state.players[1].life).toBe(25);
    });

    it("wire format: damage + opponent lifegain survive projection", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, fieryJustice.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.targetAmounts = { "permanent:a": 2, "permanent:b": 3 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const a = projected.players[1].battlefield.find((c) => c.id === "a")!;
        const b = projected.players[1].battlefield.find((c) => c.id === "b")!;
        expect(a.damageMarked).toBe(2);
        expect(b.damageMarked).toBe(3);
        expect(projected.players[1].life).toBe(25);
    });
});

describe("Ghostly Flame (damage-source colour override, CR 119.4 / 614)", () => {
    it("is a {B}{R} Enchantment (pure data — engine seam)", () => {
        expect(ghostlyFlame.manaCost).toEqual({ B: 1, R: 1 });
        expect(ghostlyFlame.types).toEqual(["Enchantment"]);
        expect(ghostlyFlame.oracleText).toBe(
            "Black and/or red permanents and spells are colorless sources of damage."
        );
        expect(ghostlyFlame.triggeredAbilities).toBeUndefined();
    });

    it("registers by id and name", () => {
        expect(getCardById(ghostlyFlame.id)).toBe(ghostlyFlame);
        expect(getCardByName("Ghostly Flame")).toBe(ghostlyFlame);
    });

    it("a black source is coloured B without Ghostly Flame, colourless with it", () => {
        const blackSrc = makeInstance(moorFiend.id, {
            id: "blk",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Without Ghostly Flame: the source is black.
        const noFlame = makeState({
            players: [
                makePlayer("p1", { battlefield: [blackSrc] }),
                makePlayer("p2"),
            ],
        });
        expect(describeDamageSource(noFlame, "blk").colors).toEqual(["B"]);

        // With Ghostly Flame in play: the same source is colourless for damage.
        const flame = makeInstance(ghostlyFlame.id, {
            id: "flame",
            controllerId: "p1",
            ownerId: "p1",
        });
        const withFlame = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(moorFiend.id, {
                            id: "blk",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        flame,
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(describeDamageSource(withFlame, "blk").colors).toEqual([]);
    });

    it("leaves a non-black/red source unaffected", () => {
        // forest is a colourless land (no mana cost) — already colourless;
        // assert Ghostly Flame doesn't invent colours or break it.
        const greenCreature = makeInstance(balduvianBears.id, {
            id: "grn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flame = makeInstance(ghostlyFlame.id, {
            id: "flame",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [greenCreature, flame] }),
                makePlayer("p2"),
            ],
        });
        // Balduvian Bears is {1}{G} → green. Not black/red, so unchanged.
        expect(describeDamageSource(state, "grn").colors).toEqual(["G"]);
    });
});
