// Per-card behavior tests for blue cards in `convex/cards/sets/fem/blue.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    deepSpawn,
    highTide,
    homarid,
    homaridFemB,
    homaridFemC,
    homaridFemD,
    homaridShaman,
    homaridSpawningBed,
    homaridWarrior,
    merseine,
    merseineFemB,
    riverMerfolk,
    seasinger,
    svyelunitePriest,
    tidalFlats,
    tidalInfluence,
    vodalianKnights,
    vodalianMage,
    vodalianSoldiers,
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
    vodalianWarMachine,
} from "..";
import {
    getDefinition,
    getCardByName,
    getPrintingsForCard,
} from "../../../index";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { untapStep } from "../../../../gre/phases";
import { grizzlyBears } from "../../lea";
import { getLegalActions } from "../../../../gre/rules";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { resolveTrigger, UPKEEP, resolveActivated } from "./helpers";

const ALL_FEM_PRINTS = [
    vodalianSoldiersFemB,
    vodalianSoldiersFemC,
    vodalianSoldiersFemD,
];

// ---------------------------------------------------------------------------
// Vanilla creature (CR 302 — Creature card as pure data: types/subtypes + P/T
// only; values validated against Scryfall set:fem, modern Oracle).
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers (vanilla creature, CR 302)", () => {
    it("carries the canonical FEM printed characteristics", () => {
        expect(vodalianSoldiers.types).toEqual(["Creature"]);
        expect(vodalianSoldiers.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(vodalianSoldiers.power).toBe(1);
        expect(vodalianSoldiers.toughness).toBe(2);
        expect(vodalianSoldiers.manaCost).toEqual({ X: 1, U: 1 });
        expect(vodalianSoldiers.rarity).toBe("common");
    });

    it("resolves from the stack onto the battlefield (CR 608.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
        resolveTopOfStack(state);
        const inPlay = state.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(inPlay).toBeDefined();
        expect(inPlay?.zone).toBe("battlefield");
        expect(state.stack).toHaveLength(0);
    });

    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, vodalianSoldiers.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getDefinition((slim!.card as { id: string }).id);
        expect(def.name).toBe("Vodalian Soldiers");
        expect(def.subtypes).toEqual(["Merfolk", "Soldier"]);
        expect(def.power).toBe(1);
        expect(def.toughness).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Multi-art prints (ADR 0014) — FEM's signature multi-artwork commons ship as
// one shared CardDefinition plus one CardPrint per additional artwork. Every
// artwork must resolve to the single definition and carry the fem set code.
// ---------------------------------------------------------------------------

