// Ice Age (ICE) — multicolor card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    fireCovenant,
    fieryJustice,
    skeletonShip,
    altarOfBone,
    centaurArcher,
    essenceVortex,
    giantTrapDoorSpider,
    spectralShield,
    stormSpirit,
    wingsOfAesthir,
    moorFiend,
    islandIce,
    forestIce,
    earthlink,
    kjeldoranFrostbeast,
    meriekeRiBerit,
    monsoon,
    mountainTitan,
    ghostlyFlame,
    fumarole,
    floodedWoodlands,
    reclamation,
    chromaticArmor,
    knightOfStromgald,
    seaSpirit,
    glaciers,
    diabolicVision,
    elementalAugury,
} from "../../ice";
import { mountain, grizzlyBears, scatheZombies } from "../../lea";
import { collectAttackSacrificeTax } from "../../../../gre/combat";
import {
    sacrificeCandidates,
    autoResolveFungible,
    isSacrificeSelectionComplete,
    applySacrificeSelection,
    type SacrificeSelection,
} from "../../../../gre/sacrificeChoice";
import type { PermanentFilter } from "../../../filters";
import { isLand, getBasicLandMana } from "../../../../gre/constants";
import { getDefinition, getCardByName } from "../../../index";
import {
    resolveTopOfStack,
    runDamageReplacement,
    applySourceStaticEffects,
} from "../../../../gre/state";
import { resolveAbilityManaCost } from "../../../../game";
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
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import {
    finalizeTargetSelection,
    advanceTargetGroupOrFinalize,
} from "../../../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { GameState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { PendingTarget } from "../../../../gre/state";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    answerMayPay,
    PHASE_EVENT,
    PHASE_EVENT_EOC,
    makeTargetCreature,
    library,
} from "./helpers";

describe("Storm Spirit ({T}: 2 damage to a creature, CR 120.1)", () => {
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
});

// --- Multicolour free tranche (#635) ---------------------------------------

describe("Altar of Bone (sac-creature additional cost + tutor to hand, CR 117.9 / 701.19)", () => {
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
            NO_TARGETING_SOURCE,
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
            NO_TARGETING_SOURCE,
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
    it("registers by id and name", () => {
        expect(getDefinition(ghostlyFlame.id)).toBe(ghostlyFlame);
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

// --- Fumarole (dual-target destroy + fixed pay-life, CR 601.2b/601.2c/701.7) --

describe("Fumarole ({3}{B}{R} — destroy target creature AND target land, pay 3 life; CR 601.2b/601.2c/701.7 — issue #737)", () => {
    it("keeps the two target groups independent — creatures for group 0, lands for group 1 (CR 601.2c)", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, land] }),
            ],
        });
        const creatures = getLegalTargets(
            state,
            fumarole.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const lands = getLegalTargets(
            state,
            fumarole.additionalTargetRequirements![0],
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = (ts: typeof creatures) =>
            ts.filter((t) => "id" in t).map((t) => (t as { id: string }).id);
        expect(ids(creatures)).toContain("bear");
        expect(ids(creatures)).not.toContain("land");
        expect(ids(lands)).toContain("land");
        expect(ids(lands)).not.toContain("bear");
    });

    it("advances from the creature group to the land group instead of finalizing (CR 601.2c)", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear, land] }),
            ],
        });
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "fum",
            targetType: "Creature",
            count: 1,
            selected: [{ type: "permanent", id: "bear" }],
            remainingRequirements: [{ type: "Land", count: 1 }],
        };
        advanceTargetGroupOrFinalize(state, pt, "p1");
        // Group advanced: the creature is locked into priorSelected, the current
        // group is now the Land, and the queue is drained.
        expect(pt.targetType).toBe("Land");
        expect(pt.count).toBe(1);
        expect(pt.selected).toEqual([]);
        expect(pt.priorSelected).toEqual([{ type: "permanent", id: "bear" }]);
        expect(pt.remainingRequirements).toBeUndefined();
        // The spell is NOT on the stack yet — the second group is still open.
        expect(state.stack).toHaveLength(0);
    });

    it("full path: pays 3 life at commit and destroys both the creature and the land (finalizeTargetSelection → resolveTopOfStack)", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeInstance(mountain.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const fum = makeInstance(fumarole.id, {
            id: "fum",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [fum],
                    life: 20,
                    // {3}{B}{R} — generic 3 paid from colorless.
                    manaPool: { W: 0, U: 0, B: 1, R: 1, G: 0, C: 3 },
                }),
                makePlayer("p2", { battlefield: [bear, land] }),
            ],
        });
        // Both groups already chosen: creature locked in priorSelected, land in
        // the current selection.
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "fum",
            targetType: "Land",
            count: 1,
            priorSelected: [{ type: "permanent", id: "bear" }],
            selected: [{ type: "permanent", id: "land" }],
        };
        finalizeTargetSelection(state, state.pendingTarget!, "p1");
        // CR 601.2b — 3 life paid the instant the spell hit the stack.
        expect(state.players[0].life).toBe(17);
        expect(state.stack).toHaveLength(1);
        // Positional targets: [creature, land].
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "bear" },
            { type: "permanent", id: "land" },
        ]);

        resolveTopOfStack(state);
        // CR 701.7 — both destroyed.
        expect(state.players[1].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[1].battlefield.some((c) => c.id === "land")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
        expect(state.players[1].graveyard.some((c) => c.id === "land")).toBe(
            true
        );
    });
});

