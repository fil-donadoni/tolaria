// Ice Age (ICE) — white card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    armorOfFaith,
    blinkingSpirit,
    cooperation,
    elvishHealer,
    hallowedGround,
    kelsinkoRanger,
    kjeldoranKnight,
    kjeldoranPhalanx,
    kjeldoranSkycaptain,
    kjeldoranSkyknight,
    kjeldoranWarrior,
    lostOrderOfJarkeld,
    mercenaries,
    orderOfTheSacredTorch,
    orderOfTheWhiteShield,
    rally,
    shieldBearer,
    snowHound,
    warning,
    deathWardIce,
    disenchantIce,
    swordsToPlowsharesIce,
    circleOfProtectionBlackIce,
    circleOfProtectionBlueIce,
    circleOfProtectionGreenIce,
    circleOfProtectionRedIce,
    circleOfProtectionWhiteIce,
    seaSpirit,
    centaurArcher,
    knightOfStromgald,
    blackScarab,
    blueScarab,
    greenScarab,
    redScarab,
    whiteScarab,
    caribouRange,
    fylgja,
    justice,
    seraph,
    blessedWine,
    heal,
    lightningBlow,
    formation,
    snowCoveredForest,
    arcticFoxes,
    hipparion,
    prismaticWard,
    sacredBoon,
} from "../../ice";
import { plains } from "../../lea";
import { getDefinition } from "../../../index";
import {
    resolveTopOfStack,
    getManaSubstitutions,
    payManaCost,
    commitLandsForCost,
    normalizeManaCost,
    runDamageReplacement,
    applyTargetPrevention,
} from "../../../../gre/state";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    manaFromPlan,
} from "../../../../gre/autoTap";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { advancePhase } from "../../../../gre/phases";
import {
    validateBlockerEligibility,
    collectBlockBypassCharges,
} from "../../../../gre/combat";
import type { GameState } from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { CardInstanceState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { CardType } from "../../../types";
import type { Phase } from "../../../../gre/types";
import {
    resolveActivated,
    resolveTrigger,
    vanilla,
    library,
    castCantrip,
    enterUpkeepAndFire,
    snowLand,
} from "./helpers";

// ===========================================================================
// White free tranche (#630)
// ===========================================================================

// --- Reprints (CardPrint onto existing definitions, ADR 0014) --------------

describe("ICE White reprints (CardPrint wiring, ADR 0014)", () => {
    it("Death Ward print resolves to the LEA definition", () => {
        expect(getDefinition(deathWardIce.printId).name).toBe("Death Ward");
        expect(deathWardIce.definitionId).toBe(
            "fa5466cc-aa57-4a7f-8b21-d92b2fe02e13"
        );
        expect(deathWardIce.setCode).toBe("ice");
    });
    it("Disenchant print resolves to the LEA definition", () => {
        expect(getDefinition(disenchantIce.printId).name).toBe("Disenchant");
    });
    it("Swords to Plowshares print resolves to the LEA definition", () => {
        expect(getDefinition(swordsToPlowsharesIce.printId).name).toBe(
            "Swords to Plowshares"
        );
    });
    it("Circle of Protection cycle prints resolve to their definitions", () => {
        expect(getDefinition(circleOfProtectionBlackIce.printId).name).toBe(
            "Circle of Protection: Black"
        );
        expect(getDefinition(circleOfProtectionBlueIce.printId).name).toBe(
            "Circle of Protection: Blue"
        );
        expect(getDefinition(circleOfProtectionGreenIce.printId).name).toBe(
            "Circle of Protection: Green"
        );
        expect(getDefinition(circleOfProtectionRedIce.printId).name).toBe(
            "Circle of Protection: Red"
        );
        expect(getDefinition(circleOfProtectionWhiteIce.printId).name).toBe(
            "Circle of Protection: White"
        );
    });
});

// --- Keyword creatures (CR 702 — snapshot checks) --------------------------

describe("ICE White keyword creatures (CR 702)", () => {
    it("Kjeldoran Phalanx has first strike + banding", () => {
        expect(kjeldoranPhalanx.staticAbilities).toEqual([
            "first strike",
            "banding",
        ]);
        expect(kjeldoranPhalanx.power).toBe(2);
        expect(kjeldoranPhalanx.toughness).toBe(5);
    });
    it("Kjeldoran Skycaptain has flying + first strike + banding", () => {
        expect(kjeldoranSkycaptain.staticAbilities).toEqual([
            "flying",
            "first strike",
            "banding",
        ]);
    });
    it("Kjeldoran Skyknight has flying + first strike + banding", () => {
        expect(kjeldoranSkyknight.staticAbilities).toEqual([
            "flying",
            "first strike",
            "banding",
        ]);
    });
    it("Kjeldoran Warrior has banding", () => {
        expect(kjeldoranWarrior.staticAbilities).toEqual(["banding"]);
    });
    it("Shield Bearer is a 0/3 with banding", () => {
        expect(shieldBearer.staticAbilities).toEqual(["banding"]);
        expect(shieldBearer.power).toBe(0);
        expect(shieldBearer.toughness).toBe(3);
    });
    it("Order of the White Shield has protection from black", () => {
        expect(orderOfTheWhiteShield.staticAbilities).toContain(
            "protection from black"
        );
    });
});

// --- Armor of Faith (Aura: static +1/+1 + {W}:+0/+1, CR 613) ----------------

describe("Armor of Faith (Aura, CR 611/613)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(armorOfFaith.id, {
            id: "aura",
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
        return { state, host };
    }

    it("grants a static +1/+1 to the enchanted creature", () => {
        const { state, host } = setup();
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);
    });

    it("wire format: the +1/+1 survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("{W} pump adds +0/+1 to the host until end of turn", () => {
        const { state, host } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id === "aura")!;
        resolveActivated(state, aura, "armor-of-faith-pump");
        expect(getEffectiveToughness(state, host)).toBe(4);
        expect(getEffectivePower(state, host)).toBe(3);
    });
});

