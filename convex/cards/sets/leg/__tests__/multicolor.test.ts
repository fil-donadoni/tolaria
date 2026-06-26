// Legends (LEG) — multicolor (gold) per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    CREATURE_REQ,
    UPKEEP_C5,
    UPKEEP_C7,
    answerChoice,
    fillManaPool,
    resolveActivated,
    resolveTrigger,
    upkeepEvent487,
} from "./helpers";
import {
    adunOakenshield,
    angusMackenzie,
    arcadesSabboth,
    barktoothWarbeard,
    bartelRuneaxe,
    borisDevilboon,
    chromium,
    dakkonBlackblade,
    gwendlynDiCorci,
    halfdane,
    jacquesLeVert,
    jasmineBoreal,
    jeditOjanen,
    jerrardOfTheClosedFist,
    kasimirTheLoneWolf,
    keiTakahashi,
    ladyOrca,
    livonyaSilone,
    nicolBolas,
    palladiaMors,
    pavelMaliki,
    pendelhaven,
    princessLucrezia,
    ragnar,
    ramirezDePietro,
    rasputinDreamweaver,
    rivenTurnbull,
    sirShandlarOfEberyn,
    sivitriScarzam,
    solkanarTheSwampKing,
    sunastianFalconer,
    theLadyOfTheMountain,
    tobiasAndrion,
    torstenVonUrsus,
    tuknirDeathlock,
    tundraWolves,
    vaevictisAsmadi,
    xiraArien,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import { validateBlockerEligibility } from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import { advancePhase } from "../../../../gre/phases";
import { getLegalTargets } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getAllCards, getCardById, getCardByName } from "../../../index";
import { forest, grizzlyBears, island, mountain, swamp } from "../../lea";

// ---------------------------------------------------------------------------
// Registry parity (ADR 0014) — the `leg` set is registered.
// ---------------------------------------------------------------------------

describe("LEG registry parity", () => {
    it("registers the skeleton legendary creatures by id", () => {
        expect(getCardById(jasmineBoreal.id)).toBe(jasmineBoreal);
        expect(getCardById(ladyOrca.id)).toBe(ladyOrca);
    });

    it("registers them by name (debug-panel / pool lookup path)", () => {
        // The Debug-panel preset scenario and the card pool both resolve cards
        // by name via getCardByName (game.ts seedScenario) — registration alone
        // must make the cards reachable.
        expect(getCardByName("Jasmine Boreal")).toBe(jasmineBoreal);
        expect(getCardByName("Lady Orca")).toBe(ladyOrca);
    });

    it("includes them in getAllCards (deck-builder index)", () => {
        const all = getAllCards();
        expect(all).toContain(jasmineBoreal);
        expect(all).toContain(ladyOrca);
    });
});

// ---------------------------------------------------------------------------
// Vanilla legendary creatures (CR 205.4a — Legendary supertype as data)
// ---------------------------------------------------------------------------

