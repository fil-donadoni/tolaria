// `cost.exileTopOfLibrary` — "Exile the top card of your library" as an
// ACTIVATION cost (CR 118.1 — a cost is an action necessary to take another
// action; CR 701.13a — exiling moves the card to the exile zone; CR 601.2h via
// CR 602.2b — costs are paid while the ability is put on the stack).
//
// The CAPABILITY test for the leg: no shipped card carries it yet (Phyrexian
// Devourer, Royal Herbalist, Storm Elemental and Thought Lash wait on the
// grammar rule that reads the clause), so every commit site is proven here with
// synthetic definitions — the INLINE commit (`activateAbilityOnState`), the
// DEFERRED commit (`buildPendingActivation` + `tryAutoCommitPendingActivation`)
// and the TARGETED commit (`finalizeTargetSelection`), the three paths the
// `activateAbility` mutation calls.
//
// Each asserts the two observable halves: the TOP card (index 0) moves library →
// exile at commit, never at announcement; and its mana value rides to
// resolution as the CR 608.2h snapshot ("where X is the exiled card's mana
// value"), read back through the real `{ sacrificed: { read: "manaValue" } }`
// value. CR 118.3: an empty library makes the activation illegal.

import { describe, it, expect } from "vitest";
import { getCardByName, preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    activateAbilityOnState,
    buildPendingActivation,
    finalizeTargetSelection,
    tryAutoCommitPendingActivation,
} from "../../game";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const INLINE_ID = "00000000-0000-4000-8000-000064890001";
const MANA_ID = "00000000-0000-4000-8000-000064890002";
const TARGETED_ID = "00000000-0000-4000-8000-000064890003";

const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id; // mana value 2
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id; // mana value 1

const GAIN_X = [
    {
        op: "gainLife",
        player: "controller",
        amount: { sacrificed: { read: "manaValue" } },
    },
] as const;

preloadDefinitions([
    {
        // INLINE commit: no mana, no target — paid by `activateAbilityOnState`.
        id: INLINE_ID,
        name: "Synthetic Library Burner",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "burn-top",
                oracleText:
                    "Exile the top card of your library: You gain X life, where X is the exiled card's mana value.",
                cost: { exileTopOfLibrary: true },
                useStack: true,
                effects: [...GAIN_X],
            },
        ],
    } as CardDefinition,
    {
        // DEFERRED commit: a mana leg forces the payment phase.
        id: MANA_ID,
        name: "Synthetic Costed Library Burner",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "burn-top-costed",
                oracleText:
                    "{1}, Exile the top card of your library: You gain X life, where X is the exiled card's mana value.",
                cost: { mana: { generic: 1 }, exileTopOfLibrary: true },
                useStack: true,
                effects: [...GAIN_X],
            },
        ],
    } as CardDefinition,
    {
        // TARGETED commit: the ability parks a `pendingTarget`.
        id: TARGETED_ID,
        name: "Synthetic Targeted Library Burner",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "burn-top-targeted",
                oracleText:
                    "Exile the top card of your library: You gain X life, where X is the exiled card's mana value. Target creature is chosen on announcement.",
                cost: { exileTopOfLibrary: true },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [...GAIN_X],
            },
        ],
    } as CardDefinition,
]);

function libraryCard(cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
}

function boardWith(
    sourceId: string,
    librarySize: number,
    extra: { manaPool?: Record<string, number> } = {}
): GameState {
    const src = makeInstance(sourceId, {
        id: "src",
        controllerId: "p1",
        ownerId: "p1",
    });
    // Top (index 0) is the 2-MV Bears; under it the 1-MV Bolt — a wrong-end
    // read gives X = 1, not 2.
    const library = [
        libraryCard(GRIZZLY_BEARS, "top"),
        libraryCard(LIGHTNING_BOLT, "second"),
    ].slice(0, librarySize);
    const bear = makeInstance(GRIZZLY_BEARS, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [src],
                library,
                ...(extra.manaPool ? { manaPool: extra.manaPool } : {}),
            }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
}

const exileIds = (state: GameState) =>
    getPlayer(state, "p1").exile.map((c) => c.id);
const libraryIds = (state: GameState) =>
    getPlayer(state, "p1").library.map((c) => c.id);

