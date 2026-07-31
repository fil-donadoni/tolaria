// Per-card behavior tests for colorless cards in `convex/cards/sets/drk/colorless.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    barlsCage,
    boneFlute,
    bookOfRass,
    cityOfShadows,
    coalGolem,
    darkSphere,
    diabolicMachine,
    fellwarStone,
    fountainOfYouth,
    goblinHero,
    livingArmor,
    mazeOfIth,
    necropolis,
    reflectingMirror,
    safeHaven,
    scarecrow,
    scarwoodGoblins,
    skullOfOrm,
    sorrowsPath,
    squire,
    standingStones,
    stoneCalendar,
    tormodsCrypt,
    towerOfCoireall,
} from "..";
import {
    FOREST,
    ISLAND,
    MOUNTAIN,
    PLAINS,
    SWAMP,
    UPKEEP,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    finalizeTargetSelection,
    activateAbilityOnState,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import {
    getDynamicManaChoices,
    getEffectiveManaChoices,
    getProducibleColors,
} from "../../../../gre/constants";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyAllCombatDamage, untapStep } from "../../../../gre/phases";
import { getLegalTargets } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    applyCostModifiers,
    applyPlayerDamagePrevention,
    getCostModifiers,
    normalizeManaCost,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getAllCards, getDefinition, getCardByName } from "../../../index";
import { lightningBolt } from "../../lea";

describe("DRK registry parity", () => {
    it("registers the skeleton creatures by id", () => {
        expect(getDefinition(squire.id)).toBe(squire);
        expect(getDefinition(goblinHero.id)).toBe(goblinHero);
        expect(getDefinition(scarwoodGoblins.id)).toBe(scarwoodGoblins);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Squire")).toBe(squire);
        expect(getCardByName("Goblin Hero")).toBe(goblinHero);
        expect(getCardByName("Scarwood Goblins")).toBe(scarwoodGoblins);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(squire);
        expect(all).toContain(goblinHero);
        expect(all).toContain(scarwoodGoblins);
    });
});

// ---------------------------------------------------------------------------
// Deferred cards are intentionally NOT exported / registered. Guard that the
// pool stays honest (no half-card leaks until their mechanic ships).
// ---------------------------------------------------------------------------

describe("DRK deferred cards (not yet in pool)", () => {
    it.each(["Brainwash", "Blood of the Martyr", "Festival", "Cleansing"])(
        "%s is not registered (its mechanic is deferred — see TODO(#411))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );

    it.each(["Leviathan", "Tangle Kelp"])(
        "%s is not registered (its mechanic is deferred — see TODO(#412))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );

    it.each(["Frankenstein's Monster"])(
        "%s is not registered (needs a graveyard-pick choice — see TODO(#413))",
        (name) => {
            expect(() => getCardByName(name)).toThrow();
        }
    );
});

// ═════════════════════════════════════════════════════════════════════════════
// Free tranche — Artifacts, Lands & colorless (#417)
// ═════════════════════════════════════════════════════════════════════════════

describe("DRK Artifacts/Lands registry parity (#417)", () => {
    const cards = [
        barlsCage,
        boneFlute,
        bookOfRass,
        darkSphere,
        diabolicMachine,
        fountainOfYouth,
        livingArmor,
        necropolis,
        scarecrow,
        skullOfOrm,
        standingStones,
        stoneCalendar,
        tormodsCrypt,
        towerOfCoireall,
        cityOfShadows,
        mazeOfIth,
        safeHaven,
    ];
    it("registers every implemented card by id, name and in the index", () => {
        const all = getAllCards();
        for (const c of cards) {
            expect(getDefinition(c.id)).toBe(c);
            expect(getCardByName(c.name)).toBe(c);
            expect(all).toContain(c);
        }
    });

    it.each([
        ["Runesword", "#417"],
        ["War Barge", "#417"],
        ["Wand of Ith", "#417"],
    ])("%s is deferred (not registered, %s)", (name) => {
        expect(() => getCardByName(name)).toThrow();
    });
});

describe("Barl's Cage — {3}: target doesn't untap next untap step (CR 302.6/502.1)", () => {
    function setup() {
        const cage = makeInstance(barlsCage.id, {
            id: "cage",
            controllerId: "p1",
        });
        const bear = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [cage] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, cage, bear };
    }

    it("a flagged creature stays tapped its next untap step, then untaps the following one", () => {
        const { state, cage } = setup();
        resolveActivated(state, cage, "barls-cage-lock", [
            { type: "permanent", id: "bear" },
        ]);
        const bearAfterResolve = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterResolve.skipNextUntap).toBe(true);

        // p2's untap step: the flag is consumed and the creature stays tapped.
        untapStep(state);
        const bearAfterFirst = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterFirst.isTapped).toBe(true);
        expect(bearAfterFirst.skipNextUntap).toBeUndefined();

        // The FOLLOWING untap step untaps it normally (one-shot).
        untapStep(state);
        const bearAfterSecond = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterSecond.isTapped).toBe(false);
    });
});