describe("Jasmine Boreal (vanilla legendary creature, CR 205.4a)", () => {
    it("carries the Legendary supertype with the canonical stats", () => {
        expect(jasmineBoreal.types).toEqual(["Creature"]);
        expect(jasmineBoreal.supertypes).toEqual(["Legendary"]);
        expect(jasmineBoreal.power).toBe(4);
        expect(jasmineBoreal.toughness).toBe(5);
        expect(jasmineBoreal.manaCost).toEqual({ X: 3, G: 1, W: 1 });
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, jasmineBoreal.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const inPlay = p1.battlefield.find((c) => c.id === item.id);
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Lady Orca (vanilla legendary creature, CR 205.4a)", () => {
    it("carries the Legendary supertype with the canonical stats", () => {
        expect(ladyOrca.types).toEqual(["Creature"]);
        expect(ladyOrca.supertypes).toEqual(["Legendary"]);
        expect(ladyOrca.power).toBe(7);
        expect(ladyOrca.toughness).toBe(4);
        expect(ladyOrca.manaCost).toEqual({ X: 5, B: 1, R: 1 });
    });

    it("resolves onto the battlefield and survives projection as Legendary", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its Legendary supertype must be recoverable from the
        // registry by id after projectPublicState (CR 205.4a survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, ladyOrca.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getCardById((slim!.card as { id: string }).id);
        expect(def.supertypes).toContain("Legendary");
    });
});

describe("Livonya Silone (first strike + legendary landwalk, CR 702.7 / 702.13)", () => {
    // Build a defender board: one land (legendary or not) + a vanilla blocker.
    // Returns the attacking Livonya, the blocker, the defender battlefield, and
    // the live state for `validateBlockerEligibility`.
    function setup(opts: { defenderLandId: string }) {
        const attacker = makeInstance(livonyaSilone.id, {
            id: "livonya",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(tundraWolves.id, {
            id: "blk",
            controllerId: "p2",
        });
        const land = makeInstance(opts.defenderLandId, {
            id: "land",
            controllerId: "p2",
        });
        const defenderBattlefield = [blocker, land];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: defenderBattlefield }),
            ],
        });
        return { state, attacker, blocker, defenderBattlefield };
    }

    it("has first strike (CR 702.7)", () => {
        expect(livonyaSilone.staticAbilities).toContain("first strike");
    });

    it("has the legendary landwalk keyword (CR 702.13)", () => {
        expect(livonyaSilone.staticAbilities).toContain("legendary landwalk");
    });

    it("is a 4/4 Legendary Human Warrior costing {2}{R}{R}{G}{G}", () => {
        expect(livonyaSilone.power).toBe(4);
        expect(livonyaSilone.toughness).toBe(4);
        expect(livonyaSilone.supertypes).toEqual(["Legendary"]);
        expect(livonyaSilone.subtypes).toEqual(["Human", "Warrior"]);
        expect(livonyaSilone.manaCost).toEqual({ X: 2, R: 2, G: 2 });
    });

    it("can't be blocked while the defender controls a legendary land (CR 702.13)", () => {
        // Pendelhaven is a Legendary Land (CR 205.4) → evasion is live.
        const { attacker, blocker, defenderBattlefield, state } = setup({
            defenderLandId: pendelhaven.id,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("is blockable when the defender controls only a nonlegendary land (CR 702.13)", () => {
        // A basic Forest carries no Legendary supertype → no evasion.
        const { attacker, blocker, defenderBattlefield, state } = setup({
            defenderLandId: getCardByName("Forest").id,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("a legendary nonland permanent does NOT grant evasion (must be a land)", () => {
        // Jasmine Boreal is a Legendary Creature, not a land — Livonya stays
        // blockable. Guards the `types.includes("Land")` half of the matcher.
        const attacker = makeInstance(livonyaSilone.id, {
            id: "livonya",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(tundraWolves.id, {
            id: "blk",
            controllerId: "p2",
        });
        const legendaryCreature = makeInstance(jasmineBoreal.id, {
            id: "jasmine",
            controllerId: "p2",
        });
        const defenderBattlefield = [blocker, legendaryCreature];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: defenderBattlefield }),
            ],
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("evasion survives the wire projection (FullGameState parity)", () => {
        const { defenderBattlefield, state } = setup({
            defenderLandId: pendelhaven.id,
        });
        // Re-derive attacker + blocker from the projected state so the matcher
        // reads only the slim `{ id }` card refs the client sees.
        const projected = projectPublicState(state, 1, "p1");
        const slimAttacker = projected.players[0].battlefield.find(
            (c) => c.id === "livonya"
        )! as unknown as CardInstanceState;
        const slimBlocker = projected.players[1].battlefield.find(
            (c) => c.id === "blk"
        )! as unknown as CardInstanceState;
        const slimDefenderBf = projected.players[1]
            .battlefield as unknown as CardInstanceState[];
        const res = validateBlockerEligibility(
            slimAttacker,
            slimBlocker,
            slimDefenderBf,
            projected as unknown as typeof state
        );
        expect(res.eligible).toBe(false);
        // Sanity: the projection did strip the fat card ref to `{ id }`.
        const legendaryLand = slimDefenderBf.find((c) => c.id === "land")!;
        expect(Object.keys(legendaryLand.card)).toEqual(["id"]);
        expect(defenderBattlefield.length).toBe(slimDefenderBf.length);
    });
});

// ---------------------------------------------------------------------------
// Multicolor / gold free tranche (#376)
// ---------------------------------------------------------------------------

describe("LEG multicolor vanilla / keyword legendary creatures (CR 205.4a, 702)", () => {
    it("ships the vanilla legends with canonical stats and supertype", () => {
        for (const c of [
            barktoothWarbeard,
            jeditOjanen,
            jerrardOfTheClosedFist,
            kasimirTheLoneWolf,
            sirShandlarOfEberyn,
            sivitriScarzam,
            theLadyOfTheMountain,
            tobiasAndrion,
            torstenVonUrsus,
        ]) {
            expect(c.supertypes).toContain("Legendary");
            expect(c.types).toEqual(["Creature"]);
            expect(c.staticAbilities).toBeUndefined();
        }
        expect(barktoothWarbeard.power).toBe(6);
        expect(barktoothWarbeard.toughness).toBe(5);
        expect(sirShandlarOfEberyn.toughness).toBe(7);
    });

    it("Ramirez DePietro has first strike", () => {
        expect(ramirezDePietro.staticAbilities).toContain("first strike");
        expect(ramirezDePietro.supertypes).toContain("Legendary");
    });

    it("registers the multicolor cards by name (pool / debug lookup)", () => {
        expect(getCardByName("Dakkon Blackblade")).toBe(dakkonBlackblade);
        expect(getCardByName("Sol'kanar the Swamp King")).toBe(
            solkanarTheSwampKing
        );
        expect(getCardByName("Boris Devilboon")).toBe(borisDevilboon);
    });
});

describe("Dakkon Blackblade (P/T = lands you control, CR 604.3 pt-cda)", () => {
    it("scales with controlled lands (GRE + wire)", () => {
        const dakkon = makeInstance(dakkonBlackblade.id, {
            id: "dakkon",
            controllerId: "p1",
        });
        const l1 = makeInstance(mountain.id, { id: "l1", controllerId: "p1" });
        const l2 = makeInstance(forest.id, { id: "l2", controllerId: "p1" });
        const l3 = makeInstance(island.id, { id: "l3", controllerId: "p2" }); // opponent's land doesn't count
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dakkon, l1, l2] }),
                makePlayer("p2", { battlefield: [l3] }),
            ],
        });
        expect(getEffectivePower(state, dakkon)).toBe(2);
        expect(getEffectiveToughness(state, dakkon)).toBe(2);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "dakkon"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);

        // Add another land → grows.
        state.players[0].battlefield.push(
            makeInstance(swamp.id, { id: "l4", controllerId: "p1" })
        );
        expect(getEffectivePower(state, dakkon)).toBe(3);
    });
});

