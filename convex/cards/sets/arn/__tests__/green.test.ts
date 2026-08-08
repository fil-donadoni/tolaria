// Per-card behavior tests for green cards in `convex/cards/sets/arn/green.ts`
// (ARN, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (effective P/T, damage, zone, combat outcome).

import { describe, it, expect } from "vitest";
import {
    birdMaiden,
    cyclone,
    desertTwister,
    dropOfHoney,
    erhnamDjinn,
    flyingMen,
    ghazbanOgre,
    ifhBiffEfreet,
    metamorphosis,
    nafsAsp,
    sandstorm,
    serendibEfreet,
    singingTree,
    wyluliWolf,
} from "..";
import { forest, grizzlyBears } from "../../lea";
import { getInstanceManaCost, tryGetDefinition } from "../../../";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { validateBlockerEligibility } from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type CardInstanceState,
    type GameState,
    getManaSubstitutions,
    isManaCostCovered,
    normalizeManaCost,
    payManaCostForSpell,
    resolveTopOfStack,
    restrictionAllowsSpell,
    spendablePoolForSpell,
    type StackItem,
} from "../../../../gre/state";
import {
    resolveActivated,
    resolveTrigger,
    answerChoice,
    upkeepEvent,
} from "./helpers";

describe("Sandstorm (1 damage to each attacking creature)", () => {
    it("kills a 1-toughness attacker, spares a non-attacker", () => {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
            toughness: 1,
            power: 1,
        });
        const idle = makeInstance(grizzlyBears.id, {
            id: "idle",
            controllerId: "p2",
            ownerId: "p2",
            toughness: 1,
            power: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [attacker, idle] }),
            ],
        });
        pushSpell(state, sandstorm.id, "p1");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "atk")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "idle")).toBeDefined();
    });
});

describe("Desert Twister (destroy target permanent)", () => {
    it("destroys a target creature", () => {
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, desertTwister.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
    });
});

describe("Wyluli Wolf ({T}: target creature +1/+1 EOT)", () => {
    it("pumps the target until end of turn", () => {
        const wolf = makeInstance(wyluliWolf.id, { id: "wolf" });
        const target = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wolf, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wolf, "wyluli-wolf-pump", [
            { type: "permanent", id: "bear" },
        ]);
        expect(getEffectivePower(state, target)).toBe(3);
        expect(getEffectiveToughness(state, target)).toBe(3);
    });
});