// ===========================================================================
// Per-attacker sacrifice-a-land attack tax (CR 508.1c/1g) — Flooded Woodlands
// (green creatures) & Reclamation (black creatures), #733. The tax is a
// battlefield-scanned `attack-sacrifice-tax` static charged at declare-attackers
// confirmation: one land sacrificed per taxed attacker. Coverage below drives
// both the read-only combat seam (`collectAttackSacrificeTax`) and the exact
// enforcement loop `confirmAttackers` runs (mirrored here — no convex-test
// harness, ADR 0001): reject when lands are insufficient, sacrifice N when they
// suffice, and untaxed attackers pay nothing.
// ===========================================================================

const LAND_FILTER: PermanentFilter = { types: ["Land"] };

/** Mirror of the confirmAttackers tax logic (game.ts, CR 701.21a): collect the
 *  charges, reject if the payer has too few lands, else build the unified
 *  land-sacrifice selection and auto-resolve a fungible board. Returns the
 *  selection (undefined when no tax applies); throws the oracle reason on
 *  shortfall. */
function buildAttackSacrificeSelection(
    state: GameState
): SacrificeSelection | undefined {
    const charges = collectAttackSacrificeTax(state);
    if (charges.length === 0) return undefined;
    const payerId = charges[0].controllerId;
    const totalNeeded = charges.reduce((a, ch) => a + ch.count, 0);
    if (sacrificeCandidates(state, payerId, LAND_FILTER).length < totalNeeded) {
        throw new Error(charges[0].reason);
    }
    const sel: SacrificeSelection = {
        playerId: payerId,
        reason: charges[0].reason,
        requirements: charges.map((ch) => ({
            filter: LAND_FILTER,
            count: ch.count,
        })),
        picked: [],
    };
    autoResolveFungible(state, sel);
    return sel;
}

/** Apply the tax as confirmAttackers does when the board is fungible: build the
 *  selection and, only if it auto-resolved to completion, execute it. A
 *  non-fungible board leaves the selection parked (nothing sacrificed here). */
function applyAttackSacrificeTax(state: GameState): void {
    const sel = buildAttackSacrificeSelection(state);
    if (sel && isSacrificeSelectionComplete(sel)) {
        applySacrificeSelection(state, sel);
    }
}

/** Builds a DECLARE_ATTACKERS state: p1 (active) with the given attacking
 *  creatures + `landCount` untapped lands, and `taxCardId` in play on the
 *  controller named by `taxController` (default p1). */
function makeCombatState(args: {
    attackers: { id: string; cardId: string }[];
    landCount: number;
    taxCardId?: string;
    taxController?: "p1" | "p2";
}): GameState {
    const attackerInsts = args.attackers.map((a) =>
        makeInstance(a.cardId, {
            id: a.id,
            controllerId: "p1",
            isAttacking: true,
        })
    );
    const lands = Array.from({ length: args.landCount }, (_, i) =>
        makeInstance(mountain.id, { id: `land-${i}`, controllerId: "p1" })
    );
    const p1Battlefield = [...attackerInsts, ...lands];
    const taxOwner = args.taxController ?? "p1";
    if (args.taxCardId) {
        const taxInst = makeInstance(args.taxCardId, {
            id: "tax",
            controllerId: taxOwner,
        });
        if (taxOwner === "p1") p1Battlefield.push(taxInst);
    }
    const p1 = makePlayer("p1", { battlefield: p1Battlefield });
    const p2Battlefield =
        args.taxCardId && taxOwner === "p2"
            ? [makeInstance(args.taxCardId, { id: "tax", controllerId: "p2" })]
            : [];
    const p2 = makePlayer("p2", { battlefield: p2Battlefield });
    return makeState({
        players: [p1, p2],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: args.attackers.map((a) => a.id),
            blockerAssignments: {},
            confirmed: false,
            blockersConfirmed: false,
        },
    });
}