describe("Jacques le Vert (green creatures you control get +0/+2, CR 611)", () => {
    it("buffs only your green creatures (GRE + wire)", () => {
        const jacques = makeInstance(jacquesLeVert.id, {
            id: "jacques",
            controllerId: "p1",
        });
        // Barbary Apes (green 2/2) controlled by p1 — buffed.
        const ape = makeInstance("df25ffdd-995d-46ae-856b-f6368f9438ed", {
            id: "ape",
            controllerId: "p1",
        });
        // Red creature (Hill Giant 3/3) controlled by p1 — not buffed.
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jacques, ape, giant] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, ape)).toBe(2);
        expect(getEffectiveToughness(state, ape)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, giant)).toBe(3); // unbuffed

        const projected = projectPublicState(state, 1, "p1");
        const slimApe = projected.players[0].battlefield.find(
            (c) => c.id === "ape"
        )!;
        expect(getEffectiveToughness(projected, slimApe)).toBe(4);
    });
});

describe("Sol'kanar the Swamp King (black-spell lifegain, CR 603.2)", () => {
    it("has swampwalk and gains 1 life per black spell cast", () => {
        expect(solkanarTheSwampKing.staticAbilities).toContain("swampwalk");
        const solkanar = makeInstance(solkanarTheSwampKing.id, {
            id: "solkanar",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [solkanar] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, solkanar, "solkanar-black-spell-lifegain", {
            type: "SPELL_CAST",
            casterId: "p2",
            spellInstanceId: "x",
            spellCardId: "x",
            spellTypes: ["Sorcery"],
            spellSubtypes: [],
            spellColors: ["B"],
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Adun Oakenshield ({B}{R}{G},{T}: graveyard creature → hand, CR 400.7)", () => {
    it("returns a creature card from your graveyard to your hand", () => {
        const adun = makeInstance(adunOakenshield.id, {
            id: "adun",
            controllerId: "p1",
        });
        const dead = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "dead",
            controllerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [adun],
                    graveyard: [dead],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, adun, "adun-oakenshield-regrowth", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        expect(
            state.players[0].graveyard.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(
            state.players[0].hand.find((c) => c.id === "dead")
        ).toBeDefined();
    });
});

describe("Angus Mackenzie ({G}{W}{U},{T}: fog, CR 615)", () => {
    it("sets the combat-damage prevention flag", () => {
        const angus = makeInstance(angusMackenzie.id, {
            id: "angus",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angus] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, angus, "angus-mackenzie-fog");
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Boris Devilboon ({2}{B}{R},{T}: make a Minor Demon, CR 111)", () => {
    it("creates a 1/1 black-and-red Demon token", () => {
        const boris = makeInstance(borisDevilboon.id, {
            id: "boris",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [boris] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].battlefield.length;
        resolveActivated(state, boris, "boris-devilboon-minor-demon");
        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.id !== "boris"
        );
        expect(state.players[0].battlefield.length).toBe(before + 1);
        expect(token).toBeDefined();
        expect(token!.power).toBe(1);
        expect(token!.toughness).toBe(1);
        expect(token!.subtypes).toContain("Demon");
    });
});

describe("Gwendlyn Di Corci ({T}: random discard, your turn, CR 701.8a)", () => {
    it("makes the target player discard a card at random", () => {
        const gwen = makeInstance(gwendlynDiCorci.id, {
            id: "gwen",
            controllerId: "p1",
        });
        const victimCard = makeInstance(
            "0ddb98e8-13fe-4786-83f7-b72c56db135a",
            { id: "hc", controllerId: "p2", zone: "hand" }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gwen] }),
                makePlayer("p2", { hand: [victimCard] }),
            ],
        });
        expect(state.players[1].hand.length).toBe(1);
        resolveActivated(state, gwen, "gwendlyn-di-corci-discard", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].hand.length).toBe(0);
    });
});

describe("Kei Takahashi ({T}: prevent next 2 to target creature, CR 615)", () => {
    it("records a damage-prevention shield on the target", () => {
        const kei = makeInstance(keiTakahashi.id, {
            id: "kei",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kei, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, kei, "kei-takahashi-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        expect((state.targetPreventionShields ?? []).length).toBeGreaterThan(0);
    });
});

describe("Pavel Maliki ({B}{R}: +1/+0 EOT, CR 611.1)", () => {
    it("buffs its own power by 1 until end of turn", () => {
        const pavel = makeInstance(pavelMaliki.id, {
            id: "pavel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pavel] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, pavel)).toBe(5);
        resolveActivated(state, pavel, "pavel-maliki-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "pavel"
        )!;
        expect(getEffectivePower(state, live)).toBe(6);
    });
});

describe("Ragnar ({G}{W}{U},{T}: regenerate target creature, CR 701.15a)", () => {
    it("arms a regeneration shield on the target", () => {
        const ragnarInst = makeInstance(ragnar.id, {
            id: "ragnar",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ragnarInst, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, ragnarInst, "ragnar-regenerate", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThanOrEqual(1);
    });
});

describe("Tuknir Deathlock ({R}{G},{T}: target +2/+2 EOT, CR 611.1)", () => {
    it("has flying and buffs the target by +2/+2", () => {
        expect(tuknirDeathlock.staticAbilities).toContain("flying");
        const tuknir = makeInstance(tuknirDeathlock.id, {
            id: "tuknir",
            controllerId: "p1",
        });
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tuknir, bear] }),
                makePlayer("p2"),
            ],
        });
        const baseP = getEffectivePower(state, bear);
        const baseT = getEffectiveToughness(state, bear);
        resolveActivated(state, tuknir, "tuknir-deathlock-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(baseP + 2);
        expect(getEffectiveToughness(state, live)).toBe(baseT + 2);
    });
});

describe("Xira Arien ({B}{R}{G},{T}: target player draws, CR 121.1)", () => {
    it("has flying and draws a card for the target player", () => {
        expect(xiraArien.staticAbilities).toContain("flying");
        const xira = makeInstance(xiraArien.id, {
            id: "xira",
            controllerId: "p1",
        });
        const lib = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "libcard",
            controllerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [xira], library: [lib] }),
                makePlayer("p2"),
            ],
        });
        expect(state.players[0].hand.length).toBe(0);
        resolveActivated(state, xira, "xira-arien-draw", [
            { type: "player", id: "p1" },
        ]);
        expect(state.players[0].hand.length).toBe(1);
    });
});