describe("Erhnam Djinn (upkeep: target non-Wall creature gains forestwalk)", () => {
    function setup() {
        const erhnam = makeInstance(erhnamDjinn.id, {
            id: "erhnam",
            controllerId: "p1",
        });
        const forestP1 = makeInstance(forest.id, {
            id: "fp1",
            controllerId: "p1",
        });
        const blocker = makeInstance(serendibEfreet.id, {
            id: "blk",
            controllerId: "p1",
            subtypes: ["Wizard"], // a non-Wall blocker for p1
        });
        const bear = makeInstance(serendibEfreet.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const wall = makeInstance(serendibEfreet.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [erhnam, forestP1, blocker] }),
                makePlayer("p2", { battlefield: [bear, wall] }),
            ],
        });
        return { state, erhnam, bear, wall, blocker };
    }

    /** Puts Erhnam's upkeep trigger on the stack with its target slot UNSET
     *  (targets: undefined), the shape `raiseTriggerTargetSelection` scans for
     *  (CR 603.3d, issue #1193). Mirrors Phelia's `pheliaAttackTriggerOnStack`
     *  reference helper (mh3/white.test.ts). */
    function erhnamTriggerOnStack(
        state: GameState,
        source: CardInstanceState
    ): StackItem {
        const trig: StackItem = {
            ...source,
            id: "erhnam-trig",
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "erhnam-djinn-forestwalk",
            triggerSourceId: source.id,
            triggerEvent: upkeepEvent(source.controllerId),
            targets: undefined,
        };
        state.stack.push(trig);
        return trig;
    }

    /** Drives the trigger to resolution through the real target machinery:
     *  `raiseTriggerTargetSelection` either auto-selects the sole legal target
     *  (returns false) or raises a `kind:"trigger"` PendingTarget the caller
     *  finalizes with `targetId`. Then `resolveTopOfStack` runs the grant. */
    function fireErhnam(
        state: GameState,
        source: CardInstanceState,
        targetId?: string
    ): StackItem {
        const trig = erhnamTriggerOnStack(state, source);
        const raised = raiseTriggerTargetSelection(state);
        if (raised) {
            state.pendingTarget!.selected = [
                { type: "permanent", id: targetId! },
            ];
            finalizeTargetSelection(
                state,
                state.pendingTarget!,
                state.pendingTarget!.playerId
            );
        }
        resolveTopOfStack(state);
        return trig;
    }

    it("auto-selects the sole legal non-Wall opponent creature (CR 603.3d) and grants forestwalk until your next upkeep", () => {
        const { state, erhnam } = setup();
        const trig = erhnamTriggerOnStack(state, erhnam);
        // Sole mandatory target (only p2's non-Wall "bear" is legal — the Wall
        // is excluded by `excludeSubtypes`, p1's own creatures by
        // `controller: "opponent"`): auto-selected, no PendingTarget raised.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "bear" }]);
        expect(state.pendingTarget).toBeUndefined();

        resolveTopOfStack(state);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.staticAbilities).toContain("forestwalk");
        // "Until your next upkeep" — scoped to Erhnam's controller (p1).
        expect(target.grantedStaticAbilities).toContainEqual({
            ability: "forestwalk",
            duration: { phase: "upkeep", playerId: "p1" },
        });
    });

    it("raises a target choice when two+ non-Wall opponent creatures are legal (CR 603.3d)", () => {
        const { state, erhnam } = setup();
        const bear2 = makeInstance(serendibEfreet.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(bear2);
        const trig = erhnamTriggerOnStack(state, erhnam);
        // Two legal targets → a real choice: PendingTarget raised on the
        // controller (p1), not auto-selected.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.playerId).toBe("p1");
        expect(state.pendingTarget?.kind).toBe("trigger");

        state.pendingTarget!.selected = [{ type: "permanent", id: "bear2" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        expect(trig.targets).toEqual([{ type: "permanent", id: "bear2" }]);

        resolveTopOfStack(state);
        // Only the chosen creature gains forestwalk.
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear2")
                ?.staticAbilities
        ).toContain("forestwalk");
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.staticAbilities
        ).not.toContain("forestwalk");
    });

    it("removes the trigger from the stack when no non-Wall opponent creature is legal (CR 603.3c)", () => {
        const erhnam = makeInstance(erhnamDjinn.id, {
            id: "erhnam",
            controllerId: "p1",
        });
        const wall = makeInstance(serendibEfreet.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [erhnam] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        erhnamTriggerOnStack(state, erhnam);
        // Required single target, none legal (only a Wall on the opponent's
        // side) → the trigger is removed from the stack and does nothing.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("makes the target unblockable while the defender controls a Forest (CR 702.13b)", () => {
        const { state, erhnam, blocker } = setup();
        fireErhnam(state, erhnam, "bear");
        const attacker = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        // p1 (the defender) controls a Forest → forestwalk blocks the block.
        expect(
            validateBlockerEligibility(
                attacker,
                blocker,
                state.players[0].battlefield,
                state
            ).eligible
        ).toBe(false);
        // Remove the Forest → the creature can be blocked again.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "fp1"
        );
        expect(
            validateBlockerEligibility(
                attacker,
                blocker,
                state.players[0].battlefield,
                state
            ).eligible
        ).toBe(true);
    });

    it("forestwalk survives the wire projection (visible static ability)", () => {
        const { state, erhnam } = setup();
        fireErhnam(state, erhnam, "bear");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("forestwalk");
    });
});

describe("Singing Tree ({T}: target attacking creature base power 0)", () => {
    it("sets the target's base power to 0, leaving toughness", () => {
        const tree = makeInstance(singingTree.id, { id: "tree" });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tree] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, tree, "singing-tree-set-power", [
            { type: "permanent", id: "atk" },
        ]);
        const bear = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(getEffectivePower(state, bear)).toBe(0);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });
});