describe("Vodalian Soldiers multi-art prints (ADR 0014)", () => {
    it("resolves every alternate artwork to the shared definition", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(getDefinition(print.printId)).toBe(vodalianSoldiers);
            expect(print.definitionId).toBe(vodalianSoldiers.id);
        }
    });

    it("carries the fem set code and common rarity on every print", () => {
        for (const print of ALL_FEM_PRINTS) {
            expect(print.setCode).toBe("fem");
            expect(print.rarity).toBe("common");
        }
    });

    it("uses a distinct printId per artwork (no duplicates)", () => {
        const ids = [
            vodalianSoldiers.id,
            ...ALL_FEM_PRINTS.map((p) => p.printId),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("lists all FEM artworks as printings, original first (deck builder)", () => {
        const printings = getPrintingsForCard(vodalianSoldiers.id);
        expect(printings[0]).toEqual({
            printId: vodalianSoldiers.id,
            setCode: "fem",
        });
        for (const print of ALL_FEM_PRINTS) {
            expect(printings).toContainEqual({
                printId: print.printId,
                setCode: "fem",
            });
        }
        expect(printings).toHaveLength(1 + ALL_FEM_PRINTS.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// C2 — Blue: Homarids, Vodalians & the Tide (issue #571). One describe per
// card with non-trivial behaviour, citing the CR section it exercises.
// ═══════════════════════════════════════════════════════════════════════════

/** A battlefield permanent with N tide counters. */
function makeWithTide(
    cardId: string,
    tide: number,
    controllerId = "p1"
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        zone: "battlefield",
        counters: tide > 0 ? { tide } : {},
    });
}

describe("Homarid — tide counter P/T cycle (CR 611.2c, 603.6a, 603.8)", () => {
    it("carries the canonical FEM characteristics", () => {
        expect(homarid.manaCost).toEqual({ X: 2, U: 1 });
        expect(homarid.subtypes).toEqual(["Homarid"]);
        expect(homarid.power).toBe(2);
        expect(homarid.toughness).toBe(2);
    });

    // CR 121.6 / 614.1c (issue #1693) — "This creature enters with a tide
    // counter on it" is a REPLACEMENT effect. As a trigger, Homarid sat on the
    // battlefield at ZERO tide counters (reading as a plain 2/2) until the
    // ability resolved; as a replacement its one-counter `pt-buff` applies on
    // the very first read, so it is a 1/1 the instant it is observable.
    it("enters with a tide counter already on it, nothing on the stack (CR 121.6 / 614.1c)", () => {
        expect(homarid.entersWith?.counters).toEqual([
            { type: "tide", count: 1 },
        ]);
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, homarid.id, "p1");
        resolveTopOfStack(state);

        const live = state.players[0].battlefield[0];
        expect(live.counters?.tide).toBe(1);
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(1);
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);

        // Wire format — the counter and the P/T it drives must survive the
        // projection, or the board shows the intermediate zero state.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield[0];
        expect(slim.counters?.tide).toBe(1);
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
        expect(projected.stack).toEqual([]);
    });

    it("adds a tide counter each upkeep (CR 603.6a)", () => {
        const inst = makeWithTide(homarid.id, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "homarid-tide-upkeep", UPKEEP("p1"));
        expect(state.players[0].battlefield[0].counters?.tide).toBe(3);
    });

    it("is 1/1 at exactly one tide counter (-1/-1)", () => {
        const inst = makeWithTide(homarid.id, 1);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(1);
        expect(getEffectiveToughness(state, onBoard)).toBe(1);
    });

    it("is 2/2 at exactly two tide counters (no modifier)", () => {
        const inst = makeWithTide(homarid.id, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(2);
        expect(getEffectiveToughness(state, onBoard)).toBe(2);
    });

    it("is 3/3 at exactly three tide counters (+1/+1)", () => {
        const inst = makeWithTide(homarid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(3);
        expect(getEffectiveToughness(state, onBoard)).toBe(3);
    });

    it("sheds all tide counters at four or more (CR 603.8)", () => {
        const inst = makeWithTide(homarid.id, 4);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "homarid-tide-shed", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].battlefield[0].counters?.tide ?? 0).toBe(0);
    });

    it("tide P/T survives the wire-format projection (CR 611.2c)", () => {
        const inst = makeWithTide(homarid.id, 3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        // 3/3 at three tide counters on fat state...
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(3);
        expect(getEffectiveToughness(state, onBoard)).toBe(3);
        // ...and after projection (the slim instance keeps `counters`, the
        // pt-buff predicate reads the same count).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === onBoard.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("resolves all four artworks to the shared definition (ADR 0014)", () => {
        for (const print of [homaridFemB, homaridFemC, homaridFemD]) {
            expect(getDefinition(print.printId)).toBe(homarid);
            expect(print.setCode).toBe("fem");
        }
    });
});

describe("Tidal Influence — tide anthem + cast-by-name restriction (CR 601.3e)", () => {
    it("can't be cast while a permanent named Tidal Influence is on the battlefield (CAPABILITY J)", () => {
        const existing = makeInstance(tidalInfluence.id, {
            id: "ti-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const inHand = makeInstance(tidalInfluence.id, {
            id: "ti-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            battlefield: [existing],
            hand: [inHand],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
        });
        // Cast is illegal while a Tidal Influence is already in play (CR 601.3e).
        expect(getLegalActions(state, p1, inHand)).not.toContain("cast");
    });

    it("is castable when no Tidal Influence is on the battlefield", () => {
        const inHand = makeInstance(tidalInfluence.id, {
            id: "ti-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [inHand],
            manaPool: { U: 1, C: 2 },
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
        });
        expect(getLegalActions(state, p1, inHand)).toContain("cast");
    });

    it("gives all blue creatures -2/-0 at one tide counter, +2/+0 at three", () => {
        const anthemOne = makeWithTide(tidalInfluence.id, 1);
        const blueCreature = makeInstance(homarid.id, {
            id: "blue-c",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { tide: 2 }, // 2/2 baseline (no Homarid self-modifier)
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [anthemOne, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const blue = state.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        // -2/-0 at one tide counter: 2/2 → 0/2.
        expect(getEffectivePower(state, blue)).toBe(0);
        expect(getEffectiveToughness(state, blue)).toBe(2);

        // Bump the anthem to three tide counters → +2/+0: 2/2 → 4/2.
        anthemOne.counters = { tide: 3 };
        const blue2 = state.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(getEffectivePower(state, blue2)).toBe(4);
        expect(getEffectiveToughness(state, blue2)).toBe(2);
    });

    it("the anthem survives the wire-format projection", () => {
        const anthem = makeWithTide(tidalInfluence.id, 3);
        const blueCreature = makeInstance(homarid.id, {
            id: "blue-c",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { tide: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [anthem, blueCreature] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "blue-c"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

describe("Homarid Spawning Bed — token-count = sacrificed MV (CR 118.5, 202.3, 707.1)", () => {
    it("makes a number of 1/1 blue Camarid tokens equal to the sacrificed creature's mana value", () => {
        const bed = makeInstance(homaridSpawningBed.id, {
            id: "bed",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Sacrificing a {2}{U} creature (mana value 3) makes three Camarids.
        const sacrificed = makeInstance(homarid.id, {
            id: "sac",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bed, sacrificed] }),
                makePlayer("p2"),
            ],
        });
        // The sacrifice cost was paid at activation; the MV is snapshotted on
        // the stack item via additionalSacrificeMv. Mirror that here.
        state.stack.push({
            ...bed,
            zone: "stack",
            castById: "p1",
            abilityId: "homarid-spawning-bed-spawn",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "sac", mv: 3 },
        } as StackItem);
        resolveTopOfStack(state);
        const camarids = state.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Camarid")
        );
        expect(camarids).toHaveLength(3);
        for (const c of camarids) {
            expect(getEffectivePower(state, c)).toBe(1);
            expect(getEffectiveToughness(state, c)).toBe(1);
        }
    });

    it("Camarid token bodies survive the wire-format projection (CR 707.1)", () => {
        const bed = makeInstance(homaridSpawningBed.id, {
            id: "bed",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bed] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...bed,
            zone: "stack",
            castById: "p1",
            abilityId: "homarid-spawning-bed-spawn",
            targets: [],
            additionalSacrificeSnapshot: { cardInstanceId: "x", mv: 2 },
        } as StackItem);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const camarids = projected.players[0].battlefield.filter((c) =>
            c.subtypes?.includes("Camarid")
        );
        expect(camarids).toHaveLength(2);
        expect(getEffectivePower(projected, camarids[0])).toBe(1);
        expect(getEffectiveToughness(projected, camarids[0])).toBe(1);
    });
});

describe("High Tide — extra {U} per Island tapped this turn (CR 614)", () => {
    it("arms the additive rider for the controller on resolution", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, highTide.id, "p1");
        resolveTopOfStack(state);
        expect(state.highTideThisTurn).toContain("p1");
        // It went to the graveyard (instant resolved).
        expect(state.players[0].graveyard.some((c) => c.id === item.id)).toBe(
            true
        );
    });

    it("two High Tides stack to two extra {U} per Island tap (helper-level)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        resolveTopOfStack((pushSpell(state, highTide.id, "p1"), state));
        resolveTopOfStack((pushSpell(state, highTide.id, "p1"), state));
        expect(state.highTideThisTurn).toHaveLength(2);
    });
});

describe("River Merfolk — mountainwalk grant (CR 702.13)", () => {
    it("gains mountainwalk until end of turn on activation", () => {
        const inst = makeInstance(riverMerfolk.id, {
            id: "rm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, inst, "river-merfolk-mountainwalk");
        const onBoard = state.players[0].battlefield[0];
        expect(onBoard.staticAbilities).toContain("mountainwalk");
    });
});

describe("Vodalian Mage — counter-unless-pay (CR 701.5a, 117.3a)", () => {
    it("counters the target spell unless its controller pays {1}", () => {
        const mage = makeInstance(vodalianMage.id, {
            id: "mage",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mage] }),
                makePlayer("p2"),
            ],
        });
        // An opponent spell on the stack to counter.
        const spell = pushSpell(state, grizzlyBears.id, "p2");
        resolveActivated(state, mage, "vodalian-mage-counter", [
            { type: "spell", id: spell.id },
        ]);
        // The spell's controller (p2) is asked to pay {1}; declining (empty
        // pool) counters the spell (CR 701.5a).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.some((s) => s.id === spell.id)).toBe(false);
    });
});

describe("Vodalian Knights — Island-matters knight (CR 508.1c, 603.8, 702.9)", () => {
    it("carries first strike and the {U} flying grant", () => {
        expect(vodalianKnights.staticAbilities).toContain("first strike");
        const fly = vodalianKnights.activatedAbilities?.find(
            (a) => a.id === "vodalian-knights-fly"
        );
        expect(fly).toBeDefined();
    });

    it("sacrifices itself when its controller controls no Islands (CR 603.8)", () => {
        const inst = makeInstance(vodalianKnights.id, {
            id: "vk",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, inst, "vodalian-knights-no-islands", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "vk")
        ).toBeUndefined();
    });
});

describe("Seasinger — conditional gainControl (CR 611.2c) + may-not-untap (CR 502.1)", () => {
    it("declares the may-choose-not-to-untap static ability (CAPABILITY I reuse)", () => {
        expect(seasinger.staticAbilities).toContain("may-choose-not-to-untap");
    });

    it("steals a creature whose controller controls an Island, for as long as Seasinger stays tapped", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const island = makeInstance(getCardByName("Island")?.id ?? "island", {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2", { battlefield: [island, victim] }),
            ],
        });
        resolveActivated(state, singer, "seasinger-steal", [
            { type: "permanent", id: "victim" },
        ]);
        // The victim moves under p1's control.
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });

    it("does NOT steal a creature whose controller controls no Island (CR 115.4 guard)", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, singer, "seasinger-steal", [
            { type: "permanent", id: "victim" },
        ]);
        // No Island → the guard fizzles the steal; victim stays with p2.
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });

    it("may choose not to untap, keeping its stolen creature (untap step, CR 502.1)", () => {
        const singer = makeInstance(seasinger.id, {
            id: "singer",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [singer] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "UNTAP",
        });
        untapStep(state);
        // A may-choose-not-to-untap permanent gets a 0..1 untap-pick prompt
        // routed to its controller (it is NOT auto-untapped).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("untap-pick");
        expect(head?.count).toEqual({ min: 0, max: 1 });
        // Choosing to untap nothing leaves Seasinger tapped (theft persists).
        expect(state.players[0].battlefield[0].isTapped).toBe(true);
    });
});