describe("LEG multicolor mana abilities (CR 605.1a)", () => {
    // Mana abilities don't use the stack (useStack: false) — assert the
    // declaration shape (mirrors Fire Sprites) and that the `effect` closure
    // adds the right mana to the pool.
    function manaOf(card: typeof princessLucrezia) {
        const ability = card.activatedAbilities?.[0];
        let added: Record<string, number> | undefined;
        ability?.effect?.({
            addMana: (cost) => {
                added = cost as Record<string, number>;
            },
        });
        return { ability, added };
    }
    it("Princess Lucrezia: {T}: Add {U}", () => {
        const { ability, added } = manaOf(princessLucrezia);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ U: 1 });
        expect(added).toEqual({ U: 1 });
    });
    it("Riven Turnbull: {T}: Add {B}", () => {
        const { ability, added } = manaOf(rivenTurnbull);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ B: 1 });
        expect(added).toEqual({ B: 1 });
    });
    it("Sunastian Falconer: {T}: Add {C}{C}", () => {
        const { ability, added } = manaOf(sunastianFalconer);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 2 });
        expect(added).toEqual({ C: 2 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 — Legend rule SBA (CR 704.5j, #378)
// ─────────────────────────────────────────────────────────────────────────────

describe("legend rule SBA (CR 704.5j)", () => {
    /** Submits a `legend-keep` choice for `playerId`, keeping `keepId`. */
    function keepLegend(state: GameState, playerId: string, keepId: string) {
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [keepId],
        });
    }

    it("offers a keep-which choice when a controller has two same-name legendaries", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("legend-keep");
        expect(head.playerId).toBe("p1");
        expect(head.stackItemId).toBe("");
        expect(head.count).toBe(1);
        expect(head.candidateIds).toEqual(["jasmine-a", "jasmine-b"]);
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("keeps the chosen legendary and puts the rest into their owners' graveyards", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        keepLegend(state, "p1", "jasmine-a");

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine-a",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "jasmine-b",
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("puts a duplicate into its OWNER's graveyard, not the controller's (CR 704.5j)", () => {
        const mine = makeInstance(jasmineBoreal.id, {
            id: "jasmine-mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const borrowed = makeInstance(jasmineBoreal.id, {
            id: "jasmine-borrowed",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine, borrowed] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        keepLegend(state, "p1", "jasmine-mine");

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine-mine",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "jasmine-borrowed",
        ]);
    });

    it("leaves two DIFFERENT-name legendaries on the battlefield", () => {
        const jasmine = makeInstance(jasmineBoreal.id, { id: "jasmine" });
        const orca = makeInstance(ladyOrca.id, { id: "orca" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [jasmine, orca] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "jasmine",
            "orca",
        ]);
    });

    it("does NOT fire across different controllers (per-controller, CR 704.5j)", () => {
        const a = makeInstance(jasmineBoreal.id, {
            id: "jasmine-p1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(jasmineBoreal.id, {
            id: "jasmine-p2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield).toHaveLength(1);
    });

    it("ignores two same-name NON-legendary permanents (CR 704.5j — Legendary only)", () => {
        const a = makeInstance(grizzlyBears.id, { id: "bears-a" });
        const b = makeInstance(grizzlyBears.id, { id: "bears-b" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("groups a copy (Clone-style, CR 707.2) with the original by copied name", () => {
        const original = makeInstance(jasmineBoreal.id, {
            id: "jasmine-real",
            controllerId: "p1",
            ownerId: "p1",
        });
        const copy = makeInstance(grizzlyBears.id, {
            id: "the-copy",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A copy effect overwrites card.id with the copied definition's id.
        copy.card = { id: jasmineBoreal.id };
        copy.copiedFrom = grizzlyBears.id;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [original, copy] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds).toEqual([
            "jasmine-real",
            "the-copy",
        ]);
    });

    it("re-sweeps after a keep to resolve a SECOND same-name group", () => {
        const j1 = makeInstance(jasmineBoreal.id, { id: "j1" });
        const j2 = makeInstance(jasmineBoreal.id, { id: "j2" });
        const o1 = makeInstance(ladyOrca.id, { id: "o1" });
        const o2 = makeInstance(ladyOrca.id, { id: "o2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [j1, j2, o1, o2] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        expect(state.pendingChoices![0].candidateIds).toEqual(["j1", "j2"]);
        keepLegend(state, "p1", "j1");

        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].candidateIds).toEqual(["o1", "o2"]);
        keepLegend(state, "p1", "o2");

        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "j1",
            "o2",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "j2",
            "o1",
        ]);
    });

    it("surfaces the pending legend-keep choice across the wire projection", () => {
        const a = makeInstance(jasmineBoreal.id, { id: "jasmine-a" });
        const b = makeInstance(jasmineBoreal.id, { id: "jasmine-b" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("legend-keep");
        expect(head?.playerId).toBe("p1");
        expect(head?.candidateIds).toEqual(["jasmine-a", "jasmine-b"]);
        const ids = projected.players[0].battlefield.map((c) => c.id);
        expect(ids).toContain("jasmine-a");
        expect(ids).toContain("jasmine-b");
    });
});

describe("Bartel Runeaxe (can't be targeted by Aura spells, CR 109.5)", () => {
    it("is a vigilant Legendary 6/5 with an Aura-spell guard", () => {
        expect(bartelRuneaxe.supertypes).toContain("Legendary");
        expect(bartelRuneaxe.staticAbilities).toContain("vigilance");
        const guard = bartelRuneaxe.staticEffects?.find(
            (e) => e.kind === "permanent-guard"
        ) as
            | {
                  targetSourceSubtypeFilter?: string[];
                  targetSourceMustBeSpell?: boolean;
              }
            | undefined;
        expect(guard?.targetSourceMustBeSpell).toBe(true);
        expect(guard?.targetSourceSubtypeFilter).toContain("Aura");
    });

    it("blocks an Aura spell but not a non-Aura spell or an Aura ability", () => {
        const bartel = makeInstance(bartelRuneaxe.id, { id: "bartel" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bartel] }),
                makePlayer("p2"),
            ],
        });
        // Aura spell → guarded.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: true,
            })
        ).toBe(true);
        // Non-Aura spell (e.g. Lightning Bolt) → NOT guarded.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: [],
                isSpell: true,
            })
        ).toBe(false);
        // An ability whose source happens to carry the Aura subtype → NOT
        // guarded (the clause is "Aura SPELLS", CR 113.3).
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: false,
            })
        ).toBe(false);
    });

    it("getLegalTargets excludes Bartel for an Aura spell only", () => {
        const bartel = makeInstance(bartelRuneaxe.id, { id: "bartel" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bartel] }),
                makePlayer("p2"),
            ],
        });
        const auraSpell = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Enchantment"],
            ["Aura"],
            true
        ).map((t) => t.id);
        expect(auraSpell).not.toContain("bartel");
        const boltSpell = getLegalTargets(
            state,
            CREATURE_REQ,
            [],
            "p1",
            undefined,
            ["Instant"],
            [],
            true
        ).map((t) => t.id);
        expect(boltSpell).toContain("bartel");
    });
});