describe("Ghazbán Ogre (upkeep: control to the unique most-life player, CR 603.4)", () => {
    it("moves to the player with strictly the most life at upkeep", () => {
        const ogre = makeInstance(ghazbanOgre.id, {
            id: "ogre",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 15, battlefield: [ogre] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveTrigger(state, ogre, "ghazban-ogre-upkeep", upkeepEvent("p1"));
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ogre")
                ?.controllerId
        ).toBe("p2");
    });

    it("does not move on a life tie (no unique most-life player)", () => {
        const ogre = makeInstance(ghazbanOgre.id, {
            id: "ogre",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [ogre] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveTrigger(state, ogre, "ghazban-ogre-upkeep", upkeepEvent("p1"));
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "ogre")
                ?.controllerId
        ).toBe("p1");
    });
});

describe("Nafs Asp (damage → next-draw-step pay {1} or lose 1 life)", () => {
    // Migrated to effects[] (ADR 0049, issue #865): the damage trigger schedules
    // an INLINE delayedTrigger (ADR 0048) reading `$event.damagedPlayer`, so the
    // scheduled body rides on the instance (no `nafs-asp-draw-step` template) and
    // the captured player lives under the binding name `$victim`.
    const damageP2 = (asp: CardInstanceState): StackItem["triggerEvent"] =>
        ({
            type: "DAMAGE_DEALT",
            sourceInstanceId: asp.id,
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 1,
            isCombat: true,
        }) as StackItem["triggerEvent"];

    it("schedules a next-draw-step delayed trigger on the damaged player", () => {
        const asp = makeInstance(nafsAsp.id, {
            id: "asp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [asp] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, asp, "nafs-asp-damage", damageP2(asp));
        const dt = state.delayedTriggers?.[0];
        expect(dt?.timing).toBe("next-draw-step");
        // targetPlayer + capture both resolve through $event.damagedPlayer.
        expect(dt?.targetPlayerId).toBe("p2");
        expect(dt?.payload["victim"]).toBe("p2");
    });

    it("fires only on the target player's draw step; declining loses 1 life", () => {
        const asp = makeInstance(nafsAsp.id, {
            id: "asp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [asp] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        // Deal damage to p2 → schedule the draw-step trigger on p2.
        resolveTrigger(state, asp, "nafs-asp-damage", damageP2(asp));
        expect(state.delayedTriggers).toHaveLength(1);

        // p1's draw step does NOT fire it (wrong player).
        state.activePlayerId = "p1";
        fireDelayedTriggers(state, "next-draw-step");
        expect(state.stack).toHaveLength(0);
        expect(state.delayedTriggers).toHaveLength(1);

        // p2's draw step fires it.
        state.activePlayerId = "p2";
        fireDelayedTriggers(state, "next-draw-step");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state); // suspends at the may-pay
        answerChoice(state, ["decline"]);
        expect(state.players[1].life).toBe(19);
    });

    it("paying {1} avoids the life loss", () => {
        const asp = makeInstance(nafsAsp.id, {
            id: "asp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [asp] }),
                makePlayer("p2", {
                    life: 20,
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
                }),
            ],
        });
        resolveTrigger(state, asp, "nafs-asp-damage", damageP2(asp));
        state.activePlayerId = "p2";
        fireDelayedTriggers(state, "next-draw-step");
        resolveTopOfStack(state); // suspends at the may-pay
        answerChoice(state, ["yes"]);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Cyclone (upkeep: wind counter, pay {G}/counter or sacrifice + damage-each)", () => {
    it("declining the payment sacrifices Cyclone", () => {
        const cyc = makeInstance(cyclone.id, { id: "cyc" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cyc] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, cyc, "cyclone-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["decline"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("paying adds a wind counter and deals that many to each creature and player", () => {
        const cyc = makeInstance(cyclone.id, { id: "cyc" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [cyc],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
                }),
                makePlayer("p2", { life: 20, battlefield: [bear] }),
            ],
        });
        resolveTrigger(state, cyc, "cyclone-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["yes"]);
        const cycAfter = state.players[0].battlefield.find(
            (c) => c.id === "cyc"
        )!;
        expect(cycAfter.counters?.wind).toBe(1);
        // 1 damage to each creature and each player.
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.damageMarked
        ).toBe(1);
    });
});

describe("Drop of Honey (upkeep: destroy least-power; sac when no creatures)", () => {
    it("destroys the single least-power creature (can't be regenerated)", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const weak = makeInstance(flyingMen.id, { id: "weak" }); // 1/1
        const strong = makeInstance(grizzlyBears.id, {
            id: "strong",
            controllerId: "p2",
            ownerId: "p2",
        }); // 2/2
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop, weak] }),
                makePlayer("p2", { battlefield: [strong] }),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-upkeep", upkeepEvent("p1"));
        expect(
            state.players[0].battlefield.find((c) => c.id === "weak")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "strong")
        ).toBeDefined();
    });

    it("asks the controller to choose among power ties", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const g1 = makeInstance(grizzlyBears.id, { id: "g1" });
        const g2 = makeInstance(grizzlyBears.id, { id: "g2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop, g1, g2] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-upkeep", upkeepEvent("p1"));
        answerChoice(state, ["g2"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "g2")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "g1")
        ).toBeDefined();
    });

    it("sacrifices itself when there are no creatures (state trigger)", () => {
        const drop = makeInstance(dropOfHoney.id, { id: "drop" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drop] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, drop, "drop-of-honey-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Metamorphosis (CR 106.6 restricted mana / 117.9 additional cost)", () => {
    // Push Metamorphosis as if cast: a color mode chosen at announcement
    // (CR 700.2c) and the sacrificed creature's mana value snapshotted
    // (CR 117.9), then resolve so the chosen mode's body runs.
    function resolveMetamorphosis(
        state: GameState,
        modeId: string,
        sacrificedMv: number
    ): void {
        const item = pushSpell(state, metamorphosis.id, "p1");
        item.chosenModeId = modeId;
        item.additionalSacrificeSnapshot = {
            cardInstanceId: "sac",
            mv: sacrificedMv,
        };
        resolveTopOfStack(state);
    }

    it("adds 1 + sacrificed mana value as restricted mana of the chosen color", () => {
        const state = makeState();
        resolveMetamorphosis(state, "red", 3); // X = 1 + 3
        expect(state.players[0].restrictedMana).toEqual([
            { color: "R", amount: 4, restriction: "creature-spell" },
        ]);
        // Nothing leaks into the fungible pool.
        expect(state.players[0].manaPool.R).toBe(0);
    });

    it("maps each color mode to the matching mana color", () => {
        const cases: [string, string][] = [
            ["white", "W"],
            ["blue", "U"],
            ["black", "B"],
            ["red", "R"],
            ["green", "G"],
        ];
        for (const [modeId, color] of cases) {
            const state = makeState();
            resolveMetamorphosis(state, modeId, 0); // X = 1
            expect(state.players[0].restrictedMana).toEqual([
                { color, amount: 1, restriction: "creature-spell" },
            ]);
        }
    });

    it("restrictionAllowsSpell gates creature-spell mana correctly", () => {
        expect(restrictionAllowsSpell("creature-spell", ["Creature"])).toBe(
            true
        );
        expect(restrictionAllowsSpell("creature-spell", ["Sorcery"])).toBe(
            false
        );
    });

    // Integration across the GRE -> game.ts spell-cast boundary: mirror the
    // affordability check + payment that the cast mutations perform for a
    // creature vs a noncreature spell (CR 106.6).
    it("pays a creature spell from restricted mana but rejects a noncreature spell", () => {
        const subs = getManaSubstitutions(makeState(), "p1"); // [] — no Sunglasses
        const creatureCost = normalizeManaCost(
            getInstanceManaCost(
                makeInstance(grizzlyBears.id, { zone: "hand" })
            )!
        ); // Grizzly Bears {1}{G} -> { X: 1, G: 1 }
        const creatureTypes = tryGetDefinition(grizzlyBears.id)!.types;

        const caster = makePlayer("p1", {
            restrictedMana: [
                { color: "G", amount: 4, restriction: "creature-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(caster, creatureTypes),
                creatureCost,
                subs
            )
        ).toBe(true);
        payManaCostForSpell(caster, creatureCost, creatureTypes, subs);
        // Cost is 2 (one green pip + one generic), both drawn from restricted.
        expect(caster.restrictedMana).toEqual([
            { color: "G", amount: 2, restriction: "creature-spell" },
        ]);
        expect(caster.manaPool.G).toBe(0);

        // Same pool, but the spell is NOT a creature spell -> not spendable.
        const noncreature = makePlayer("p1", {
            restrictedMana: [
                { color: "G", amount: 4, restriction: "creature-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(noncreature, ["Sorcery"]),
                creatureCost,
                subs
            )
        ).toBe(false);
    });

    it("drains restricted mana before the fungible pool (settlement policy)", () => {
        const player = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 },
            restrictedMana: [
                { color: "G", amount: 2, restriction: "creature-spell" },
            ],
        });
        payManaCostForSpell(player, { G: 2 }, ["Creature"], []);
        // Restricted mana emptied first; the fungible green is untouched.
        expect(player.restrictedMana).toBeUndefined();
        expect(player.manaPool.G).toBe(3);
    });

    it("restricted mana survives the wire projection (CR 106.6)", () => {
        const state = makeState();
        resolveMetamorphosis(state, "green", 1); // X = 2 green
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            { color: "G", amount: 2, restriction: "creature-spell" },
        ]);
    });
});

describe("Ifh-Bíff Efreet (any-player-activatable mass flyer damage, CR 113.3c / 120.3)", () => {
    /** p1 controls the Efreet (3/3 flyer), a tough flyer (Bird Maiden 1/2,
     *  survives the ping so its `damageMarked` is observable), and a ground
     *  creature (Grizzly Bears). p2 controls a tough flyer (Bird Maiden), a
     *  ground creature (Grizzly Bears), and a fragile flyer (Flying Men 1/1)
     *  that dies to the 1 damage — proving the sweep hits flyers lethally. */
    function setup() {
        const efreet = makeInstance(ifhBiffEfreet.id, {
            id: "efreet",
            controllerId: "p1",
        });
        const myFlyer = makeInstance(birdMaiden.id, {
            id: "p1-flyer",
            controllerId: "p1",
        });
        const myGround = makeInstance(grizzlyBears.id, {
            id: "p1-ground",
            controllerId: "p1",
        });
        const oppFlyer = makeInstance(birdMaiden.id, {
            id: "p2-flyer",
            controllerId: "p2",
        });
        const oppGround = makeInstance(grizzlyBears.id, {
            id: "p2-ground",
            controllerId: "p2",
        });
        const fragileFlyer = makeInstance(flyingMen.id, {
            id: "p2-fragile-flyer",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [efreet, myFlyer, myGround],
                }),
                makePlayer("p2", {
                    battlefield: [oppFlyer, oppGround, fragileFlyer],
                }),
            ],
        });
        return { state, efreet };
    }

    /** Push the activated ability with a chosen activator (`castById`) — mirrors
     *  the post-`activateAbility` state where the activator may differ from the
     *  source's controller (CR 113.3c). */
    function fire(
        state: GameState,
        source: CardInstanceState,
        activator: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: activator,
            abilityId: "ifh-biff-efreet-rain",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    function bf(state: GameState, playerIdx: number, id: string) {
        return state.players[playerIdx].battlefield.find((c) => c.id === id)!;
    }

    it("damages each creature with flying and each player; spares non-flyers", () => {
        const { state, efreet } = setup();
        fire(state, efreet, "p1");

        // Both players take 1.
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        // Every surviving flyer (incl. the Efreet itself, a 3/3) takes 1.
        expect(bf(state, 0, "efreet").damageMarked).toBe(1);
        expect(bf(state, 0, "p1-flyer").damageMarked).toBe(1);
        expect(bf(state, 1, "p2-flyer").damageMarked).toBe(1);
        // The 1/1 flyer took lethal flying damage and left via SBA.
        expect(
            state.players[1].battlefield.find(
                (c) => c.id === "p2-fragile-flyer"
            )
        ).toBeUndefined();
        // Ground creatures are untouched.
        expect(bf(state, 0, "p1-ground").damageMarked).toBeUndefined();
        expect(bf(state, 1, "p2-ground").damageMarked).toBeUndefined();
    });

    it("is symmetric regardless of who activates it (any player)", () => {
        // Activated by the OPPONENT (p2), not the controller — same outcome.
        const { state, efreet } = setup();
        fire(state, efreet, "p2");

        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        expect(bf(state, 0, "p1-flyer").damageMarked).toBe(1);
        expect(bf(state, 1, "p2-flyer").damageMarked).toBe(1);
        expect(bf(state, 0, "p1-ground").damageMarked).toBeUndefined();
    });

    it("wire format: the flyer-only damage survives projection", () => {
        const { state, efreet } = setup();
        fire(state, efreet, "p2");
        const projected = projectPublicState(state, 1, "p2");
        // p2's own flyer took 1, ground creature did not — visible client-side.
        const projFlyer = projected.players[1].battlefield.find(
            (c) => c.id === "p2-flyer"
        )!;
        const projGround = projected.players[1].battlefield.find(
            (c) => c.id === "p2-ground"
        )!;
        expect(projFlyer.damageMarked).toBe(1);
        expect(projGround.damageMarked).toBeUndefined();
        expect(projected.players[1].life).toBe(19);
    });
});