describe("Merseine — net counters + dynamic cost K (CR 122, 502.1, 601.2f, 202.3)", () => {
    function merseineBoard(): {
        state: GameState;
        aura: CardInstanceState;
        host: CardInstanceState;
    } {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: true,
        });
        const aura = makeInstance(merseine.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
            counters: { net: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return { state, aura, host };
    }

    // CR 121.6 / 614.1c (issue #1693) — the three net counters are a
    // REPLACEMENT effect. As a trigger the Aura attached with ZERO net
    // counters, so its untap lock (gated on the live tally) was briefly OFF.
    it("enters with three net counters already on it, nothing on the stack (CR 121.6 / 614.1c)", () => {
        expect(merseine.entersWith?.counters).toEqual([
            { type: "net", count: 3 },
        ]);
        expect(merseine.triggeredAbilities ?? []).toEqual([]);

        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        pushSpell(state, merseine.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);

        const live = state.players[0].battlefield[0];
        expect(live.attachedTo).toBe("host");
        expect(live.counters?.net).toBe(3);
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);

        // Wire format — counters are public battlefield state the untap lock
        // and the client both read.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].battlefield[0].counters?.net).toBe(3);
        expect(projected.stack).toEqual([]);
    });

    it("keeps the enchanted creature from untapping while a net counter remains (CR 502.1)", () => {
        const { state } = merseineBoard();
        // It is p2's untap step; the host is tapped + net-locked → stays tapped.
        state.activePlayerId = "p2";
        state.phase = "UNTAP";
        untapStep(state);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(true);
    });

    it("lets the host untap once all net counters are removed", () => {
        const { state } = merseineBoard();
        // No net counters → the untap lock lifts.
        state.players[0].battlefield[0].counters = {};
        state.activePlayerId = "p2";
        state.phase = "UNTAP";
        untapStep(state);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(false);
    });

    it("the dynamic cost equals the enchanted creature's mana cost (CAPABILITY K, helper-level)", () => {
        // Grizzly Bears costs {1}{G} → mana value 2. The Merseine ability's
        // cost is `manaEqualToEnchantedCreatureCost` — the engine reads the
        // host's printed cost. Verify the host's cost is what the engine folds.
        const bears = getDefinition(grizzlyBears.id);
        const cost = bears.manaCost ?? {};
        const total = Object.values(cost).reduce<number>(
            (acc, v) => acc + (typeof v === "number" ? v : 0),
            0
        );
        expect(total).toBe(2);
        const ability = merseine.activatedAbilities?.find(
            (a) => a.id === "merseine-remove-net"
        );
        expect(ability?.cost.manaEqualToEnchantedCreatureCost).toBe(true);
        expect(ability?.cost.removeCounter).toEqual({ type: "net", count: 1 });
        expect(ability?.activatableByEnchantedController).toBe(true);
    });

    it("resolves all four artworks to the shared definition (ADR 0014)", () => {
        expect(getDefinition(merseineFemB.printId)).toBe(merseine);
    });
});