describe("Elder Dragon Legends (upkeep: sacrifice unless pay {C}{C}{C}, CR 603.6a / 117.3a / 701.16)", () => {
    const dragons = [
        { def: arcadesSabboth, ability: "arcades-sabboth-upkeep" },
        { def: chromium, ability: "chromium-upkeep" },
        { def: nicolBolas, ability: "nicol-bolas-upkeep" },
        { def: palladiaMors, ability: "palladia-mors-upkeep" },
        { def: vaevictisAsmadi, ability: "vaevictis-asmadi-upkeep" },
    ] as const;

    function setup(def: (typeof dragons)[number]["def"]) {
        const dragon = makeInstance(def.id, {
            id: "dragon",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        return { state, dragon };
    }

    for (const { def, ability } of dragons) {
        describe(def.name, () => {
            it("declining the payment sacrifices it (CR 701.16)", () => {
                const { state, dragon } = setup(def);
                resolveTrigger(state, dragon, ability, UPKEEP_C7("p1"));
                answerChoice(state, ["decline"]);
                expect(state.players[0].battlefield).toHaveLength(0);
                expect(
                    state.players[0].graveyard.some((c) => c.id === "dragon")
                ).toBe(true);
            });

            it("paying the cost keeps it on the battlefield (CR 118)", () => {
                const { state, dragon } = setup(def);
                fillManaPool(state);
                resolveTrigger(state, dragon, ability, UPKEEP_C7("p1"));
                answerChoice(state, ["yes"]);
                expect(
                    state.players[0].battlefield.some((c) => c.id === "dragon")
                ).toBe(true);
            });

            it("carries the upkeep trigger in its definition", () => {
                expect(
                    def.triggeredAbilities?.some((a) => a.id === ability)
                ).toBe(true);
            });
        });
    }

    it("fires only at the controller's OWN upkeep (scope: your, CR 603.6a)", () => {
        const dragon = makeInstance(chromium.id, {
            id: "chr",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        expect(
            collectTriggers(state, [UPKEEP_C7("p1") as never]).some(
                (t) => t.triggeredAbilityId === "chromium-upkeep"
            )
        ).toBe(true);
        expect(
            collectTriggers(state, [UPKEEP_C7("p2") as never]).some(
                (t) => t.triggeredAbilityId === "chromium-upkeep"
            )
        ).toBe(false);
    });

    it("backend integration: declining via applyMayPaySubmit sacrifices it (GRE → mutation → state)", () => {
        const dragon = makeInstance(nicolBolas.id, {
            id: "bolas",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bolas")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bolas")).toBe(
            true
        );
    });

    it("backend integration: paying via applyMayPaySubmit keeps it and spends mana", () => {
        const dragon = makeInstance(palladiaMors.id, {
            id: "pm",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragon] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 1, G: 1, C: 0 };
        state.stack.push(...collectTriggers(state, [UPKEEP_C7("p1") as never]));
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "pm")).toBe(
            true
        );
        // {R}{G}{W} consumed.
        expect(state.players[0].manaPool.R).toBe(0);
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[0].manaPool.W).toBe(0);
    });
});

describe("Rasputin Dreamweaver (dream counters: enters with 7, mana / prevent removal, capped regrow, CR 122)", () => {
    it("enters with seven dream counters (CR 122.1)", () => {
        expect(rasputinDreamweaver.entersWith?.counters).toEqual([
            { type: "dream", count: 7 },
        ]);
    });

    it("the upkeep regrow is capped at seven and gated on starting the turn untapped", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 7 },
            startedTurnUntapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        // At the cap → intervening-if true (started untapped) but resolve no-ops.
        resolveTrigger(
            state,
            rasputin,
            "rasputin-upkeep-regrow",
            UPKEEP_C5("p1")
        );
        expect(rasputin.counters?.dream).toBe(7);
    });

    it("regrows a dream counter below the cap when it started the turn untapped", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 4 },
            startedTurnUntapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            rasputin,
            "rasputin-upkeep-regrow",
            UPKEEP_C5("p1")
        );
        expect(rasputin.counters?.dream).toBe(5);
    });

    it("does NOT regrow if it did not start the turn untapped (intervening-if)", () => {
        const rasputin = makeInstance(rasputinDreamweaver.id, {
            id: "ras",
            controllerId: "p1",
            counters: { dream: 4 },
            startedTurnUntapped: undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        const fired = collectTriggers(state, [UPKEEP_C5("p1") as never]).some(
            (t) => t.triggeredAbilityId === "rasputin-upkeep-regrow"
        );
        expect(fired).toBe(false);
    });

    it("the mana ability carries a remove-a-dream-counter cost (CR 122.6)", () => {
        const mana = rasputinDreamweaver.activatedAbilities?.find(
            (a) => a.id === "rasputin-dream-mana"
        );
        expect(mana?.cost.removeCounter).toEqual({ type: "dream", count: 1 });
        expect(mana?.useStack).toBe(false);
    });
});