describe("cost.exileTopOfLibrary — INLINE commit (CR 118.1 / 701.13a)", () => {
    it("exiles the TOP card at commit and resolves with its mana value as X (CR 608.2h)", () => {
        const state = boardWith(INLINE_ID, 2);
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top",
        });

        expect(state.stack).toHaveLength(1);
        expect(exileIds(state)).toEqual(["top"]);
        expect(libraryIds(state)).toEqual(["second"]);
        expect(state.stack[0].additionalSacrificeSnapshot).toMatchObject({
            cardInstanceId: "top",
            mv: 2,
        });

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 2);
    });

    it("is illegal with an EMPTY library (CR 118.3)", () => {
        const state = boardWith(INLINE_ID, 0);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "burn-top",
            })
        ).toThrow(/No card in library to exile/);
        expect(state.stack).toHaveLength(0);
    });

    it("projects the exiled card face up in exile and the shrunk library count", () => {
        const state = boardWith(INLINE_ID, 2);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top",
        });
        // The opponent's view: the card is public in exile (CR 406.3), the
        // library is one card shorter.
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.library.count).toBe(1);
        expect(p1.exile.map((c) => c.id)).toEqual(["top"]);
        expect(p1.exile[0].card.id).toBe(GRIZZLY_BEARS);
    });
});

describe("cost.exileTopOfLibrary — DEFERRED commit (CR 601.2h)", () => {
    function pending(state: GameState) {
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top-costed",
            ability: {
                id: "burn-top-costed",
                oracleText:
                    "{1}, Exile the top card of your library: You gain X life.",
                cost: { mana: { generic: 1 }, exileTopOfLibrary: true },
                useStack: true,
            },
            manaCost: { generic: 1 },
        });
    }

    it("leaves the library untouched at announcement and pays at commit", () => {
        const state = boardWith(MANA_ID, 2, { manaPool: { C: 1 } });
        pending(state);
        expect(state.pendingActivation!.exileTopOfLibrary).toBe(true);
        // Announcement is not payment.
        expect(libraryIds(state)).toEqual(["top", "second"]);

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(exileIds(state)).toEqual(["top"]);
        expect(state.stack[0].additionalSacrificeSnapshot?.mv).toBe(2);
    });

    it("drops the activation when the library emptied before commit, paying nothing", () => {
        const state = boardWith(MANA_ID, 1, { manaPool: { C: 1 } });
        pending(state);
        getPlayer(state, "p1").library = [];

        expect(tryAutoCommitPendingActivation(state, "p1")).toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation).toBeUndefined();
    });

    it("drives the whole mutation path: activateAbilityOnState defers, the commit pays", () => {
        const state = boardWith(MANA_ID, 2, { manaPool: { C: 1 } });
        const lifeBefore = getPlayer(state, "p1").life;
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top-costed",
        });
        expect(state.stack).toHaveLength(1);
        expect(exileIds(state)).toEqual(["top"]);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 2);
    });
});

describe("cost.exileTopOfLibrary — TARGETED commit (CR 601.2h / 602.2b)", () => {
    it("exiles the top card when target selection finalizes, not at announcement", () => {
        const state = boardWith(TARGETED_ID, 2);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top-targeted",
        });
        const pt = state.pendingTarget;
        expect(pt, "a targeted ability parks a pendingTarget").toBeDefined();
        expect(libraryIds(state)).toEqual(["top", "second"]);

        pt!.selected = [{ type: "permanent", id: "bear" }];
        finalizeTargetSelection(state, pt!, "p1");

        expect(state.stack).toHaveLength(1);
        expect(exileIds(state)).toEqual(["top"]);
        expect(state.stack[0].additionalSacrificeSnapshot?.mv).toBe(2);
    });

    it("refuses with an empty library when the targets finalize (CR 118.3)", () => {
        // The targeted path validates its non-mana legs at finalization, as it
        // does `discardAtRandom` and `life`; the throw rolls the whole
        // activation back (CR 601.2h — unpayable costs can't be paid).
        const state = boardWith(TARGETED_ID, 0);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "burn-top-targeted",
        });
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: "bear" }];
        expect(() => finalizeTargetSelection(state, pt, "p1")).toThrow(
            /No card in library to exile/
        );
        expect(state.stack).toHaveLength(0);
    });
});
