// Per-card behavior tests for black cards in `convex/cards/sets/drk/black.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ashesToAshes,
    banshee,
    bogRats,
    curseArtifact,
    eaterOfTheDead,
    graveRobbers,
    inquisition,
    marshGas,
    murkDwellers,
    namelessRace,
    ragMan,
    seasonOfTheWitch,
    theFallen,
    uncleIstvan,
    wordOfBinding,
    wormsOfTheEarth,
} from "..";
import {
    UPKEEP,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { emitBlockersConfirmedEvents } from "../../../../gre/phases";
import { applyDamageReplacements } from "../../../../gre/replacements";
import {
    assertLegalAction,
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    canLandEnterBattlefield,
    landPlayLockActive,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getCardByName } from "../../../index";
import { mountain } from "../../lea";

// ═══════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#413)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ashes to Ashes — exile two nonartifact creatures, 5 to you (CR 701.13 / 119)", () => {
    it("exiles both targets and deals 5 to the caster", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);
        expect(state.players[0].life).toBe(15);
    });

    it("artifact creatures are not legal targets (excludeTypes)", () => {
        const robot = makeInstance(getCardByName("Ornithopter").id, {
            id: "robot",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [robot, bear] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1");
        const legal = getLegalTargets(
            state,
            ashesToAshes.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("bear");
        expect(ids).not.toContain("robot");
    });
});

describe("Banshee — {X},{T}: half X down to any target, half X up to you (CR 605 / 119)", () => {
    function setup() {
        const bansheeInst = makeInstance(banshee.id, {
            id: "banshee",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [bansheeInst] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, bansheeInst };
    }

    it("X=5 → 2 to the target, 3 to you (floor/ceil split)", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 5,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - floor(5/2)=2
        expect(state.players[0].life).toBe(17); // 20 - ceil(5/2)=3
    });

    it("X=0 → no damage either way", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 0,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Bog Rats — can't be blocked by Walls (CR 509.1b / 205.3)", () => {
    function setup(blockerSubtypes: string[]) {
        const rats = makeInstance(bogRats.id, {
            id: "rats",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(getCardByName("Wall of Wood").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            subtypes: blockerSubtypes,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rats] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, rats };
    }

    it("the static restriction rejects a Wall blocker", () => {
        const { state, rats } = setup(["Wall"]);
        const restriction = rats.card
            ? bogRats.staticEffects!.find((e) => e.kind === "block-restriction")
            : undefined;
        expect(restriction).toBeDefined();
        // Predicate: legal block only if the blocker is NOT a Wall.
        const blocker = state.players[1].battlefield[0];
        const predicate = (
            restriction as { predicate: (s: unknown, o: unknown) => boolean }
        ).predicate;
        expect(predicate(rats, blocker)).toBe(false);
    });

    it("a non-Wall blocker is allowed", () => {
        const { state, rats } = setup(["Bear"]);
        const restriction = bogRats.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        ) as { predicate: (s: unknown, o: unknown) => boolean };
        const blocker = state.players[1].battlefield[0];
        expect(restriction.predicate(rats, blocker)).toBe(true);
    });
});

describe("Curse Artifact — upkeep 2 damage unless sacrifice the artifact (CR 603.6a / 117.3a)", () => {
    function setup() {
        const artifact = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(curseArtifact.id, {
            id: "curse",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "art",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [artifact] }),
            ],
        });
        return { state, aura };
    }

    it("fires at the enchanted artifact's controller upkeep (host-controller)", () => {
        const { state } = setup();
        const fires = (p: string) =>
            collectTriggers(state, [UPKEEP(p) as never]).some(
                (t) => t.triggeredAbilityId === "curse-artifact-upkeep"
            );
        expect(fires("p2")).toBe(true);
        expect(fires("p1")).toBe(false);
    });

    it("declining the sacrifice deals 2 damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["decline"]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[1].battlefield.some((c) => c.id === "art")).toBe(
            true
        );
    });

    it("sacrificing the artifact avoids the damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["yes"]);
        expect(state.players[1].life).toBe(20);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Eater of the Dead — {0}: if tapped, exile a graveyard creature + untap (CR 605 / 701.13)", () => {
    function setup(tapped: boolean) {
        const eater = makeInstance(eaterOfTheDead.id, {
            id: "eater",
            controllerId: "p1",
            isTapped: tapped,
        });
        const corpse = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "corpse",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eater] }),
                makePlayer("p2", { graveyard: [corpse] }),
            ],
        });
        return { state, eater };
    }

    it("exiles the targeted graveyard creature and untaps itself", () => {
        const { state, eater } = setup(true);
        state.stack.push({
            ...eater,
            zone: "stack",
            castById: "p1",
            abilityId: "eater-of-the-dead-exile-untap",
            targets: [{ type: "graveyard-card", id: "corpse", playerId: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "corpse")).toBe(
            true
        );
        const e = state.players[0].battlefield.find((c) => c.id === "eater")!;
        expect(e.isTapped).toBe(false);
    });

    it("can only be activated while tapped (canActivate gate)", () => {
        const ability = eaterOfTheDead.activatedAbilities![0];
        const tapped = makeInstance(eaterOfTheDead.id, { isTapped: true });
        const untapped = makeInstance(eaterOfTheDead.id, { isTapped: false });
        expect(ability.canActivate!(tapped as never, {} as never)).toBe(true);
        expect(ability.canActivate!(untapped as never, {} as never)).toBe(
            false
        );
    });
});