describe("Flooded Woodlands (CR 508.1c/1g — green-creature attack tax, #733)", () => {
    it("charges one land per attacking green creature (scales with count)", () => {
        const one = makeCombatState({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            landCount: 3,
            taxCardId: floodedWoodlands.id,
        });
        expect(collectAttackSacrificeTax(one)).toEqual([
            { controllerId: "p1", count: 1, reason: expect.any(String) },
        ]);

        const two = makeCombatState({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            landCount: 3,
            taxCardId: floodedWoodlands.id,
        });
        expect(collectAttackSacrificeTax(two)[0].count).toBe(2);
    });

    it("does not tax non-green attackers", () => {
        const state = makeCombatState({
            attackers: [{ id: "b1", cardId: scatheZombies.id }],
            landCount: 3,
            taxCardId: floodedWoodlands.id,
        });
        expect(collectAttackSacrificeTax(state)).toEqual([]);
    });

    it("blocks the attack when the controller has too few lands to pay", () => {
        const state = makeCombatState({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            landCount: 1,
            taxCardId: floodedWoodlands.id,
        });
        expect(() => applyAttackSacrificeTax(state)).toThrow();
        // The declaration is rejected before any land is sacrificed.
        expect(
            state.players[0].battlefield.filter((c) => isLand(c)).length
        ).toBe(1);
    });

    it("sacrifices exactly one land per green attacker when lands suffice", () => {
        const state = makeCombatState({
            attackers: [
                { id: "g1", cardId: grizzlyBears.id },
                { id: "g2", cardId: grizzlyBears.id },
            ],
            landCount: 3,
            taxCardId: floodedWoodlands.id,
        });
        applyAttackSacrificeTax(state);
        expect(
            state.players[0].battlefield.filter((c) => isLand(c)).length
        ).toBe(1);
        expect(state.players[0].graveyard.filter((c) => isLand(c)).length).toBe(
            2
        );
    });

    it("imposes no tax when the enchantment is not in play", () => {
        const state = makeCombatState({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            landCount: 3,
        });
        expect(collectAttackSacrificeTax(state)).toEqual([]);
    });

    it("does not auto-pick when the lands are non-fungible (parks the choice, CR 701.21a)", () => {
        // One green attacker → one land to sacrifice; two lands, one tapped, so
        // which land to sacrifice is a real choice.
        const attacker = makeInstance(grizzlyBears.id, {
            id: "g1",
            controllerId: "p1",
            isAttacking: true,
        });
        const untapped = makeInstance(mountain.id, {
            id: "land-u",
            controllerId: "p1",
        });
        const tapped = makeInstance(mountain.id, {
            id: "land-t",
            controllerId: "p1",
            isTapped: true,
        });
        const tax = makeInstance(floodedWoodlands.id, {
            id: "tax",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker, untapped, tapped, tax],
                }),
                makePlayer("p2"),
            ],
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: ["g1"],
                blockerAssignments: {},
                confirmed: false,
                blockersConfirmed: false,
            },
        });
        const sel = buildAttackSacrificeSelection(state);
        expect(sel).toBeDefined();
        expect(isSacrificeSelectionComplete(sel!)).toBe(false);
        // applyAttackSacrificeTax leaves both lands in play (parked, awaiting
        // selectSacrifice).
        applyAttackSacrificeTax(state);
        expect(
            state.players[0].battlefield.filter((c) => isLand(c)).length
        ).toBe(2);
    });
});