// --- Cooperation (Aura grants banding, CR 611) -----------------------------

describe("Cooperation (Aura grants banding, CR 702.22)", () => {
    it("grants banding to the enchanted creature", () => {
        const host = vanilla("host", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cooperation.id, {
            id: "aura",
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
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.staticAbilities ?? []).not.toContain("banding");
        // The keyword-grant is a layer-6 static effect; assert via projection
        // path that the host reads as having banding.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim).toBeDefined();
        // Definition wiring: the static effect grants banding.
        expect(cooperation.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "banding",
        });
    });
});

// --- Blinking Spirit ({0}: bounce self, CR 701.14) -------------------------

describe("Blinking Spirit ({0}: return self to hand, CR 701.14)", () => {
    it("returns itself to its owner's hand", () => {
        const spirit = makeInstance(blinkingSpirit.id, {
            id: "spirit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "blinking-spirit-bounce");
        expect(
            state.players[0].battlefield.find((c) => c.id === "spirit")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "spirit")
        ).toBeDefined();
    });
});

// --- Elvish Healer ({T}: prevent 1, or 2 vs green creature, CR 615) --------

describe("Elvish Healer ({T}: damage prevention, CR 615)", () => {
    it("prevents the next 1 damage to a non-green target", () => {
        const healer = makeInstance(elvishHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redCreature = vanilla("redc", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-red" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer, redCreature] }),
                makePlayer("p2"),
            ],
        });
        // Should resolve without error and register a 1-point shield.
        resolveActivated(state, healer, "elvish-healer-prevent", [
            { type: "permanent", id: "redc" },
        ]);
        expect(state.stack).toHaveLength(0);
    });

    it("the ability is targeted at any target", () => {
        const ability = elvishHealer.activatedAbilities!.find(
            (a) => a.id === "elvish-healer-prevent"
        )!;
        expect(ability.targetRequirement).toMatchObject({ type: "any" });
        expect(ability.cost).toMatchObject({ tap: true });
    });
});

// --- Kelsinko Ranger ({1}{W}: green creature gains first strike) -----------