describe("Grave Robbers — {B},{T}: exile a graveyard artifact, gain 2 life (CR 605 / 701.13)", () => {
    it("exiles the artifact card and gains 2 life", () => {
        const robber = makeInstance(graveRobbers.id, {
            id: "robber",
            controllerId: "p1",
        });
        const art = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [robber] }),
                makePlayer("p2", { graveyard: [art] }),
            ],
        });
        resolveActivated(state, robber, "grave-robbers-exile-artifact", [
            { type: "graveyard-card", id: "art", playerId: "p2" },
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "art")).toBe(true);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Inquisition — reveal hand, damage = white cards in hand (CR 202.2 / 119)", () => {
    it("deals damage equal to the number of white cards", () => {
        const whiteA = makeInstance(getCardByName("Savannah Lions").id, {
            id: "wA",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const whiteB = makeInstance(getCardByName("Serra Angel").id, {
            id: "wB",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const black = makeInstance(getCardByName("Bog Imp").id, {
            id: "bl",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 20, hand: [whiteA, whiteB, black] }),
            ],
        });
        pushSpell(state, inquisition.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // two white cards
    });
});

describe("Marsh Gas — all creatures get -2/-0 until end of turn (CR 611.2)", () => {
    it("reduces power of every creature", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, marshGas.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, a)).toBe(0); // 2 - 2
        expect(getEffectivePower(state, b)).toBe(1); // 3 - 2
    });
});

describe("Murk Dwellers — attacks unblocked → +2/+0 (CR 509.1h ATTACKER_UNBLOCKED)", () => {
    it("emits ATTACKER_UNBLOCKED for an attacker with no blocker", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["dweller"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        emitBlockersConfirmedEvents(state);
        // The unblocked-pump trigger is now on the stack.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "murk-dwellers-unblocked-pump"
        );
        expect(trig).toBeDefined();
    });

    it("the pump trigger adds +2/+0 until end of combat", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
        });
        const base = getEffectivePower(state, dweller);
        const event = {
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId: "dweller",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Zombie"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, dweller, "murk-dwellers-unblocked-pump", event);
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "dweller"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(base + 2);
    });
});