describe("Reclamation (CR 508.1c/1g — black-creature attack tax, #733)", () => {
    it("taxes attacking black creatures but not green ones", () => {
        const black = makeCombatState({
            attackers: [{ id: "b1", cardId: scatheZombies.id }],
            landCount: 3,
            taxCardId: reclamation.id,
        });
        expect(collectAttackSacrificeTax(black)[0].count).toBe(1);

        const green = makeCombatState({
            attackers: [{ id: "g1", cardId: grizzlyBears.id }],
            landCount: 3,
            taxCardId: reclamation.id,
        });
        expect(collectAttackSacrificeTax(green)).toEqual([]);
    });

    it("sacrifices one land per black attacker at declaration", () => {
        const state = makeCombatState({
            attackers: [{ id: "b1", cardId: scatheZombies.id }],
            landCount: 2,
            taxCardId: reclamation.id,
        });
        applyAttackSacrificeTax(state);
        expect(
            state.players[0].battlefield.filter((c) => isLand(c)).length
        ).toBe(1);
    });
});

// Chromatic Armor (#734) — the Prismatic-Ward colour shield PLUS a re-choosable
// warded colour via a sleight-counter-scaled {X} ability. Reuses the shipped
// `chosenModeId` shield seam + the new `setChosenMode` / `manaEqualToCounterCount`
// primitives.
describe("Chromatic Armor (re-choosable colour shield, CR 615 / 700.2c / 601.2f)", () => {
    function setup(chosenColor: string, sleight = 1) {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(chromaticArmor.id, {
            id: "armor",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
            chosenModeId: chosenColor,
            counters: { sleight },
        });
        // A black source ({B}{B}) and a blue source to fire damage from (CR
        // 202.2 — colours are read off the source's mana cost).
        const blackSrc = makeInstance(knightOfStromgald.id, {
            id: "black-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const blueSrc = makeInstance(seaSpirit.id, {
            id: "blue-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [blackSrc, blueSrc] }),
            ],
        });
        return { state };
    }

    it("prevents all damage to the host from the chosen colour, not others (CR 615)", () => {
        const { state } = setup("B");
        // Black source → prevented (event consumed).
        expect(
            runDamageReplacement(
                state,
                "black-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )
        ).toBeNull();
        // Blue source → lands unmodified.
        const fresh = setup("B").state;
        expect(
            runDamageReplacement(
                fresh,
                "blue-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )?.amount
        ).toBe(3);
    });

    it("prevents combat damage too, not just spell/ability damage", () => {
        const { state } = setup("B");
        expect(
            runDamageReplacement(
                state,
                "black-src",
                "p2",
                { type: "permanent", id: "host" },
                2,
                true
            )
        ).toBeNull();
    });

    it("the {X} ability adds a sleight counter and RE-CHOOSES the warded colour (CR 700.2c)", () => {
        const { state } = setup("B", 1);
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "armor"
        )!;
        // Activate the re-choose ability; resolution suspends at the colour pick.
        resolveActivated(state, aura, "chromatic-armor-recolor");
        expect(state.pendingChoices?.[0]?.kind).toBe("option-pick");
        // Choose blue.
        submitChoice(state, ["U"]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "armor"
        )!;
        // Sleight counter incremented 1 → 2 and warded colour is now blue.
        expect(after.counters?.sleight).toBe(2);
        expect(after.chosenModeId).toBe("U");
        // The shield now prevents BLUE and lets BLACK through.
        expect(
            runDamageReplacement(
                state,
                "blue-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )
        ).toBeNull();
        expect(
            runDamageReplacement(
                state,
                "black-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )?.amount
        ).toBe(3);
    });

    // Every test above hand-builds the Aura ALREADY on the battlefield with
    // `chosenModeId` pre-set — none of them exercise the real cast commit
    // (`finalizeTargetSelection` → `resolveTopOfStack`), which is the ONLY
    // path a real cast actually takes: `announceCast` stores the ETB colour
    // pick on `state.pendingTarget.chosenModeId` (CR 700.2c), and it is this
    // function that must carry it onto the stack item / permanent.
    it("carries the ETB colour choice onto the permanent through the real cast commit (finalizeTargetSelection → resolveTopOfStack)", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [host],
                    manaPool: { W: 1, U: 1, B: 0, R: 0, G: 0, C: 1 },
                }),
                makePlayer("p2", { battlefield: [] }),
            ],
        });
        state.players[0].hand.push(
            makeInstance(chromaticArmor.id, {
                id: "armor-cast",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "armor-cast",
            targetType: "Creature",
            count: 1,
            selected: [{ type: "permanent", id: "host" }],
            chosenModeId: "W",
        };
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        const onBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "armor-cast"
        );
        expect(onBattlefield?.chosenModeId).toBe("W");
    });

    it("the {X} cost equals the source's sleight-counter count (CR 601.2f)", () => {
        const ability = chromaticArmor.activatedAbilities![0];
        // 1 sleight counter → {1} (generic total stored under the `X` key).
        const s1 = setup("B", 1).state;
        const aura1 = s1.players[0].battlefield.find((c) => c.id === "armor")!;
        expect(resolveAbilityManaCost(s1, aura1, ability)).toEqual({ X: 1 });
        // 3 sleight counters → {3}.
        const s3 = setup("B", 3).state;
        const aura3 = s3.players[0].battlefield.find((c) => c.id === "armor")!;
        expect(resolveAbilityManaCost(s3, aura3, ability)).toEqual({ X: 3 });
    });

    it("wire format: the colour shield survives projectPublicState", () => {
        const projected = projectPublicState(
            setup("B").state,
            1,
            "p1"
        ) as unknown as GameState;
        // Black source still prevented after the projection strips card.card.
        expect(
            runDamageReplacement(
                projected,
                "black-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )
        ).toBeNull();
        // Blue source still lands.
        const fresh = projectPublicState(
            setup("B").state,
            1,
            "p1"
        ) as unknown as GameState;
        expect(
            runDamageReplacement(
                fresh,
                "blue-src",
                "p2",
                { type: "permanent", id: "host" },
                3,
                false
            )?.amount
        ).toBe(3);
    });
});

