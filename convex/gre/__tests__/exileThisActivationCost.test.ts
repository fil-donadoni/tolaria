// `cost.exileThis` — "Exile this card/permanent" as an ACTIVATION cost
// (CR 118.1 — a cost is an action necessary to take another action; CR 601.2h
// via CR 602.2b — costs are paid while the ability is put on the stack).
//
// One flag, TWO source zones, dispatched on the ability's declared
// `activateFromGraveyard`: graveyard → exile (Eternalize CR 702.129a / Embalm
// CR 702.128a) and battlefield → exile (Feldon's Cane). This file is the
// CAPABILITY test for the commit paths no shipped card reaches: the catalogue
// exercises the graveyard leg's deferred commit (eternalize) and the
// battlefield leg's INLINE commit (Feldon's Cane, `sets/atq/__tests__`), while
// the battlefield leg's DEFERRED commit (a mana-costed self-exile) and the
// TARGETED commit (`finalizeTargetSelection`) have no card at all. Both are
// real code paths that a self-exile cost can now reach, so they are proven
// here with synthetic definitions rather than left to the first card that
// happens to use them.
//
// Everything runs through the REAL primitives — `buildPendingActivation` +
// `tryAutoCommitPendingActivation` and `activateAbilityOnState` +
// `finalizeTargetSelection`, the pairs the `activateAbility` mutation calls.

import { describe, it, expect } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    activateAbilityOnState,
    buildPendingActivation,
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
} from "../../game";
import { getPlayer, resolveTopOfStack } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const MANA_SELF_EXILE_ID = "00000000-0000-4000-8000-000022320001";
const TARGETED_SELF_EXILE_ID = "00000000-0000-4000-8000-000022320002";
const GRAVEYARD_SELF_EXILE_ID = "00000000-0000-4000-8000-000022320003";

preloadDefinitions([
    {
        // The DEFERRED battlefield leg: a mana component forces the payment
        // phase, so the cost is paid by `tryAutoCommitPendingActivation`.
        id: MANA_SELF_EXILE_ID,
        name: "Synthetic Self-Exiler",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "self-exile-gain",
                oracleText: "{1}, Exile this artifact: You gain 3 life.",
                cost: { mana: { generic: 1 }, exileThis: true },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The TARGETED battlefield leg: the ability parks a `pendingTarget`,
        // so the cost is paid by `finalizeTargetSelection`.
        id: TARGETED_SELF_EXILE_ID,
        name: "Synthetic Targeted Self-Exiler",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "self-exile-bolt",
                oracleText:
                    "Exile this artifact: You gain 3 life. Target creature is chosen on announcement.",
                cost: { exileThis: true },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The must-NOT-regress twin: the SAME flag on a GRAVEYARD-source
        // ability still exiles from the graveyard (the Eternalize shape). If
        // the zone dispatch ever inverts, this goes red while every
        // battlefield assertion above stays green.
        id: GRAVEYARD_SELF_EXILE_ID,
        name: "Synthetic Graveyard Self-Exiler",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Creature"],
        subtypes: ["Zombie"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "gy-self-exile-gain",
                oracleText:
                    "{1}, Exile this card from your graveyard: You gain 3 life.",
                cost: { mana: { generic: 1 }, exileThis: true },
                activateFromGraveyard: true,
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
]);

describe("cost.exileThis — the BATTLEFIELD leg (CR 118.1 / 601.2h)", () => {
    it("exiles the source at commit, not at resolution", () => {
        const src = makeInstance(MANA_SELF_EXILE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [src],
                    manaPool: { C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const lifeBefore = getPlayer(state, "p1").life;

        // Mana already floating covers the cost, so `activateAbilityOnState`
        // commits INLINE — the third of the three commit sites.
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "self-exile-gain",
        });
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").exile.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
        // The permanent went to EXILE, never to the graveyard.
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(false);

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("pays through the DEFERRED commit when a mana leg has to be tapped", () => {
        const src = makeInstance(MANA_SELF_EXILE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [src],
                    manaPool: { C: 1 },
                }),
                makePlayer("p2"),
            ],
        });

        // The real mutation's deferred pair: `buildPendingActivation` maps the
        // cost legs, `tryAutoCommitPendingActivation` pays them once the mana
        // is covered (supplied here as a floating pool).
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "self-exile-gain",
            ability: {
                id: "self-exile-gain",
                oracleText: "{1}, Exile this artifact: You gain 3 life.",
                cost: { mana: { generic: 1 }, exileThis: true },
                useStack: true,
            },
            manaCost: { generic: 1 },
        });
        expect(state.pendingActivation.exileThisSource).toBe(true);

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(getPlayer(state, "p1").exile.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
    });
});

describe("cost.exileThis — the TARGETED commit site (CR 601.2h / 602.2b)", () => {
    it("exiles the source when target selection finalizes, before the ability resolves", () => {
        const src = makeInstance(TARGETED_SELF_EXILE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(MANA_SELF_EXILE_ID, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        // A body with a toughness to damage — reuse the synthetic zombie.
        const target = makeInstance(GRAVEYARD_SELF_EXILE_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2", { battlefield: [victim, target] }),
            ],
        });

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "self-exile-bolt",
        });
        const pt = state.pendingTarget;
        expect(pt, "a targeted ability parks a pendingTarget").toBeDefined();
        // Cost NOT yet paid: announcement is not payment (CR 601.2h).
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(true);

        pt!.selected = [{ type: "permanent", id: "target" }];
        finalizeTargetSelection(state, pt!, "p1");

        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").exile.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
    });
});

describe("cost.exileThis — the GRAVEYARD leg still exiles from the graveyard (CR 702.129a)", () => {
    it("moves the source graveyard → exile, never touching any battlefield", () => {
        const src = makeInstance(GRAVEYARD_SELF_EXILE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [src],
                    manaPool: { C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "gy-self-exile-gain",
            ability: {
                id: "gy-self-exile-gain",
                oracleText:
                    "{1}, Exile this card from your graveyard: You gain 3 life.",
                cost: { mana: { generic: 1 }, exileThis: true },
                activateFromGraveyard: true,
                useStack: true,
            },
            manaCost: { generic: 1 },
            fromGraveyard: true,
        });

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
        expect(getPlayer(state, "p1").exile.some((c) => c.id === "src")).toBe(
            true
        );
    });
});