describe("Bone Flute — {2},{T}: all creatures get -1/-0 EOT (CR 611.2)", () => {
    it("shrinks every creature's power by 1", () => {
        const flute = makeInstance(boneFlute.id, {
            id: "flute",
            controllerId: "p1",
        });
        const mine = makeInstance(getCardByName("Hill Giant").id, {
            id: "mine",
            controllerId: "p1",
        });
        const theirs = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flute, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const beforeMine = getEffectivePower(state, mine);
        const beforeTheirs = getEffectivePower(state, theirs);
        resolveActivated(state, flute, "bone-flute-shrink");
        expect(getEffectivePower(state, mine)).toBe(beforeMine - 1);
        expect(getEffectivePower(state, theirs)).toBe(beforeTheirs - 1);
        // Toughness unaffected (-1/-0).
        expect(getEffectiveToughness(state, theirs)).toBe(2);
    });
});

describe("Book of Rass — {2}, Pay 2 life: Draw a card (CR 118.4/121.1)", () => {
    it("draws one card (the life cost is enforced by the cost layer)", () => {
        const book = makeInstance(bookOfRass.id, {
            id: "book",
            controllerId: "p1",
        });
        const top = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [book], library: [top] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, book, "book-of-rass-draw");
        expect(state.players[0].hand.some((c) => c.id === "top")).toBe(true);
        expect(bookOfRass.activatedAbilities![0].cost.life).toBe(2);
    });
});

describe("Diabolic Machine — {3}: Regenerate this creature (CR 701.15a)", () => {
    it("arms a regeneration shield that replaces the next destroy", () => {
        const machine = makeInstance(diabolicMachine.id, {
            id: "machine",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "diabolic-machine-regenerate");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "machine"
        )!;
        expect(after.regenerationShields ?? 0).toBeGreaterThan(0);
        expect(diabolicMachine.power).toBe(4);
        expect(diabolicMachine.toughness).toBe(4);
        expect(diabolicMachine.subtypes).toEqual(["Construct"]);
    });
});

describe("Fountain of Youth — {2},{T}: gain 1 life (CR 119.3)", () => {
    it("gains the controller 1 life", () => {
        const fountain = makeInstance(fountainOfYouth.id, {
            id: "fountain",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [fountain] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fountain, "fountain-of-youth-gain");
        expect(state.players[0].life).toBe(21);
    });
});

describe("Living Armor — sac: X +0/+1 counters, X = target's mana value (CR 122.1)", () => {
    it("puts MV-many +0/+1 counters; survives the wire (layer 7d)", () => {
        const armor = makeInstance(livingArmor.id, {
            id: "armor",
            controllerId: "p1",
        });
        // Hill Giant: {3}{R} → mana value 4.
        const giant = makeInstance(getCardByName("Hill Giant").id, {
            id: "giant",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [armor, giant] }),
                makePlayer("p2"),
            ],
        });
        const baseT = getEffectiveToughness(state, giant);
        resolveActivated(state, armor, "living-armor-counters", [
            { type: "permanent", id: "giant" },
        ]);
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "giant"
        )!;
        expect(buffed.counters?.["+0/+1"]).toBe(4);
        expect(getEffectiveToughness(state, buffed)).toBe(baseT + 4);
        expect(getEffectivePower(state, buffed)).toBe(3); // +0 to power (3/3 base)

        // Wire-format guard: counters + effective toughness survive projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "giant"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(baseT + 4);
    });
});

describe("Necropolis — exile a graveyard creature: +0/+1 counters = its MV (CR 122.1)", () => {
    it("exiles the chosen card and grows by its mana value", () => {
        const necro = makeInstance(necropolis.id, {
            id: "necro",
            controllerId: "p1",
        });
        // Grizzly Bears: {1}{G} → mana value 2.
        const corpse = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "corpse",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [necro],
                    graveyard: [corpse],
                }),
                makePlayer("p2"),
            ],
        });
        const baseT = getEffectiveToughness(state, necro);
        resolveActivated(state, necro, "necropolis-counters", [
            { type: "graveyard-card", id: "corpse", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.some((c) => c.id === "corpse")).toBe(
            true
        );
        const grown = state.players[0].battlefield.find(
            (c) => c.id === "necro"
        )!;
        expect(grown.counters?.["+0/+1"]).toBe(2);
        expect(getEffectiveToughness(state, grown)).toBe(baseT + 2);
    });

    it("has Defender (can't attack)", () => {
        expect(necropolis.staticAbilities).toContain("defender");
    });
});

