// `cost.returnThisToHand` — "Return this permanent to its owner's hand" as an
// ACTIVATION cost (CR 602.1a — "The activation cost is everything before the
// colon (:)"; CR 118.1 — a cost is an action necessary to take another action;
// CR 601.2h via CR 602.2b — costs are paid while the ability is being put on
// the stack, never at resolution).
//
// The bounce twin of `cost.exileThis`, and deliberately simpler: ONE source
// zone (a permanent's own battlefield departure), so there is no
// `activateFromGraveyard` dispatch to get wrong. What this file proves is the
// property that dispatch does not cover — the cost is paid at each of the
// THREE commit sites the mutation has, and it is paid to the card's OWNER
// (CR 400.3), not to the activating player.
//
// Everything runs through the REAL primitives — `activateAbilityOnState`,
// `buildPendingActivation` + `tryAutoCommitPendingActivation`, and
// `finalizeTargetSelection` — the same trio `exileThisActivationCost.test.ts`
// pins for the exile leg. The shipped card (Attunement, `sets/usg/blue.ts`)
// reaches only the inline site, so the other two are proven with synthetic
// definitions rather than left to the first card that happens to use them.

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

const MANA_SELF_BOUNCE_ID = "00000000-0000-4000-8000-000032040001";
const TARGETED_SELF_BOUNCE_ID = "00000000-0000-4000-8000-000032040002";
const FREE_SELF_BOUNCE_ID = "00000000-0000-4000-8000-000032040003";
const HAND_SOURCE_BOUNCE_ID = "00000000-0000-4000-8000-000032040004";

preloadDefinitions([
    {
        // The DEFERRED commit: a mana component forces the payment phase, so
        // the cost is paid by `tryAutoCommitPendingActivation`.
        id: MANA_SELF_BOUNCE_ID,
        name: "Synthetic Deferred Bouncer",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "self-bounce-gain",
                oracleText:
                    "{1}, Return this enchantment to its owner's hand: You gain 3 life.",
                cost: { mana: { generic: 1 }, returnThisToHand: true },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The TARGETED commit: the ability parks a `pendingTarget`, so the cost
        // is paid by `finalizeTargetSelection`.
        id: TARGETED_SELF_BOUNCE_ID,
        name: "Synthetic Targeted Bouncer",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "self-bounce-bolt",
                oracleText:
                    "Return this enchantment to its owner's hand: You gain 3 life. Target creature is chosen on announcement.",
                cost: { returnThisToHand: true },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The INLINE commit (Attunement's own shape): no mana, no target, so
        // `activateAbilityOnState` pays and pushes in one pass. A CREATURE, so
        // it can also stand in as a legal target above.
        id: FREE_SELF_BOUNCE_ID,
        name: "Synthetic Free Bouncer",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Creature"],
        subtypes: ["Spirit"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "free-self-bounce-gain",
                oracleText:
                    "Return this creature to its owner's hand: You gain 3 life.",
                cost: { returnThisToHand: true },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The MISAUTHORED shape the leg must fail closed on: the leg says
        // "return this PERMANENT", but the ability declares a HAND source, so
        // the activation locates `card` off the battlefield and the payment
        // finds nothing to move. Unlike `exileThis` there is no
        // `activateFromGraveyard` discriminator making this structurally
        // impossible, so the runtime has to refuse it (CR 601.2h — "Unpayable
        // costs can't be paid"); silently pushing the ability would make a
        // free, repeatable-from-hand ability.
        id: HAND_SOURCE_BOUNCE_ID,
        name: "Synthetic Misauthored Bouncer",
        rarity: "rare",
        manaCost: { generic: 1 },
        types: ["Enchantment"],
        activatedAbilities: [
            {
                id: "hand-source-bounce-gain",
                oracleText:
                    "Return this enchantment to its owner's hand: You gain 3 life.",
                cost: { returnThisToHand: true },
                activateFromHand: true,
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
]);

describe("cost.returnThisToHand — the INLINE commit (CR 602.1a / 601.2h)", () => {
    it("returns the source at commit, not at resolution", () => {
        const src = makeInstance(FREE_SELF_BOUNCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "free-self-bounce-gain",
        });

        // The ability is on the stack and the permanent is ALREADY gone — an
        // opponent holding priority has nothing left to destroy (CR 602.2b).
        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").hand.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
        // It went to HAND — never to the graveyard, the sibling leg's zone.
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(false);

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("returns it to its OWNER's hand, not the activating controller's (CR 400.3)", () => {
        // p1 CONTROLS a permanent p2 OWNS (a control-change effect's board).
        const src = makeInstance(FREE_SELF_BOUNCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2"),
            ],
        });

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "free-self-bounce-gain",
        });

        expect(getPlayer(state, "p2").hand.map((c) => c.id)).toEqual(["src"]);
        expect(getPlayer(state, "p1").hand).toHaveLength(0);
    });
});

describe("cost.returnThisToHand — the DEFERRED commit (CR 601.2h)", () => {
    it("carries the intent on the pending activation and pays it at commit", () => {
        const src = makeInstance(MANA_SELF_BOUNCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src], manaPool: { C: 1 } }),
                makePlayer("p2"),
            ],
        });

        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "self-bounce-gain",
            ability: {
                id: "self-bounce-gain",
                oracleText:
                    "{1}, Return this enchantment to its owner's hand: You gain 3 life.",
                cost: { mana: { generic: 1 }, returnThisToHand: true },
                useStack: true,
            },
            manaCost: { generic: 1 },
        });
        expect(state.pendingActivation.returnThisToHandSource).toBe(true);
        // Announcement is not payment (CR 601.2h) — the permanent is still on
        // the battlefield while the mana leg is outstanding.
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(true);

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(getPlayer(state, "p1").hand.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
    });
});

describe("cost.returnThisToHand — the TARGETED commit (CR 601.2h / 602.2b)", () => {
    it("returns the source when target selection finalizes, before the ability resolves", () => {
        const src = makeInstance(TARGETED_SELF_BOUNCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(FREE_SELF_BOUNCE_ID, {
            id: "target",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [src] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "self-bounce-bolt",
        });
        const pt = state.pendingTarget;
        expect(pt, "a targeted ability parks a pendingTarget").toBeDefined();
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(true);

        pt!.selected = [{ type: "permanent", id: "target" }];
        finalizeTargetSelection(state, pt!, "p1");

        expect(state.stack).toHaveLength(1);
        expect(getPlayer(state, "p1").hand.some((c) => c.id === "src")).toBe(
            true
        );
        expect(
            state.players.some((p) => p.battlefield.some((c) => c.id === "src"))
        ).toBe(false);
    });
});

describe("cost.returnThisToHand — an unpayable cost is refused (CR 601.2h)", () => {
    it("throws rather than putting the ability on the stack with the cost unpaid", () => {
        const src = makeInstance(HAND_SOURCE_BOUNCE_ID, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [src] }), makePlayer("p2")],
        });

        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "hand-source-bounce-gain",
            })
        ).toThrow(/not on the battlefield/);
        // Nothing reached the stack, and the card is still in hand — the whole
        // activation is rewound, not half-applied.
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").hand.map((c) => c.id)).toEqual(["src"]);
    });
});