describe("Halfdane (upkeep: copy target creature's P/T until next upkeep, CR 613.4b / 500.2)", () => {
    it("is a {1}{W}{U}{B} 3/3 Legendary Shapeshifter with an upkeep trigger", () => {
        expect(halfdane.manaCost).toEqual({ X: 1, W: 1, U: 1, B: 1 });
        expect(halfdane.power).toBe(3);
        expect(halfdane.toughness).toBe(3);
        expect(halfdane.supertypes).toContain("Legendary");
        expect(halfdane.subtypes).toContain("Shapeshifter");
        expect(halfdane.triggeredAbilities?.[0]?.event).toBe("PHASE_BEGIN");
    });

    function setup() {
        const hd = makeInstance(halfdane.id, {
            id: "hd",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Target: a 2/2 Grizzly Bears the opponent controls.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [hd] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, hd };
    }

    it("offers every creature other than Halfdane, then copies the chosen creature's P/T", () => {
        const { state, hd } = setup();
        resolveTrigger(state, hd, "halfdane-copy-pt", upkeepEvent487("p1"));
        const head = state.pendingChoices?.[0];
        // CR 603.3d — the choice spans every battlefield (allControllers) and
        // the filter excludes Halfdane itself ("a creature other than ~").
        expect(head?.allControllers).toBe(true);
        expect(head?.filter?.types).toBe("Creature");
        expect(head?.filter?.excludeInstanceIds).toEqual(["hd"]);
        answerChoice(state, ["bear"]);
        // Halfdane becomes 2/2 (the bear's P/T).
        expect(getEffectivePower(state, hd)).toBe(2);
        expect(getEffectiveToughness(state, hd)).toBe(2);
    });

    it("reverts to printed 3/3 at the controller's next upkeep (CR 500.2)", () => {
        const { state, hd } = setup();
        resolveTrigger(state, hd, "halfdane-copy-pt", upkeepEvent487("p1"));
        answerChoice(state, ["bear"]);
        expect(getEffectivePower(state, hd)).toBe(2);
        // Run to p1's NEXT upkeep — the "until your next upkeep" set expires as
        // the boundary is crossed, before the trigger would re-fire.
        for (let i = 0; i < 40; i++) {
            advancePhase(state);
            if (state.phase === "UPKEEP" && state.activePlayerId === "p1") {
                break;
            }
        }
        expect(state.phase).toBe("UPKEEP");
        expect(hd.temporaryPTSet).toBeUndefined();
        expect(getEffectivePower(state, hd)).toBe(3);
        expect(getEffectiveToughness(state, hd)).toBe(3);
    });

    it("does NOT revert at the opponent's upkeep (player-scoped duration)", () => {
        const { state, hd } = setup();
        resolveTrigger(state, hd, "halfdane-copy-pt", upkeepEvent487("p1"));
        answerChoice(state, ["bear"]);
        for (let i = 0; i < 40; i++) {
            advancePhase(state);
            if (state.phase === "UPKEEP" && state.activePlayerId === "p2") {
                break;
            }
        }
        expect(state.activePlayerId).toBe("p2");
        // p1's set survives p2's upkeep.
        expect(getEffectivePower(state, hd)).toBe(2);
        expect(getEffectiveToughness(state, hd)).toBe(2);
    });

    it("a +1/+1 counter (7c) stacks on the copied 7b base P/T (CR 613.4)", () => {
        const { state, hd } = setup();
        resolveTrigger(state, hd, "halfdane-copy-pt", upkeepEvent487("p1"));
        answerChoice(state, ["bear"]);
        expect(getEffectivePower(state, hd)).toBe(2);
        hd.counters = { "+1/+1": 1 };
        // Set base 2/2 (7b) + counter (7c) = 3/3.
        expect(getEffectivePower(state, hd)).toBe(3);
        expect(getEffectiveToughness(state, hd)).toBe(3);
    });

    it("wire format: the copied base P/T survives projectPublicState", () => {
        const { state, hd } = setup();
        resolveTrigger(state, hd, "halfdane-copy-pt", upkeepEvent487("p1"));
        answerChoice(state, ["bear"]);
        expect(getEffectivePower(state, hd)).toBe(2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "hd"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});