describe("Skull of Orm — {5},{T}: return an enchantment from your graveyard (CR 400.7)", () => {
    it("returns the targeted enchantment card to hand", () => {
        const skull = makeInstance(skullOfOrm.id, {
            id: "skull",
            controllerId: "p1",
        });
        const ench = makeInstance(getCardByName("Curse Artifact").id, {
            id: "ench",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [skull], graveyard: [ench] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, skull, "skull-of-orm-return", [
            { type: "graveyard-card", id: "ench", playerId: "p1" },
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].hand.some((c) => c.id === "ench")).toBe(true);
    });
});

describe("Standing Stones — {1},{T},Pay 1 life: add one mana of any color (CR 605.1)", () => {
    it("is a mana ability (useStack:false) with a life cost and color choices", () => {
        const ability = standingStones.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost.life).toBe(1);
        expect(ability.cost.tap).toBe(true);
        expect(ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });
});

describe("Stone Calendar — spells you cast cost {1} less (CR 601.2f)", () => {
    function effectiveCost(
        state: GameState,
        spellCardId: string,
        controllerId: string
    ): Record<string, number> {
        const def = getDefinition(spellCardId);
        const spellView = makeInstance(spellCardId, {
            controllerId,
            zone: "stack",
        });
        const cost = normalizeManaCost(def.manaCost ?? {});
        applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
        return cost;
    }

    it("reduces the controller's own spell by {1} but not the opponent's", () => {
        const calendar = makeInstance(stoneCalendar.id, {
            id: "cal",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [calendar] }),
                makePlayer("p2"),
            ],
        });
        // Hill Giant {3}{R}: generic drops 3 → 2 for p1, unchanged for p2.
        const giantId = getCardByName("Hill Giant").id;
        expect(effectiveCost(state, giantId, "p1")).toEqual({ X: 2, R: 1 });
        expect(effectiveCost(state, giantId, "p2")).toEqual({ X: 3, R: 1 });
    });
});

describe("Tormod's Crypt — {T}, Sac: exile a player's graveyard (CR 406/400.7)", () => {
    it("moves the whole target graveyard to exile", () => {
        const crypt = makeInstance(tormodsCrypt.id, {
            id: "crypt",
            controllerId: "p1",
        });
        const a = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const b = makeInstance(getCardByName("Hill Giant").id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crypt] }),
                makePlayer("p2", { graveyard: [a, b] }),
            ],
        });
        resolveActivated(state, crypt, "tormods-crypt-exile-graveyard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);
    });
});

describe("Tower of Coireall — {T}: target can't be blocked by Walls this turn (CR 509.1b)", () => {
    it("flags the attacker and rejects only Wall blockers", () => {
        const tower = makeInstance(towerOfCoireall.id, {
            id: "tower",
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "atk",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tower, attacker] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tower, "tower-of-coireall-evasion", [
            { type: "permanent", id: "atk" },
        ]);
        const flagged = state.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(flagged.cantBeBlockedBySubtypesThisTurn).toEqual(["Wall"]);
    });
});

describe("Maze of Ith — {T}: untap an attacker + prevent its combat damage (CR 615.1)", () => {
    it("untaps the attacker and registers combat-damage immunity for it", () => {
        const maze = makeInstance(mazeOfIth.id, {
            id: "maze",
            controllerId: "p1",
        });
        const attacker = makeInstance(getCardByName("Hill Giant").id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [maze] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, maze, "maze-of-ith-neutralize", [
            { type: "permanent", id: "atk" },
        ]);
        const after = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(after.isTapped).toBe(false);
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBe(true);
    });
});

describe("City of Shadows — storage land (CR 605.1a, exile-to-store + per-counter mana)", () => {
    it("exiles a creature you control and adds a storage counter", () => {
        const city = makeInstance(cityOfShadows.id, {
            id: "city",
            controllerId: "p1",
        });
        const fodder = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [city, fodder] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, city, "city-of-shadows-store", [
            { type: "permanent", id: "fodder" },
        ]);
        expect(state.players[0].exile.some((c) => c.id === "fodder")).toBe(
            true
        );
        const stored = state.players[0].battlefield.find(
            (c) => c.id === "city"
        )!;
        expect(stored.counters?.storage).toBe(1);
    });

    it("mana ability outputs {C} per storage counter (manaAmount reads counters)", () => {
        const mana = cityOfShadows.activatedAbilities!.find(
            (a) => a.id === "city-of-shadows-mana"
        )!;
        const withThree = {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            subtypes: [],
            isTapped: false,
            counters: { storage: 3 },
        } as never;
        expect(mana.manaAmount!(withThree, [])).toEqual({ C: 3 });
        const withNone = { ...(withThree as object), counters: {} } as never;
        expect(mana.manaAmount!(withNone, [])).toEqual({ C: 0 });
    });
});