describe("Nameless Race — CDA P/T from life paid as it enters (CR 604.3 / 614.12)", () => {
    function setup(opponentWhitePermanents: number, life = 20) {
        const oppBattlefield = Array.from(
            { length: opponentWhitePermanents },
            (_, i) =>
                makeInstance(getCardByName("Savannah Lions").id, {
                    id: `w${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        const item = pushSpell(state, namelessRace.id, "p1");
        item.chosenX = 1;
        return { state, item };
    }

    it("caps the life payment by opponent white permanents + graveyard cards", () => {
        const { state } = setup(2);
        resolveTopOfStack(state); // suspends on the pay-life option choice
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        // Options are Pay 0..2 life (cap = 2 white permanents).
        expect(head?.options?.map((o) => o.id)).toEqual(["0", "1", "2"]);
    });

    it("pays the chosen life and sets P/T to the amount paid", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        answerChoice(state, ["2"]); // pay 2 life
        const race = state.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(state.players[0].life).toBe(18);
        expect(getEffectivePower(state, race)).toBe(2);
        expect(getEffectiveToughness(state, race)).toBe(2);
    });

    it("the CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        answerChoice(state, ["2"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Rag Man — {B}{B}{B},{T}: opponent discards a creature at random (CR 701.9a)", () => {
    it("discards a creature card, leaving noncreature cards", () => {
        const creature = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "cre",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const land = makeInstance(getCardByName("Swamp").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [creature, land] }),
            ],
        });
        resolveActivated(
            state,
            makeInstance(ragMan.id, {
                id: "ragman",
                controllerId: "p1",
            }),
            "rag-man-discard",
            [{ type: "player", id: "p2" }]
        );
        // The only creature card is discarded; the land stays in hand.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["cre"]);
    });
});

describe("Season of the Witch — upkeep pay-2-life-or-sac + end-step mass destroy (CR 603.6a)", () => {
    it("declining the 2-life payment sacrifices the enchantment", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["decline"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "witch")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });

    it("paying 2 life keeps it", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield.some((c) => c.id === "witch")).toBe(
            true
        );
        expect(state.players[0].life).toBe(18);
    });

    it("end step destroys untapped non-attackers but spares attackers, tapped, defenders, and sick", () => {
        const idler = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "idler", // untapped, didn't attack → destroyed
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "attacker",
            controllerId: "p1",
            hasAttackedThisTurn: true, // attacked → spared
        });
        const tapped = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "tapped",
            controllerId: "p1",
            isTapped: true, // tapped → spared (filter)
        });
        const wall = makeInstance(getCardByName("Wall of Wood").id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2", // defender → couldn't attack → spared
        });
        const fresh = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "fresh",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: true, // couldn't attack → spared
        });
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [idler, attacker, tapped, witch],
                }),
                makePlayer("p2", { battlefield: [wall, fresh] }),
            ],
        });
        resolveTrigger(state, witch, "season-of-the-witch-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const alive = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].some((c) => c.id === id);
        expect(alive("idler")).toBe(false);
        expect(alive("attacker")).toBe(true);
        expect(alive("tapped")).toBe(true);
        expect(alive("wall")).toBe(true);
        expect(alive("fresh")).toBe(true);
    });
});

describe("The Fallen — upkeep 1 to each opponent it damaged this game (CR 603.6a)", () => {
    function setup() {
        const fallen = makeInstance(theFallen.id, {
            id: "fallen",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fallen] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, fallen };
    }

    it("does nothing at upkeep before The Fallen has dealt damage", () => {
        const { state, fallen } = setup();
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(20);
    });

    it("after marking an opponent, the upkeep deals 1 to that opponent", () => {
        const { state, fallen } = setup();
        // Stamp the mark via the damage-dealt trigger.
        resolveTrigger(state, fallen, "the-fallen-mark", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "fallen",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(19);
    });
});

describe("Uncle Istvan — prevent all damage from creatures (CR 615)", () => {
    function makeIstvanState() {
        const istvan = makeInstance(uncleIstvan.id, {
            id: "istvan",
            controllerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [istvan] }),
                makePlayer("p2"),
            ],
        });
    }

    it("consumes damage whose source is a creature", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 5,
            isCombat: true,
        });
        expect(ev).toBeNull(); // fully prevented
    });

    it("does NOT prevent damage from a noncreature source", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "bolt",
            sourceControllerId: "p2",
            sourceColors: ["R"],
            sourceTypes: ["Instant"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 3,
            isCombat: false,
        });
        expect(ev?.amount).toBe(3);
    });

    it("the prevention fires through the wire projection (mandatory)", () => {
        const state = makeIstvanState();
        const projected = projectPublicState(state, 1, "p1");
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 4,
            isCombat: true,
        });
        expect(ev).toBeNull();
    });
});

describe("Word of Binding — tap X target creatures (CR 601.2c / 701.20a)", () => {
    it("taps every targeted creature", () => {
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        const item = pushSpell(state, wordOfBinding.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "a")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b")!.isTapped
        ).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Worms of the Earth — {2}{B}{B}{B} Enchantment (#423)
// "Players can't play lands. Lands can't enter the battlefield. At the
//  beginning of each upkeep, any player may sacrifice two lands or take 5
//  damage; if they do either, destroy this." CR 305.1 land-play special action
//  + CR 614 land-ETB prohibition; CR 603.6a "each" upkeep + CR 117.3a optional.
// ───────────────────────────────────────────────────────────────────────────

/** Puts Worms of the Earth on p1's battlefield. */
function withWorms(): { state: GameState; worms: CardInstanceState } {
    const worms = makeInstance(wormsOfTheEarth.id, {
        id: "worms-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [worms] }), makePlayer("p2")],
    });
    return { state, worms };
}

describe("Worms of the Earth ({2}{B}{B}{B} Enchantment — land-play/ETB lock)", () => {
    describe("land-play prohibition (CR 305.1) — path 1", () => {
        it('a land in hand has NO "play" action while Worms is in play', () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).not.toContain("play");
        });

        it('the same land DOES have "play" once Worms leaves play (lock lifted)', () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            // Remove Worms → lock lifts immediately (live-derived).
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).toContain("play");
        });

        it("assertLegalAction throws for play (game.ts playCard mutation boundary)", () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            expect(() =>
                assertLegalAction(state, state.players[0], land, "play")
            ).toThrow(/Illegal action "play"/);
        });
    });

    describe("land-ETB prohibition (CR 614) — path 2", () => {
        it("landPlayLockActive is true with Worms in play, false without", () => {
            const { state, worms } = withWorms();
            expect(landPlayLockActive(state)).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(landPlayLockActive(state)).toBe(false);
        });

        it("canLandEnterBattlefield PREVENTS a land while locked, allows non-lands", () => {
            const { state } = withWorms();
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(false);
            expect(canLandEnterBattlefield(state, ["Creature"])).toBe(true);
            expect(canLandEnterBattlefield(state, ["Artifact"])).toBe(true);
        });

        it("canLandEnterBattlefield allows a land once Worms leaves", () => {
            const { state, worms } = withWorms();
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(true);
        });
    });

    describe("serialization cache (refreshLandPlayLock via SBA)", () => {
        it("checkStateBasedActions sets state.landPlayLocked while Worms is in play", () => {
            const { state } = withWorms();
            expect(state.landPlayLocked).toBeUndefined();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
        });

        it("checkStateBasedActions clears state.landPlayLocked when Worms leaves", () => {
            const { state, worms } = withWorms();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBeUndefined();
        });
    });

    describe("upkeep clause (CR 603.6a 'each' + CR 117.3a optional)", () => {
        it("sacrificing two lands destroys Worms of the Earth", () => {
            const { state, worms } = withWorms();
            const l1 = makeInstance(mountain.id, {
                id: "l1",
                controllerId: "p1",
                ownerId: "p1",
            });
            const l2 = makeInstance(mountain.id, {
                id: "l2",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(l1, l2);
            state.phase = "UPKEEP";
            // Fire on p1's upkeep; choose "sacrifice", then pick the two lands.
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["sacrifice"]);
            answerChoice(state, ["l1", "l2"]);
            checkStateBasedActions(state);
            // Worms destroyed; two lands sacrificed.
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
            expect(
                state.players[0].battlefield.filter((c) =>
                    c.types.includes("Land")
                )
            ).toHaveLength(0);
        });

        it("taking 5 damage destroys Worms and lowers life by 5", () => {
            const { state, worms } = withWorms();
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[0].life).toBe(15);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });

        it("declining keeps Worms in play (no sacrifice, no damage)", () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "keep",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(land);
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["decline"]);
            checkStateBasedActions(state);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(true);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === "keep")
            ).toBe(true);
        });

        it("fires on EACH player's upkeep — p2 may pay too (scope: each)", () => {
            const { state, worms } = withWorms();
            // p2's upkeep: scoped player is p2 (active player), not Worms'
            // controller p1. p2 takes 5; Worms is destroyed.
            state.phase = "UPKEEP";
            state.activePlayerId = "p2";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p2")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[1].life).toBe(15);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });
    });

    describe("wire format (projection survives)", () => {
        it("landPlayLocked + lock derivation survive projectPublicState", () => {
            const { state } = withWorms();
            checkStateBasedActions(state);
            expect(landPlayLockActive(state)).toBe(true);
            const projected = projectPublicState(state, 1, "p1");
            // The serialized cache crosses the wire.
            expect(projected.landPlayLocked).toBe(true);
            // And the live derivation still reads Worms off the projected board.
            expect(landPlayLockActive(projected as unknown as GameState)).toBe(
                true
            );
        });
    });
});