describe("Glaciers (CR 613.1d subtype-set — All Mountains are Plains)", () => {
    it("without Glaciers, a Mountain keeps its subtype and taps for red", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
        });
        expect(mtn.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(mtn)).toBe("R");
    });

    it("with Glaciers on the battlefield every Mountain becomes a Plains and taps for white; survives the wire (CR 613.1d)", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
        });
        const glac = makeInstance(glaciers.id, {
            id: "glac",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mtn] }),
                makePlayer("p2", { battlefield: [glac] }),
            ],
        });
        applySourceStaticEffects(state, glac);
        expect(mtn.subtypes).toEqual(["Plains"]);
        expect(getBasicLandMana(mtn)).toBe("W");

        const projected = projectPublicState(state, 1, "p1");
        const slimMtn = projected.players[0].battlefield.find(
            (c) => c.id === "mtn"
        )!;
        expect(slimMtn.subtypes).toEqual(["Plains"]);
        expect(getBasicLandMana(slimMtn)).toBe("W");
    });
});

describe("Diabolic Vision (look at top 5, keep 1, reorder the rest on top, CR 401)", () => {
    it("keeps the chosen card in hand and reorders the rest on top", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: library("p1", ["c1", "c2", "c3", "c4", "c5"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, diabolicVision.id, "p1");
        resolveTopOfStack(state);

        const keepHead = state.pendingChoices![0];
        expect(keepHead.kind).toBe("search-library");
        submitChoice(state, ["c3"]);

        const reorderHead = state.pendingChoices![0];
        expect(reorderHead.kind).toBe("reorder-library");
        submitChoice(state, ["c5", "c4", "c2", "c1"]);

        expect(state.players[0].hand.map((c) => c.id)).toContain("c3");
        expect(state.players[0].library.slice(0, 4).map((c) => c.id)).toEqual([
            "c5",
            "c4",
            "c2",
            "c1",
        ]);
    });
});

describe("Elemental Augury ({3}: look at target player's top 3, reorder in place, CR 401 / 114.6-adjacent)", () => {
    it("reorders the target player's top three cards, known only to the caster (cross-player scry)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    library: library("p2", ["c1", "c2", "c3", "c4"]),
                }),
            ],
        });
        const augury = makeInstance(elementalAugury.id, {
            id: "augury",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(augury);
        resolveActivated(state, augury, "elemental-augury-look", [
            { type: "player", id: "p2" },
        ]);

        expect(state.pendingChoices![0].kind).toBe("reorder-library");
        submitChoice(state, ["c3", "c1", "c2"]);

        const lib = state.players[1].library;
        expect(lib.slice(0, 3).map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
        // Known to the caster (p1) only — not to the library's owner p2.
        expect(lib[0].knownTo).toEqual(["p1"]);
        expect(lib[1].knownTo).toEqual(["p1"]);
        expect(lib[2].knownTo).toEqual(["p1"]);
        // The untouched 4th card stays unknown to everyone.
        expect(lib[3].knownTo).toBeUndefined();
    });
});