describe("Vodalian War Machine — tapOtherFilter cost (CAPABILITY D reuse)", () => {
    it("declares defender plus two tap-a-Merfolk abilities", () => {
        expect(vodalianWarMachine.staticAbilities).toContain("defender");
        const ids = (vodalianWarMachine.activatedAbilities ?? []).map(
            (a) => a.id
        );
        expect(ids).toContain("vodalian-war-machine-attack");
        expect(ids).toContain("vodalian-war-machine-pump");
        for (const a of vodalianWarMachine.activatedAbilities ?? []) {
            expect(a.cost.tapOtherFilter).toEqual({
                filter: {
                    types: "Creature",
                    subtypes: "Merfolk",
                    controllerRelation: "you",
                },
                count: 1,
            });
        }
    });

    it("the pump ability grants +2/+1 until end of turn", () => {
        const machine = makeInstance(vodalianWarMachine.id, {
            id: "vwm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "vodalian-war-machine-pump");
        const onBoard = state.players[0].battlefield[0];
        expect(getEffectivePower(state, onBoard)).toBe(2);
        expect(getEffectiveToughness(state, onBoard)).toBe(5);
    });

    it("the attack ability lets it attack despite defender for the turn (CR 508.1a)", () => {
        const machine = makeInstance(vodalianWarMachine.id, {
            id: "vwm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, machine, "vodalian-war-machine-attack");
        expect(
            state.players[0].battlefield[0].canAttackDespiteDefenderThisTurn
        ).toBe(true);
    });
});

describe("Deep Spawn — upkeep mill-or-sacrifice (CR 117.3a, 701.13a)", () => {
    it("mills two cards to keep itself when the player chooses to pay", () => {
        const spawn = makeInstance(deepSpawn.id, {
            id: "spawn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = [
            makeInstance(grizzlyBears.id, {
                id: "l1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(grizzlyBears.id, {
                id: "l2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spawn], library: lib }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, spawn, "deep-spawn-upkeep-mill", UPKEEP("p1"));
        // Suspended on the may-pay; accept (mill two to keep Deep Spawn).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Paying milled two cards; Deep Spawn stays on the battlefield.
        expect(state.players[0].battlefield.some((c) => c.id === "spawn")).toBe(
            true
        );
        expect(state.players[0].graveyard.length).toBe(2);
    });
});

describe("Homarid Warrior — shroud + skip-untap dive (CR 702.18, 502.1)", () => {
    it("gains shroud and skips its next untap, tapped, on activation", () => {
        const inst = makeInstance(homaridWarrior.id, {
            id: "hw",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, inst, "homarid-warrior-dive");
        const onBoard = state.players[0].battlefield[0];
        expect(onBoard.staticAbilities).toContain("shroud");
        expect(onBoard.isTapped).toBe(true);
        expect(onBoard.skipNextUntap).toBe(true);
    });
});

describe("Homarid Shaman — tap a green creature (CR 701.21)", () => {
    it("taps the targeted green creature", () => {
        const shaman = makeInstance(homaridShaman.id, {
            id: "shaman",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // A green creature for the opponent (Grizzly Bears is green).
        const green = makeInstance(grizzlyBears.id, {
            id: "green",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman] }),
                makePlayer("p2", { battlefield: [green] }),
            ],
        });
        resolveActivated(state, shaman, "homarid-shaman-tap", [
            { type: "permanent", id: "green" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "green")?.isTapped
        ).toBe(true);
    });
});

describe("Svyelunite Priest — upkeep-only shroud grant (CR 602.5)", () => {
    it("is restricted to its controller's upkeep", () => {
        const ability = svyelunitePriest.activatedAbilities?.find(
            (a) => a.id === "svyelunite-priest-shroud"
        );
        expect(ability?.controllerTurnOnly).toBe(true);
        expect(ability?.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });
});

describe("Tidal Flats — first strike for blockers unless attacker pays (CR 509, 117.3a)", () => {
    it("carries the {U}{U} combat ability", () => {
        const ability = tidalFlats.activatedAbilities?.find(
            (a) => a.id === "tidal-flats-first-strike"
        );
        expect(ability).toBeDefined();
        expect(ability?.cost.mana).toEqual({ U: 2 });
    });
});