describe("Safe Haven — exile creatures you control; sac to return them (CR 603.7a)", () => {
    it("exiles via a source-keyed bundle and returns on upkeep sacrifice", () => {
        const haven = makeInstance(safeHaven.id, {
            id: "haven",
            controllerId: "p1",
        });
        const friend = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "friend",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [haven, friend] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, haven, "safe-haven-exile", [
            { type: "permanent", id: "friend" },
        ]);
        expect(state.players[0].exile.some((c) => c.id === "friend")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "friend")
        ).toBe(false);

        // Upkeep trigger: accept the "may sacrifice" → return the creature.
        const havenInPlay = state.players[0].battlefield.find(
            (c) => c.id === "haven"
        )!;
        resolveTrigger(state, havenInPlay, "safe-haven-return", UPKEEP("p1"));
        // Suspended on the may-pay; answer "yes".
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "friend")
        ).toBe(true);
        expect(state.players[0].battlefield.some((c) => c.id === "haven")).toBe(
            false
        ); // sacrificed
    });
});

describe("Dark Sphere / Scarecrow — player damage prevention shields (CR 615.1)", () => {
    it("applyPlayerDamagePrevention: half-down from a matched source", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "src" },
                mode: "half-down",
                remaining: 1,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        // 5 damage → prevent floor(5/2)=2 → 3 lands; shield consumed.
        expect(applyPlayerDamagePrevention(state, "p1", "src", [], 5)).toBe(3);
        expect(state.playerDamagePrevention).toBeUndefined();
    });

    it("applyPlayerDamagePrevention: does NOT match a different source or player", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceInstanceId: "src" },
                mode: "half-down",
                remaining: 1,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        expect(applyPlayerDamagePrevention(state, "p1", "other", [], 5)).toBe(
            5
        );
        expect(applyPlayerDamagePrevention(state, "p2", "src", [], 5)).toBe(5);
    });

    it("applyPlayerDamagePrevention: prevent-all from flying sources only", () => {
        const state = makeState();
        state.playerDamagePrevention = [
            {
                playerId: "p1",
                match: { sourceStaticAbility: "flying" },
                mode: "all",
                remaining: 999,
                duration: { kind: "end-of-turn" } as never,
            },
        ];
        // Flyer's damage fully prevented; the shield persists (remaining high).
        expect(
            applyPlayerDamagePrevention(state, "p1", "flier", ["flying"], 4)
        ).toBe(0);
        // A grounded source is unaffected.
        expect(applyPlayerDamagePrevention(state, "p1", "ground", [], 4)).toBe(
            4
        );
    });

    it("Dark Sphere: resolving its ability registers a half-down shield on the controller", () => {
        const sphere = makeInstance(darkSphere.id, {
            id: "sphere",
            controllerId: "p1",
        });
        const threat = makeInstance(getCardByName("Hill Giant").id, {
            id: "threat",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sphere] }),
                makePlayer("p2", { battlefield: [threat] }),
            ],
        });
        resolveActivated(state, sphere, "dark-sphere-prevent-half", [
            { type: "permanent", id: "threat" },
        ]);
        const shield = state.playerDamagePrevention?.[0];
        expect(shield?.playerId).toBe("p1");
        expect(shield?.match.sourceInstanceId).toBe("threat");
        expect(shield?.mode).toBe("half-down");
    });

    it("Scarecrow: resolving its ability registers a flying prevent-all shield", () => {
        const crow = makeInstance(scarecrow.id, {
            id: "crow",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [crow] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, crow, "scarecrow-prevent-flying");
        const shield = state.playerDamagePrevention?.[0];
        expect(shield?.playerId).toBe("p1");
        expect(shield?.match.sourceStaticAbility).toBe("flying");
        expect(shield?.mode).toBe("all");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// C3 — Mana-production lookup / replacement (#420)
// ───────────────────────────────────────────────────────────────────────────

/** Build the `battlefields` argument the engine passes to `getManaChoices`. */
function manaChoices(
    state: GameState,
    rock: CardInstanceState,
    controllerId: string
): ReturnType<typeof getEffectiveManaChoices> {
    return getEffectiveManaChoices(
        rock,
        controllerId,
        state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }))
    );
}