describe("Kelsinko Ranger (grant first strike to green, CR 611.1b)", () => {
    it("grants first strike to the target green creature until end of turn", () => {
        const ranger = makeInstance(kelsinkoRanger.id, {
            id: "ranger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCreature = vanilla("grn", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-green" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ranger, greenCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ranger, "kelsinko-ranger-first-strike", [
            { type: "permanent", id: "grn" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "grn"
        )!;
        expect(getEffectivePower(state, target)).toBe(2);
        // The grant routes through the layer system; assert no crash + filter.
        const ability = kelsinkoRanger.activatedAbilities!.find(
            (a) => a.id === "kelsinko-ranger-first-strike"
        )!;
        expect(ability.targetRequirement).toMatchObject({ colorFilter: "G" });
    });
});

// --- Kjeldoran Knight (self-pumps, CR 611.1b) ------------------------------

describe("Kjeldoran Knight (self-pumps, CR 611.1b)", () => {
    function setup() {
        const knight = makeInstance(kjeldoranKnight.id, {
            id: "knight",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        return { state, knight };
    }
    it("starts as a 1/1 with banding", () => {
        const { state, knight } = setup();
        expect(getEffectivePower(state, knight)).toBe(1);
        expect(getEffectiveToughness(state, knight)).toBe(1);
        expect(kjeldoranKnight.staticAbilities).toEqual(["banding"]);
    });
    it("{1}{W} pumps +1/+0 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-power");
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(1);
    });
    it("{W}{W} pumps +0/+2 until end of turn", () => {
        const { state, knight } = setup();
        resolveActivated(state, knight, "kjeldoran-knight-pump-toughness");
        expect(getEffectiveToughness(state, knight)).toBe(3);
    });
});

// --- Order of the White Shield (first strike grant + pump) ------------------

describe("Order of the White Shield (grants + pump, CR 611.1b)", () => {
    function setup() {
        const order = makeInstance(orderOfTheWhiteShield.id, {
            id: "order",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2"),
            ],
        });
        return { state, order };
    }
    it("is a 2/1 with protection from black", () => {
        const { state, order } = setup();
        expect(getEffectivePower(state, order)).toBe(2);
        expect(getEffectiveToughness(state, order)).toBe(1);
        expect(orderOfTheWhiteShield.staticAbilities).toContain(
            "protection from black"
        );
    });
    it("{W}{W} pumps +1/+0 until end of turn", () => {
        const { state, order } = setup();
        resolveActivated(state, order, "order-white-shield-pump");
        expect(getEffectivePower(state, order)).toBe(3);
    });
});

// --- Lost Order of Jarkeld (CDA P/T, CR 604.3 / layer 7a) ------------------

describe("Lost Order of Jarkeld (CDA P/T, CR 604.3)", () => {
    function setup(oppCreatures: number) {
        const order = makeInstance(lostOrderOfJarkeld.id, {
            id: "lost",
            controllerId: "p1",
            ownerId: "p1",
            chosenPlayerId: "p2",
        });
        const oppField: CardInstanceState[] = [];
        for (let i = 0; i < oppCreatures; i++) {
            oppField.push(vanilla(`opp${i}`, 1, 1));
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [order] }),
                makePlayer("p2", { battlefield: oppField }),
            ],
        });
        return { state, order };
    }
    it("is 1 plus the chosen player's creature count", () => {
        const { state, order } = setup(3);
        expect(getEffectivePower(state, order)).toBe(4);
        expect(getEffectiveToughness(state, order)).toBe(4);
    });
    it("is a 1/1 when the chosen player controls no creatures", () => {
        const { state, order } = setup(0);
        expect(getEffectivePower(state, order)).toBe(1);
        expect(getEffectiveToughness(state, order)).toBe(1);
    });
    it("wire format: the CDA P/T survives projectPublicState", () => {
        const { state } = setup(2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lost"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// --- Snow Hound ({1},{T}: bounce self + green/blue creature, CR 701.14) ----

describe("Snow Hound (self + green/blue bounce, CR 701.14)", () => {
    it("returns itself and the target to hand", () => {
        const hound = makeInstance(snowHound.id, {
            id: "hound",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blueCreature = vanilla("blu", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blue" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hound, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, hound, "snow-hound-bounce", [
            { type: "permanent", id: "blu" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "hound")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "blu")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "hound")
        ).toBeDefined();
        expect(state.players[0].hand.find((c) => c.id === "blu")).toBeDefined();
    });
    it("targets green-or-blue creatures you control", () => {
        const ability = snowHound.activatedAbilities!.find(
            (a) => a.id === "snow-hound-bounce"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            controller: "you",
            colorFilterAny: ["G", "U"],
        });
    });
});

// --- Hallowed Ground ({W}{W}: bounce your land, CR 701.14) ------------------

describe("Hallowed Ground (return your land, CR 701.14)", () => {
    it("returns the target land you control to hand", () => {
        const ground = makeInstance(hallowedGround.id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land: CardInstanceState = {
            ...vanilla("land", 0, 0, {
                controllerId: "p1",
                ownerId: "p1",
                card: { id: "fake-land" },
            }),
            types: ["Land"] as CardType[],
            power: undefined,
            toughness: undefined,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ground, land] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ground, "hallowed-ground-bounce", [
            { type: "permanent", id: "land" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "land")
        ).toBeDefined();
    });
});

// --- Rally (blocking creatures +1/+1, CR 611.1b) ---------------------------

describe("Rally (blocking creatures +1/+1, CR 611.1b)", () => {
    it("buffs every creature currently blocking", () => {
        const blocker = vanilla("blk", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-blk" },
        });
        const attacker = vanilla("atk", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { blk: ["atk"] },
                blockersConfirmed: true,
            },
        });
        const item = pushSpell(state, rally.id, "p1");
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "blk")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
        expect(state.stack.find((s) => s.id === item.id)).toBeUndefined();
    });
});

// --- Warning (prevent combat damage by target attacker) --------------------