describe("Fellwar Stone (CR 106.4 — colours an opponent's land could produce)", () => {
    it("offers no colour when no opponent controls a colour-producing land", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            rock,
            // p1's OWN Forest must NOT count.
            makeInstance(FOREST, { controllerId: "p1" }),
        ];
        const choices = getDynamicManaChoices(rock, "p1", [
            { playerId: "p1", battlefield: state.players[0].battlefield },
            { playerId: "p2", battlefield: [] },
        ]);
        expect(choices).toEqual([]);
    });

    it("derives colours from the opponent's basic lands (Forest + Island → G, U)", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(FOREST, { controllerId: "p2" }),
            makeInstance(ISLAND, { controllerId: "p2" }),
        ];
        const choices = manaChoices(state, rock, "p1");
        expect(choices).toEqual([{ U: 1 }, { G: 1 }]);
    });

    it("unions every opponent land's colours (Plains + Mountain + Swamp → W, B, R)", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(PLAINS, { controllerId: "p2" }),
            makeInstance(MOUNTAIN, { controllerId: "p2" }),
            makeInstance(SWAMP, { controllerId: "p2" }),
        ];
        const choices = manaChoices(state, rock, "p1");
        expect(choices).toEqual([{ W: 1 }, { B: 1 }, { R: 1 }]);
    });

    it("ignores the controller's own lands; reads only opponents'", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [
            rock,
            makeInstance(MOUNTAIN, { controllerId: "p1" }),
        ];
        state.players[1].battlefield = [
            makeInstance(ISLAND, { controllerId: "p2" }),
        ];
        // Only the opponent's Island colour {U} is offered — not p1's own {R}.
        expect(manaChoices(state, rock, "p1")).toEqual([{ U: 1 }]);
    });

    it("survives projection — the picker the client renders matches the server", () => {
        const rock = makeInstance(fellwarStone.id, { controllerId: "p1" });
        const state = makeState();
        state.players[0].battlefield = [rock];
        state.players[1].battlefield = [
            makeInstance(FOREST, { controllerId: "p2" }),
            makeInstance(SWAMP, { controllerId: "p2" }),
        ];
        const onFat = manaChoices(state, rock, "p1");
        expect(onFat).toEqual([{ B: 1 }, { G: 1 }]);

        // The projection strips `card.card` to `{ id }` and reshapes arrays; the
        // producible-colour read must still work off the slim battlefield.
        const projected = projectPublicState(state, 1, "p1");
        const slimRock = projected.players[0].battlefield.find(
            (c) => c.id === rock.id
        )! as unknown as CardInstanceState;
        const onWire = getEffectiveManaChoices(
            slimRock,
            "p1",
            projected.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield as unknown as CardInstanceState[],
            }))
        );
        expect(onWire).toEqual(onFat);
    });

    it("getProducibleColors excludes colourless {C}", () => {
        // A basic land produces a colour; Standing Stones (any colour) too. A
        // pure {C} source would not contribute — covered by the empty-opponent
        // case. Sanity: a Forest's producible set is exactly {G}.
        const forest = makeInstance(FOREST, { controllerId: "p2" });
        expect([...getProducibleColors(forest)]).toEqual(["G"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reflecting Mirror — "{X}, {T}: Change the target of target spell with a single
// target if that target is you. The new target must be a player. X is twice the
// mana value of that spell." (CR 605 activated ability; CR 114.6 changing the
// target of a spell already on the stack — the ORIGINAL object, not a copy.)
// ─────────────────────────────────────────────────────────────────────────────
describe("Reflecting Mirror (retarget existing spell, CR 114.6)", () => {
    const MIRROR_ABILITY = "reflecting-mirror-retarget";

    // Pushes Reflecting Mirror's ability on the stack with its targets already
    // chosen (mirrors the post-finalizeTargetSelection state), then resolves it
    // so requestRetarget fires. The {X}/{T} cost is assumed paid (its payment
    // is exercised through finalizeTargetSelection in the integration test).
    function resolveMirrorAbility(
        state: GameState,
        source: CardInstanceState,
        spellStackItemId: string
    ): void {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            abilityId: MIRROR_ABILITY,
            targets: [{ type: "spell", id: spellStackItemId }],
        });
        resolveTopOfStack(state);
    }

    function setup() {
        const mirror = makeInstance(reflectingMirror.id, {
            id: "mirror-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mirror] }),
                makePlayer("p2"),
            ],
        });
        // p2 casts a single-target spell (Lightning Bolt) at p1.
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        return { state, mirror, bolt };
    }

    it("definition: {4} artifact with a single targeted activated ability", () => {
        expect(reflectingMirror.types).toEqual(["Artifact"]);
        expect(reflectingMirror.manaCost).toEqual({ X: 4 });
        const ability = reflectingMirror.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.cost.mana).toEqual({ X: "X" });
        expect(ability?.cost.xFromTargetSpellMv).toEqual({ multiplier: 2 });
        expect(ability?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            spellSingleTargetingController: true,
        });
    });

    it("is legal only against a single-target spell that targets the activator (CR 115.10)", () => {
        const { state } = setup();
        const ability = reflectingMirror.activatedAbilities![0];
        // Activator is p1: the bolt targets p1, so it is a legal target.
        const legalForP1 = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legalForP1.map((t) => t.type)).toEqual(["spell"]);

        // From p2's seat the bolt does NOT target p2 — illegal.
        const legalForP2 = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p2"
        );
        expect(legalForP2).toHaveLength(0);
    });

    it("a spell with two targets is not legal (single target required)", () => {
        const { state } = setup();
        // Replace the bolt with a (synthetic) two-target spell at p1 + p2.
        state.stack[0].targets = [
            { type: "player", id: "p1" },
            { type: "player", id: "p2" },
        ];
        const ability = reflectingMirror.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(0);
    });

    it("a spell targeting a permanent (not the player) is not legal", () => {
        const { state } = setup();
        state.stack[0].targets = [{ type: "permanent", id: "some-creature" }];
        const ability = reflectingMirror.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(0);
    });

    it("resolution opens a player-target retarget prompt for the activator (CR 114.6)", () => {
        const { state, mirror, bolt } = setup();
        resolveMirrorAbility(state, mirror, bolt.id);

        const pt = state.pendingTarget;
        expect(pt?.kind).toBe("retarget");
        expect(pt?.playerId).toBe("p1"); // the activator chooses
        expect(pt?.cardInstanceId).toBe(bolt.id); // the ORIGINAL spell
        expect(pt?.targetType).toBe("player");
        // The Mirror ability has left the stack; the bolt is still there.
        expect(state.stack.map((s) => s.id)).toEqual([bolt.id]);
    });

    it("changes the ORIGINAL spell's target and it resolves at the new target", () => {
        const { state, mirror, bolt } = setup();
        resolveMirrorAbility(state, mirror, bolt.id);

        // Choose p2 as the new target (mirrors finalizeTargetSelection's
        // retarget branch writing onto the original stack item).
        const pt = state.pendingTarget!;
        const spell = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        spell.targets = [{ type: "player", id: "p2" }];
        state.pendingTarget = undefined;

        // The original bolt now targets p2 in place.
        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);

        resolveTopOfStack(state); // Bolt resolves at the NEW target.
        expect(state.players[1].life).toBe(17); // p2 took the 3 damage
        expect(state.players[0].life).toBe(20); // p1 untouched
    });

    it("integration: real activation + derived-X payment + retarget (game.ts)", () => {
        const { state, mirror, bolt } = setup();
        const ability = reflectingMirror.activatedAbilities![0];
        // X is twice the bolt's mana value (Lightning Bolt MV = 1 → X = 2).
        // Give p1 exactly 2 mana so the cost is covered and finalize commits.
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 };

        // Drive the REAL finalizeTargetSelection through the ability path, with
        // the spell target already selected — mirrors activateAbility +
        // selectTarget building the pendingTarget (kind: "ability").
        const pendingTarget = {
            playerId: "p1",
            cardInstanceId: mirror.id,
            targetType: ability.targetRequirement!.type,
            count: 1,
            selected: [{ type: "spell" as const, id: bolt.id }],
            kind: "ability" as const,
            abilityId: MIRROR_ABILITY,
            spellSingleTargetingController: true,
        };
        state.pendingTarget = pendingTarget;
        finalizeTargetSelection(state, pendingTarget, "p1");

        // Cost paid: {T} the Mirror + 2 generic mana spent. The ability is on
        // the stack carrying the derived X = 2.
        expect(state.players[0].battlefield[0].isTapped).toBe(true);
        expect(state.players[0].manaPool.R).toBe(0);
        const abilityItem = state.stack.find(
            (s) => s.abilityId === MIRROR_ABILITY
        )!;
        expect(abilityItem.chosenX).toBe(2);

        // Resolve the ability → retarget prompt on the ORIGINAL bolt.
        resolveTopOfStack(state);
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("retarget");
        expect(pt.cardInstanceId).toBe(bolt.id);

        // Choose p2 via the REAL retarget-finalize branch of game.ts.
        const retargetPt = {
            ...pt,
            selected: [{ type: "player" as const, id: "p2" }],
        };
        state.pendingTarget = retargetPt;
        finalizeTargetSelection(state, retargetPt, "p1");

        expect(state.stack[0].targets).toEqual([{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // bolt now hits p2
        expect(state.players[0].life).toBe(20);
    });

    it("integration: derived X scales with a higher-mana-value spell", () => {
        // Use Fireball-like MV via chosenX on the target spell: a bolt cast for
        // an extra X would raise its MV; here we simulate a spell whose stack
        // MV is 3 (base 1 + chosenX 2) → derived ability X = 6.
        const { state, mirror, bolt } = setup();
        bolt.chosenX = 2; // pretend the targeted spell carried X=2
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 6, G: 0, C: 0 };
        const pendingTarget = {
            playerId: "p1",
            cardInstanceId: mirror.id,
            targetType: "spell" as const,
            count: 1,
            selected: [{ type: "spell" as const, id: bolt.id }],
            kind: "ability" as const,
            abilityId: MIRROR_ABILITY,
            spellSingleTargetingController: true,
        };
        state.pendingTarget = pendingTarget;
        finalizeTargetSelection(state, pendingTarget, "p1");

        const abilityItem = state.stack.find(
            (s) => s.abilityId === MIRROR_ABILITY
        )!;
        expect(abilityItem.chosenX).toBe(6); // 2 × (1 + 2)
        expect(state.players[0].manaPool.R).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Sorrow's Path (C9, #426) — swap two of one opponent's blockers' assignments
// (CR 509.1 / 506.4 reassignment) + on-tap 2-damage-to-you drawback (CR 701.20a)
// ---------------------------------------------------------------------------

/** Builds a mid-combat board: p1 (Sorrow's Path controller) is the active /
 *  attacking player with two attackers; the opponent p2 is the defender with
 *  two blocking creatures, each assigned to one attacker. Returns the state plus
 *  the Sorrow's Path instance so a test can activate its swap ability.
 *  `attackerAbilities` lets a test give an attacker evasion (e.g. flying) to
 *  exercise the illegal-swap branch. */
function sorrowsPathCombat(opts?: {
    atk1Abilities?: string[];
    atk2Abilities?: string[];
    blk1Abilities?: string[];
    blk2Abilities?: string[];
}): { state: GameState; path: CardInstanceState } {
    const path = makeInstance(sorrowsPath.id, {
        id: "path",
        controllerId: "p1",
        ownerId: "p1",
    });
    // p1's two attackers (vanilla 2/2 unless given evasion).
    const atk1 = makeInstance(goblinHero.id, {
        id: "atk1",
        controllerId: "p1",
        ownerId: "p1",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk1Abilities ?? [],
    });
    const atk2 = makeInstance(goblinHero.id, {
        id: "atk2",
        controllerId: "p1",
        ownerId: "p1",
        power: 2,
        toughness: 2,
        isAttacking: true,
        staticAbilities: opts?.atk2Abilities ?? [],
    });
    // p2's two blockers, each blocking one attacker.
    const blk1 = makeInstance(squire.id, {
        id: "blk1",
        controllerId: "p2",
        ownerId: "p2",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk1Abilities ?? [],
    });
    const blk2 = makeInstance(squire.id, {
        id: "blk2",
        controllerId: "p2",
        ownerId: "p2",
        power: 1,
        toughness: 3,
        isBlocking: true,
        staticAbilities: opts?.blk2Abilities ?? [],
    });
    const state = makeState({
        activePlayerId: "p1",
        phase: "DECLARE_BLOCKERS",
        players: [
            makePlayer("p1", { battlefield: [path, atk1, atk2] }),
            makePlayer("p2", { battlefield: [blk1, blk2] }),
        ],
        combat: {
            attackerIds: ["atk1", "atk2"],
            confirmed: true,
            blockerAssignments: { blk1: ["atk1"], blk2: ["atk2"] },
            blockedAttackerIds: ["atk1", "atk2"],
            blockersConfirmed: true,
        },
    });
    return { state, path };
}

describe("Sorrow's Path — swap blockers (CR 509.1 / 506.4)", () => {
    it("card definition: Land, {T} two-blocker target ability + on-tap trigger", () => {
        expect(sorrowsPath.types).toEqual(["Land"]);
        expect(sorrowsPath.manaCost).toEqual({});
        const ab = sorrowsPath.activatedAbilities![0];
        expect(ab.cost).toEqual({ tap: true });
        expect(ab.useStack).toBe(true);
        expect(ab.targetRequirement).toEqual({
            type: "Creature",
            count: 2,
            combatRoleFilter: "blocking",
            controller: "opponent",
        });
        expect(sorrowsPath.triggeredAbilities).toHaveLength(1);
        expect(sorrowsPath.triggeredAbilities![0].event).toBe(
            "PERMANENT_TAPPED"
        );
    });

    it("legal swap: each vanilla blocker can block the other's attacker — assignments swap", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        // blk1 now blocks atk2, blk2 now blocks atk1.
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        // Both stay flagged as blocking; attackers stay blocked.
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        const blk2 = state.players[1].battlefield.find((c) => c.id === "blk2")!;
        expect(blk1.isBlocking).toBe(true);
        expect(blk2.isBlocking).toBe(true);
        expect(state.combat!.blockedAttackerIds).toEqual(["atk1", "atk2"]);
    });

    it("illegal swap: blk1 can't block flying atk2 — no-op (assignments unchanged)", () => {
        // atk2 has flying; blk2 (no flying) currently blocks it legally only
        // because blk2 also flies. After a hypothetical swap blk1 (no flying)
        // would have to block flying atk2 — illegal — so nothing happens.
        const { state, path } = sorrowsPathCombat({
            atk2Abilities: ["flying"],
            blk2Abilities: ["flying"],
        });
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk1"],
            blk2: ["atk2"],
        });
    });

    it("combat damage reflects the swapped assignments", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        // Strip the on-tap trigger that the activation queued so it doesn't
        // interfere with the post-swap combat-damage assertion.
        state.stack = [];
        // After the swap blk1 blocks atk2 and blk2 blocks atk1. Each attacker
        // (2 power) deals 2 to its NEW blocker; each blocker (1 power) deals 1
        // back to its NEW attacker.
        applyAllCombatDamage(state, {
            atk1: { blk2: 2 },
            atk2: { blk1: 2 },
            blk1: { atk2: 1 },
            blk2: { atk1: 1 },
        });
        const atk1 = state.players[0].battlefield.find((c) => c.id === "atk1")!;
        const atk2 = state.players[0].battlefield.find((c) => c.id === "atk2")!;
        const blk1 = state.players[1].battlefield.find((c) => c.id === "blk1")!;
        const blk2 = state.players[1].battlefield.find((c) => c.id === "blk2")!;
        expect(atk1.damageMarked).toBe(1); // from blk2 (its new blocker)
        expect(atk2.damageMarked).toBe(1); // from blk1 (its new blocker)
        expect(blk1.damageMarked).toBe(2); // from atk2 (its new attacker)
        expect(blk2.damageMarked).toBe(2); // from atk1 (its new attacker)
    });

    it("on-tap drawback: deals 2 to controller and each creature they control (CR 701.20a)", () => {
        const path = makeInstance(sorrowsPath.id, {
            id: "path",
            controllerId: "p1",
            ownerId: "p1",
        });
        // 0/3 so it survives the 2 damage and damageMarked stays readable.
        const myCreature = makeInstance(squire.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            power: 1,
            toughness: 3,
        });
        // An opponent creature must be unaffected.
        const theirs = makeInstance(squire.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 3,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [path, myCreature], life: 20 }),
                makePlayer("p2", { battlefield: [theirs], life: 20 }),
            ],
        });
        resolveTrigger(state, path, "sorrows-path-tap-drawback", {
            type: "PERMANENT_TAPPED",
            permanentId: "path",
            controllerId: "p1",
            permanentTypes: ["Land"],
            permanentSubtypes: [],
            forMana: false,
        } as StackItem["triggerEvent"]);
        checkStateBasedActions(state);
        expect(state.players[0].life).toBe(18); // 2 to controller
        const mine = state.players[0].battlefield.find((c) => c.id === "mine")!;
        expect(mine.damageMarked).toBe(2); // 2 to controller's creature
        const t = state.players[1].battlefield.find((c) => c.id === "theirs")!;
        expect(t.damageMarked ?? 0).toBe(0); // opponent untouched
        expect(state.players[1].life).toBe(20);
    });

    it("integration: getLegalTargets lists both opponent blockers; activate swaps them", () => {
        const { state, path } = sorrowsPathCombat();
        // GRE → rules layer: only the opponent's BLOCKING creatures are legal.
        const legal = getLegalTargets(
            state,
            sorrowsPath.activatedAbilities![0].targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["blk1", "blk2"]);
        // The attackers (p1's own creatures) are NOT legal targets.
        expect(ids).not.toContain("atk1");
        expect(ids).not.toContain("path");
        // Full path: resolve the ability with the two chosen targets.
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        expect(state.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
    });

    it("wire format: swapped block graph survives projectPublicState", () => {
        const { state, path } = sorrowsPathCombat();
        resolveActivated(state, path, "sorrows-path-swap-blockers", [
            { type: "permanent", id: "blk1" },
            { type: "permanent", id: "blk2" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        // The reassigned blocker graph crosses the wire intact.
        expect(projected.combat!.blockerAssignments).toEqual({
            blk1: ["atk2"],
            blk2: ["atk1"],
        });
        const blk1 = projected.players[1].battlefield.find(
            (c) => c.id === "blk1"
        )!;
        expect(blk1.isBlocking).toBe(true);
    });

    // CR 602.2b (issue #1951 review round 2) — activating a `count: 2`
    // ability must be rejected UP FRONT when fewer than 2 legal targets
    // exist, not accepted on "at least one candidate" and left to dead-end
    // mid-selection with an unfillable second slot. Exercises the REAL
    // `activateAbilityOnState` legality gate (not `resolveActivated`, which
    // bypasses it), since the fix lives in the mutation's own pre-check.
    it("activation is rejected up front with only ONE legal blocking creature (CR 602.2b) — no dead-end second target slot", () => {
        const path = makeInstance(sorrowsPath.id, {
            id: "path",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atk1 = makeInstance(goblinHero.id, {
            id: "atk1",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
            isAttacking: true,
        });
        // Only ONE blocking creature on p2's side — `legal.length` is 1, not
        // 0, so the old `legal.length === 0` check alone let this through.
        const blk1 = makeInstance(squire.id, {
            id: "blk1",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 3,
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [path, atk1] }),
                makePlayer("p2", { battlefield: [blk1] }),
            ],
            combat: {
                attackerIds: ["atk1"],
                confirmed: true,
                blockerAssignments: { blk1: ["atk1"] },
                blockedAttackerIds: ["atk1"],
                blockersConfirmed: true,
            },
        });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "path",
                abilityId: "sorrows-path-swap-blockers",
            })
        ).toThrow(/Not enough legal targets/);
        // Rejected at announcement — no pendingTarget left half-open with a
        // dead second slot.
        expect(state.pendingTarget).toBeUndefined();
    });
});

describe("Coal Golem — {3}, Sac this: Add {R}{R}{R} (CR 605.1a)", () => {
    it("is a non-stack sacrifice-for-mana ability producing {R}{R}{R}", () => {
        expect(coalGolem.types).toEqual(["Artifact", "Creature"]);
        const ability = coalGolem.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost.sacrifice).toBe(true);
        expect(ability.cost.mana).toEqual({ X: 3 });
        expect(ability.manaProduced).toEqual({ R: 3 });
    });
});