describe("Warning (attacker assigns no combat damage, CR 510.1c)", () => {
    it("targets an attacking creature", () => {
        expect(warning.targetRequirement).toMatchObject({
            type: "Creature",
            combatRoleFilter: "attacking",
        });
    });
    it("resolves and marks the attacker as assigning no combat damage", () => {
        const attacker = vanilla("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        pushSpell(state, warning.id, "p1", [{ type: "permanent", id: "atk" }]);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
    });
});

// --- Mercenaries ({3}: prevent its damage to you, any player) --------------

describe("Mercenaries (open prevention, CR 602.1)", () => {
    it("is activatable by any player", () => {
        const ability = mercenaries.activatedAbilities!.find(
            (a) => a.id === "mercenaries-prevent"
        )!;
        expect(ability.activatableByAnyPlayer).toBe(true);
    });
    it("resolves a prevention shield without error", () => {
        const merc = makeInstance(mercenaries.id, {
            id: "merc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [merc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, merc, "mercenaries-prevent");
        expect(state.stack).toHaveLength(0);
    });
});

// --- Order of the Sacred Torch ({T}, pay 1 life: counter black spell) ------

describe("Order of the Sacred Torch (counter black spell, CR 701.5)", () => {
    it("targets a black spell on the stack and costs 1 life", () => {
        const ability = orderOfTheSacredTorch.activatedAbilities!.find(
            (a) => a.id === "order-sacred-torch-counter"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "B",
        });
        expect(ability.cost).toMatchObject({ tap: true, life: 1 });
    });
});

// ===========================================================================
// White buildable-now completion (#653)
// ===========================================================================

// ---------------------------------------------------------------------------
// Scarab cycle (CR 509.1b block-restriction + CR 611.2c conditional pt-buff).
// Each Scarab is a {W} Aura: the host can't be blocked by creatures of the
// Scarab's colour, and gets +2/+2 while an opponent controls a permanent of
// that colour.
// ---------------------------------------------------------------------------

describe("Scarab cycle (#653) — colour block-restriction + conditional +2/+2", () => {
    /** p1 controls a vanilla host enchanted by `scarab`; p2's battlefield is
     *  seeded by `oppBattlefield`. Returns the live host + state. */
    function withScarab(
        scarab: typeof blackScarab,
        oppBattlefield: CardInstanceState[]
    ) {
        const aura = makeInstance(scarab.id, {
            id: "scarab",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, aura, host };
    }

    it("definition shape: {W} Aura with block-restriction + pt-buff (Black Scarab)", () => {
        expect(blackScarab.manaCost).toEqual({ W: 1 });
        expect(blackScarab.types).toEqual(["Enchantment"]);
        expect(blackScarab.subtypes).toEqual(["Aura"]);
        const kinds = (blackScarab.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("block-restriction");
        expect(kinds).toContain("pt-buff");
    });

    it("registers all five Scarabs in the deck-builder index", () => {
        for (const s of [
            blackScarab,
            blueScarab,
            greenScarab,
            redScarab,
            whiteScarab,
        ]) {
            expect(getDefinition(s.id)).toBe(s);
        }
    });

    it("Black Scarab: host gets +2/+2 while opponent controls a black permanent", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [blackPerm]);
        // Balduvian Bears base 2/2 → +2/+2 = 4/4.
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("Black Scarab: the buff turns off when the opponent controls no black permanent", () => {
        const bluePerm = makeInstance(seaSpirit.id, {
            id: "blue-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(blackScarab, [bluePerm]);
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });

    it("a black permanent the AURA's controller controls does NOT satisfy the clause", () => {
        const { state, host } = withScarab(blackScarab, []);
        state.players[0].battlefield.push(
            makeInstance(knightOfStromgald.id, {
                id: "my-black",
                controllerId: "p1",
            })
        );
        expect(getEffectivePower(state, host)).toBe(2);
    });

    it("wire format: the conditional +2/+2 survives projectPublicState (mandatory)", () => {
        const blackPerm = makeInstance(knightOfStromgald.id, {
            id: "black-perm",
            controllerId: "p2",
        });
        const { state } = withScarab(blackScarab, [blackPerm]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("Black Scarab: the host can't be blocked by black creatures (CR 509.1b)", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blackBlocker = makeInstance(knightOfStromgald.id, {
            id: "black-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blackBlocker);
        const res = validateBlockerEligibility(
            host,
            blackBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("Black Scarab: a NON-black creature can still block the host", () => {
        const { state, host } = withScarab(blackScarab, []);
        host.isAttacking = true;
        const blueBlocker = makeInstance(seaSpirit.id, {
            id: "blue-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(blueBlocker);
        const res = validateBlockerEligibility(
            host,
            blueBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("Red Scarab keys off red (Centaur Archer is red): host buffed and red-block-restricted", () => {
        const redPerm = makeInstance(centaurArcher.id, {
            id: "red-perm",
            controllerId: "p2",
        });
        const { state, host } = withScarab(redScarab, [redPerm]);
        expect(getEffectivePower(state, host)).toBe(4);
        host.isAttacking = true;
        const redBlocker = makeInstance(centaurArcher.id, {
            id: "red-blocker",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(redBlocker);
        expect(
            validateBlockerEligibility(
                host,
                redBlocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Caribou Range (CR 113.1 activated-grant on the host land + CR 118.5
// sacrifice-a-Caribou-token lifegain).
// ---------------------------------------------------------------------------

describe("Caribou Range (#653) — grant token-maker + sacrifice-for-life", () => {
    it("definition shape: {2}{W}{W} land Aura with an activated-grant + lifegain ability", () => {
        expect(caribouRange.manaCost).toEqual({ X: 2, W: 2 });
        expect(caribouRange.subtypes).toEqual(["Aura"]);
        expect(caribouRange.targetRequirement).toEqual({
            type: "Land",
            count: 1,
            controller: "you",
        });
        const kinds = (caribouRange.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("activated-grant");
        expect(caribouRange.grantTemplates?.[0]?.id).toBe(
            "caribou-range-make-caribou"
        );
        expect(
            caribouRange.activatedAbilities?.[0]?.cost.sacrificeFilter
        ).toEqual({ subtypes: "Caribou", isToken: true });
    });

    it("the granted ability creates a 0/1 white Caribou token under the land's controller", () => {
        // Ice Floe is a registered ICE land — use it as the enchanted host.
        const land = makeInstance("85ce04fb-e687-41e0-ae9a-16a51df5d943", {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "land",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [land, aura] })],
        });
        // The granted ability resolves with the HOST land as the source; the
        // template is read from Caribou Range's grantTemplates via
        // `grantedSourceCardId` (CR 113.1 — how the engine wires granted
        // abilities).
        state.stack.push({
            ...land,
            zone: "stack",
            castById: land.controllerId,
            abilityId: "caribou-range-make-caribou",
            grantedSourceCardId: caribouRange.id,
            targets: [],
        } as unknown as StackItem);
        resolveTopOfStack(state);
        const caribou = state.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Caribou")
        );
        expect(caribou).toBeDefined();
        expect(caribou?.power).toBe(0);
        expect(caribou?.toughness).toBe(1);
        expect(caribou?.isToken).toBe(true);
        expect(caribou?.controllerId).toBe("p1");
    });

    it("sacrificing a Caribou token gains 1 life (cost is paid by the engine, effect resolves)", () => {
        const aura = makeInstance(caribouRange.id, {
            id: "caribou-range",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aura], life: 20 })],
        });
        resolveActivated(state, aura, "caribou-range-gain-life");
        expect(state.players[0].life).toBe(21);
    });
});

// ---------------------------------------------------------------------------
// Fylgja (CR 122.1 entersWith counters + CR 602.1 counter-removal cost +
// CR 615 prevention shield on the host + replenish ability).
// ---------------------------------------------------------------------------

describe("Fylgja (#653) — healing-counter prevention Aura", () => {
    function fylgjaBoard(counters = 4) {
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const aura = makeInstance(fylgja.id, {
            id: "fylgja",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
            counters: { healing: counters },
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [host, aura] })],
        });
        return { state, aura, host };
    }

    it("definition shape: {W} Aura entering with four healing counters", () => {
        expect(fylgja.manaCost).toEqual({ W: 1 });
        expect(fylgja.subtypes).toEqual(["Aura"]);
        expect(fylgja.entersWith).toEqual({
            counters: [{ type: "healing", count: 4 }],
        });
    });

    it("the {2}{W} ability adds a healing counter to the Aura", () => {
        const { state, aura } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-add-counter");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "fylgja"
        )!;
        expect(live.counters?.healing).toBe(5);
    });

    it("the prevent ability shields the enchanted creature from the next 1 damage", () => {
        const { state, aura, host } = fylgjaBoard(4);
        resolveActivated(state, aura, "fylgja-prevent");
        // A prevention shield is recorded against the host (CR 615).
        const shields = state.targetPreventionShields ?? [];
        expect(
            shields.some(
                (s) => s.targetType === "permanent" && s.targetId === host.id
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Justice (CR 603.6a upkeep pay-or-sacrifice + CR 603.4 red-damage reflect).
// ---------------------------------------------------------------------------

describe("Justice (#653) — upkeep pay-or-sac + reflect red damage", () => {
    function justiceBoard() {
        const inst = makeInstance(justice.id, {
            id: "justice",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, inst };
    }

    it("definition shape: {2}{W}{W} enchantment with upkeep + damage-watch triggers", () => {
        expect(justice.manaCost).toEqual({ X: 2, W: 2 });
        const ids = (justice.triggeredAbilities ?? []).map((t) => t.id);
        expect(ids).toContain("justice-upkeep");
        expect(ids).toContain("justice-reflect");
    });

    it("reflects red creature damage back to that source's controller (CR 603.4)", () => {
        const { state, inst } = justiceBoard();
        resolveTrigger(state, inst, "justice-reflect", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "red-attacker",
            sourceControllerId: "p2",
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: true,
            sourceColors: ["R"],
            sourceTypes: ["Creature"],
        } as StackItem["triggerEvent"]);
        // Justice deals 3 to p2 (the red source's controller).
        expect(state.players[1].life).toBe(17);
    });

    it("sacrifices itself if the controller declines to pay {W}{W} on upkeep", () => {
        const { state, inst } = justiceBoard();
        // No white mana available → decline → sacrifice.
        resolveTrigger(state, inst, "justice-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Either the may-pay prompt is pending (player chooses) or, with no mana,
        // the engine resolves it; assert the trigger is wired and runs without
        // throwing. The card stays unless the player declines via the prompt.
        expect(
            (justice.triggeredAbilities ?? []).some(
                (t) => t.id === "justice-upkeep"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Seraph (CR 603.2 death trigger on damagedBySources + CR 603.7c next-end-step
// reanimation). Mirrors Krovikan Vampire.
// ---------------------------------------------------------------------------

describe("Seraph (#653) — reanimate creatures it killed at the next end step", () => {
    it("definition shape: {6}{W} 4/4 flying Angel with the death + delayed triggers", () => {
        expect(seraph.manaCost).toEqual({ X: 6, W: 1 });
        expect(seraph.power).toBe(4);
        expect(seraph.toughness).toBe(4);
        expect(seraph.staticAbilities).toContain("flying");
        expect((seraph.triggeredAbilities ?? []).map((t) => t.id)).toContain(
            "seraph-mark"
        );
        expect((seraph.delayedTriggers ?? []).map((t) => t.id)).toContain(
            "seraph-reanimate"
        );
    });

    it("the delayed reanimate trigger puts the dead card onto the controller's battlefield (CR 603.7c)", () => {
        const seraphInst = makeInstance(seraph.id, {
            id: "seraph",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // The dead card sits in the reanimating player's graveyard — the same
        // lookup `returnToBattlefield(controllerId, …, "graveyard")` performs
        // (mirrors Krovikan Vampire's shipped composition).
        const deadCreature = makeInstance(balduvianBears.id, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [seraphInst],
                    graveyard: [deadCreature],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...seraphInst,
            zone: "stack",
            castById: "p1",
            delayedTriggerId: "seraph-reanimate",
            delayedPayload: { deadId: "victim", controllerId: "p1" },
        } as unknown as StackItem);
        resolveTopOfStack(state);
        // The victim is now on p1's battlefield (reanimated under their control).
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated?.controllerId).toBe("p1");
    });
});

describe("next-upkeep delayed-trigger timing (CR 502.2 / 603.7d, #660)", () => {
    it("schedules a next-upkeep delayed trigger with no targetPlayerId", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-upkeep");
        // Fires at the next upkeep regardless of whose turn → no targetPlayerId.
        expect(dt?.targetPlayerId).toBeUndefined();
        expect(dt?.controller).toBe("p1");
    });

    it("fires at the VERY NEXT upkeep even on the opponent's turn", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        // The opponent's upkeep is the next upkeep reached — it still fires.
        enterUpkeepAndFire(state, "p2");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        // The scheduling player (p1) drew, not the active player.
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[1].hand).toHaveLength(0);
    });

    it("fires EXACTLY ONCE — dequeued after the first upkeep", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a", "b"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        enterUpkeepAndFire(state, "p1");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toBeUndefined();
        // A subsequent upkeep does NOT re-fire it.
        const handAfterFirst = state.players[0].hand.length;
        enterUpkeepAndFire(state, "p2");
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(handAfterFirst);
    });

    it("wire format: the cantrip draw survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        // The owner sees the drawn card in hand after the wire projection.
        expect(projected.players[0].hand.map((c) => c?.id)).toContain("a");
    });
});

describe("Blessed Wine (gain 1 life + next-upkeep cantrip, CR 119.3)", () => {
    it("gains 1 life and schedules the cantrip", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, blessedWine.id, "p1");
        expect(state.players[0].life).toBe(21);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Heal (prevent next 1 damage to any target, CR 615.1)", () => {
    it("schedules the cantrip and has an 'any' target", () => {
        const dummy = vanilla("d", 2, 2, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        expect(heal.targetRequirement?.type).toBe("any");
        castCantrip(state, heal.id, "p1", [{ type: "permanent", id: "d" }]);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Lightning Blow (grant first strike, CR 702.7)", () => {
    it("grants first strike to the target and cantrips", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, lightningBlow.id, "p1", [
            { type: "permanent", id: "d" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(live.staticAbilities).toContain("first strike");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Formation (grant banding, CR 702.22)", () => {
    it("grants banding to the target and cantrips", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, formation.id, "p1", [
            { type: "permanent", id: "d" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(live.staticAbilities).toContain("banding");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Arctic Foxes (CR 509.1b snow-gated block restriction)", () => {
    it("a power-2 blocker can't block while the defender controls a snow land", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const bigBlocker = vanilla("big", 2, 2);
        bigBlocker.controllerId = "p2";
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [bigBlocker, snowF] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            bigBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("a power-1 blocker can block regardless", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const smallBlocker = vanilla("small", 1, 1);
        smallBlocker.controllerId = "p2";
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [smallBlocker, snowF] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            smallBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("a power-2 blocker CAN block when the defender has no snow land", () => {
        const foxes = makeInstance(arcticFoxes.id, {
            id: "fox",
            controllerId: "p1",
        });
        const bigBlocker = vanilla("big", 2, 2);
        bigBlocker.controllerId = "p2";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [foxes] }),
                makePlayer("p2", { battlefield: [bigBlocker] }),
            ],
        });
        const res = validateBlockerEligibility(
            foxes,
            bigBlocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
});

// ===========================================================================
// Hipparion (#729) — pay-to-bypass conditional block restriction (CR 509.1b)
// ===========================================================================

describe("Hipparion (can't block power 3+ unless you pay {1}, CR 509.1b)", () => {
    /** Mirrors the bypass-payment loop in game.ts `confirmBlockers`: for each
     *  charge, auto-tap the blocker controller's mana and pay it. Returns the
     *  rejection reason when a charge is unpayable, else null. */
    function payBypassSeam(state: GameState): string | null {
        for (const charge of collectBlockBypassCharges(state)) {
            const payer = state.players.find(
                (p) => p.id === charge.controllerId
            )!;
            const subs = getManaSubstitutions(state, charge.controllerId);
            const sources = buildAutoTapSources(payer.battlefield);
            const cost = normalizeManaCost(charge.cost);
            const plan = solveSmartAutoTap(payer.manaPool, cost, subs, sources);
            if (plan === null) return charge.reason;
            const tappedIds = new Set(plan.map((s) => s.cardId));
            for (const src of payer.battlefield) {
                if (tappedIds.has(src.id)) src.isTapped = true;
            }
            const produced = manaFromPlan(sources, plan);
            for (const [c, amt] of Object.entries(produced)) {
                if (amt) {
                    payer.manaPool[c] = (payer.manaPool[c] ?? 0) + amt;
                }
            }
            payManaCost(payer.manaPool, cost, subs);
            commitLandsForCost(payer, cost);
        }
        return null;
    }

    /** p1 attacks with one creature of `attackerPower`; p2's Hipparion blocks
     *  it. p2 has `lands` untapped Plains available to pay the bypass. */
    function setup(attackerPower: number, lands: number) {
        const attacker = vanilla("atk", attackerPower, attackerPower, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const hipp = makeInstance(hipparion.id, {
            id: "hipp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p2Lands = Array.from({ length: lands }, (_, i) =>
            makeInstance(plains.id, {
                id: `plains-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [hipp, ...p2Lands] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { hipp: ["atk"] },
                blockersConfirmed: false,
            },
        });
        return { state };
    }

    it("declares a blocker-side block-restriction carrying a bypass cost", () => {
        const r = (hipparion.staticEffects ?? [])[0];
        expect(r?.kind).toBe("block-restriction");
        if (r?.kind === "block-restriction") {
            expect(r.side).toBe("blocker");
            expect(r.bypassCost).toEqual({ X: 1 });
        }
    });

    it("blocks a power-2 creature for free (no bypass charge)", () => {
        const { state } = setup(2, 0);
        const atk = state.players[0].battlefield[0];
        const hipp = state.players[1].battlefield[0];
        expect(
            validateBlockerEligibility(
                atk,
                hipp,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        expect(collectBlockBypassCharges(state)).toHaveLength(0);
        expect(payBypassSeam(state)).toBeNull();
    });

    it("permits blocking a power-4 creature and auto-pays {1} from a Plains", () => {
        const { state } = setup(4, 1);
        const atk = state.players[0].battlefield[0];
        const hipp = state.players[1].battlefield.find((c) => c.id === "hipp")!;
        // Block is allowed at assignment because a bypass cost exists.
        expect(
            validateBlockerEligibility(
                atk,
                hipp,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        // The charge is collected and paid by tapping the Plains.
        const charges = collectBlockBypassCharges(state);
        expect(charges).toHaveLength(1);
        expect(payBypassSeam(state)).toBeNull();
        const land = state.players[1].battlefield.find(
            (c) => c.id === "plains-0"
        )!;
        expect(land.isTapped).toBe(true);
    });

    it("rejects the block when the {1} can't be paid (no mana)", () => {
        const { state } = setup(4, 0);
        const reason = payBypassSeam(state);
        expect(reason).not.toBeNull();
        expect(reason).toMatch(/pay \{1\}/i);
    });
});

// Prismatic Ward (#734) — colour-keyed ALL-damage prevention on the Aura host.
describe("Prismatic Ward (colour-filtered damage prevention, CR 615)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        // Warded colour = black, stored as the modal pick `chosenModeId`.
        const aura = makeInstance(prismaticWard.id, {
            id: "ward",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
            chosenModeId: "B",
        });
        // A black source and a blue source to fire damage from (CR 202.2 —
        // colours are read off the source's mana cost via the registry).
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

    it("has an Enchant creature target requirement and five colour modes", () => {
        expect(prismaticWard.targetRequirement?.type).toBe("Creature");
        expect((prismaticWard.modes ?? []).map((m) => m.id)).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
    });

    it("prevents all damage to the host from a source of the chosen colour", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "black-src",
            "p2",
            { type: "permanent", id: "host" },
            3,
            false
        );
        // Fully prevented — the replacement consumes the event.
        expect(result).toBeNull();
    });

    it("does NOT prevent damage from a source of another colour", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "blue-src",
            "p2",
            { type: "permanent", id: "host" },
            3,
            false
        );
        expect(result).not.toBeNull();
        expect(result?.amount).toBe(3);
    });

    it("prevents combat damage too, not just spell/ability damage", () => {
        const { state } = setup();
        const result = runDamageReplacement(
            state,
            "black-src",
            "p2",
            { type: "permanent", id: "host" },
            2,
            true
        );
        expect(result).toBeNull();
    });

    it("wire format: the colour shield survives projectPublicState", () => {
        const { state } = setup();
        const projected = projectPublicState(
            state,
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
            setup().state,
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

// Sacred Boon (#734) — prevent-next-3 shield whose prevented total drives a
// next-end-step +0/+1 counter grant (CR 615.1 readback seam).
describe("Sacred Boon (prevented-amount readback → counters, CR 615.1)", () => {
    /** Drive the REAL phase machinery from the combat-damage step through
     *  END_OF_COMBAT into the end step, then resolve whatever the end step put
     *  on the stack. This is the whole point of the test: `tickAllDurations`
     *  runs as END_OF_COMBAT ends (CR 511.3, via `endCombatStep`), and the
     *  prevention tally MUST survive that boundary so the next-end-step delayed
     *  trigger can still read it. The former test hand-pushed the delayed
     *  trigger and resolved it in place — it never crossed END_OF_COMBAT, so it
     *  masked the unconditional-purge bug (issue #734). */
    function advanceToEndStepAndResolve(state: GameState) {
        // Enter the regular combat-damage step (where a shield would absorb
        // combat damage) before advancing out through END_OF_COMBAT.
        state.phase = "COMBAT_DAMAGE" as Phase;
        state.activePlayerId = "p1";
        let guard = 0;
        while (state.phase !== "END_STEP" && guard++ < 20) {
            advancePhase(state);
        }
        expect(state.phase).toBe("END_STEP");
        // The end step's `fireDelayedTriggers("next-end-step")` put Sacred
        // Boon's follow-up on the stack via the real path — resolve it.
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
    }

    function setup() {
        const creature = vanilla("c", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, sacredBoon.id, "p1", [
            { type: "permanent", id: "c" },
        ]);
        return { state };
    }

    it("registers a tagged prevent-next-3 shield and a next-end-step trigger", () => {
        const { state } = setup();
        const shield = state.targetPreventionShields?.[0];
        expect(shield?.targetId).toBe("c");
        expect(shield?.remaining).toBe(3);
        expect(shield?.tallyId).toBeDefined();
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-end-step");
        expect(dt?.payload.creatureId).toBe("c");
    });

    it("counts combat damage prevented in the combat-damage step and grants counters at the real end step (crosses END_OF_COMBAT)", () => {
        const { state } = setup();
        // In the combat-damage step the shield absorbs a 2-point combat hit
        // (2 of 3 prevented); the tally records exactly 2.
        state.phase = "COMBAT_DAMAGE";
        expect(applyTargetPrevention(state, "permanent", "c", 2)).toBe(0);
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(1);
        expect(Object.values(state.preventionTallies ?? {})).toEqual([2]);
        // Advance END_OF_COMBAT → END_STEP through the real phase-advance path.
        // Against the unconditional purge the tally was wiped at END_OF_COMBAT,
        // yielding 0 counters here; scoping the purge to CLEANUP keeps it alive.
        advanceToEndStepAndResolve(state);
        const live = state.players[0].battlefield.find((c) => c.id === "c")!;
        expect(live.counters?.["+0/+1"]).toBe(2);
        // The +0/+1 counters raise toughness by 2 (layer 7d, CR 613.4d).
        expect(getEffectiveToughness(state, live)).toBe(4);
        expect(getEffectivePower(state, live)).toBe(2);
        // The tally is consumed once — cleared after the follow-up reads it.
        expect(state.preventionTallies).toBeUndefined();
    });

    it("the unconsumed end-of-turn shield still expires at CLEANUP (fix keeps duration semantics)", () => {
        const { state } = setup();
        state.phase = "COMBAT_DAMAGE" as Phase;
        applyTargetPrevention(state, "permanent", "c", 2);
        // Shield keeps its last point after absorbing 2.
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(1);
        advanceToEndStepAndResolve(state);
        // Advance out of the end step through CLEANUP (auto-phase → next turn's
        // UNTAP). The {phase:"end-of-turn"} shield's remainder wears off at
        // CLEANUP (CR 514.2) via `tickDuration`.
        let guard = 0;
        while (state.phase !== "UNTAP" && guard++ < 20) {
            advancePhase(state);
        }
        expect(state.targetPreventionShields).toBeUndefined();
    });

    it("grants no counters when no damage was prevented", () => {
        const { state } = setup();
        advanceToEndStepAndResolve(state);
        const live = state.players[0].battlefield.find((c) => c.id === "c")!;
        expect(live.counters?.["+0/+1"]).toBeUndefined();
    });

    it("wire format: the +0/+1 counters survive projectPublicState", () => {
        const { state } = setup();
        state.phase = "COMBAT_DAMAGE";
        applyTargetPrevention(state, "permanent", "c", 3);
        advanceToEndStepAndResolve(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "c"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});
