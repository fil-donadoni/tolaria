// 5DN — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { crucibleOfWorlds, pentadPrism } from "../colorless";
import { forest } from "../../lea/colorless";
import { resurrection } from "../../lea/white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { canPlayLandsFromGraveyard } from "../../../../gre/rules";
import {
    buildSpellContext,
    normalizeManaCost,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import {
    activateAbilityOnState,
    tryAutoCommitPendingCast,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

// Crucible of Worlds — {3} Artifact. "You may play lands from your
// graveyard." Same CR 305.1-analog permission as Icetill Explorer / Ramunap
// Excavator, from a NON-creature source — the permission scan
// (`canPlayLandsFromGraveyard`) is card-type-agnostic.
describe("Crucible of Worlds (play lands from your graveyard, CR 305.1-analog — issue #1190)", () => {
    it("an ARTIFACT source grants the permission, and it ends when the artifact leaves play", () => {
        const crucible = makeInstance(crucibleOfWorlds.id, {
            id: "crucible",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [crucible] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        expect(canPlayLandsFromGraveyard(state, player)).toBe(true);

        player.battlefield = [];
        expect(canPlayLandsFromGraveyard(state, player)).toBe(false);
    });

    it("wire format: a graveyard land carries legalActions:['play'] only while Crucible is in play, and never for the opponent's view", () => {
        const crucible = makeInstance(crucibleOfWorlds.id, {
            id: "crucible",
            controllerId: "p1",
            ownerId: "p1",
        });
        const gyLand = makeInstance(forest.id, {
            id: "gy-land",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [crucible],
                    graveyard: [gyLand],
                }),
                makePlayer("p2"),
            ],
        });

        const withCrucible = projectPublicState(state, 1, "p1");
        expect(
            withCrucible.players[0].graveyard.find((c) => c.id === "gy-land")!
                .legalActions
        ).toContain("play");

        // The opponent viewing p1's graveyard never sees the affordance.
        const opponentView = projectPublicState(state, 2, "p2");
        expect(
            opponentView.players[0].graveyard.find((c) => c.id === "gy-land")!
                .legalActions
        ).toBeUndefined();

        // Crucible leaves — the projection stops surfacing the affordance.
        state.players[0].battlefield = [];
        const withoutCrucible = projectPublicState(state, 3, "p1");
        expect(
            withoutCrucible.players[0].graveyard.find(
                (c) => c.id === "gy-land"
            )!.legalActions
        ).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pentad Prism — Sunburst (CR 702.44), issue #2378.
//
// Everything below drives the REAL seams: the {2} cost comes off the card, the
// mana is really paid by `tryAutoCommitPendingCast` (which is what populates
// `StackItem.notedManaSpent` via `manaSpentDelta`, CR 106.10), and the counters
// are placed by `resolveTopOfStack` → `applyEntersWithCounters`. Hand-setting
// `notedManaSpent` would assume away the very step under test — the same
// discipline `gre/__tests__/evoke.test.ts` applies to Vibrance.
//
// The count VOCABULARY (3 and 5 colours, which a {2} artifact can never reach;
// the zero/negative and colorless edges) is proven in
// `convex/gre/__tests__/entersWithCounters.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Casts Pentad Prism with `pool` floating, through the real cast-commit seam,
 *  and returns the state with the spell on the stack. */
function castPentadPrismWith(pool: Record<string, number>): GameState {
    const prism = makeInstance(pentadPrism.id, {
        id: "prism",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [makePlayer("p1", { hand: [prism] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    Object.assign(state.players[0].manaPool, pool);
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "prism",
        // The cost under test comes from the CARD, not from this test.
        manaCost: normalizeManaCost(pentadPrism.manaCost!),
        tappedLandIds: [],
    };
    expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
    return state;
}

/** Casts it and resolves it onto the battlefield. */
function enterPentadPrismWith(pool: Record<string, number>): GameState {
    const state = castPentadPrismWith(pool);
    resolveTopOfStack(state);
    return state;
}

function prismOnBoard(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "prism")!;
}

describe("Pentad Prism — Sunburst counts COLORS of mana spent to cast it (CR 702.44a)", () => {
    it("captures the colours actually spent on the {2} at cast-commit (CR 106.10)", () => {
        const state = castPentadPrismWith({ W: 1, U: 1 });
        // Both mana really left the pool — a cost treated as free would leave
        // them floating and the note empty.
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.players[0].manaPool.U).toBe(0);
        const item = state.stack.find((s) => s.id === "prism")!;
        expect(item.notedManaSpent).toEqual({ W: 1, U: 1 });
    });

    it("two colours spent → two charge counters", () => {
        const state = enterPentadPrismWith({ W: 1, U: 1 });
        expect(prismOnBoard(state).counters?.charge).toBe(2);
    });

    it("TWO PIPS OF ONE COLOUR → ONE charge counter (colors, not symbols)", () => {
        const state = enterPentadPrismWith({ R: 2 });
        expect(prismOnBoard(state).counters?.charge).toBe(1);
    });

    it("colored mana spent on the GENERIC cost contributes its colour; colorless contributes nothing", () => {
        const state = enterPentadPrismWith({ C: 1, G: 1 });
        expect(prismOnBoard(state).counters?.charge).toBe(1);
    });

    it("CR 702.44b — a cost paid entirely with colorless mana enters with NO counters", () => {
        const state = enterPentadPrismWith({ C: 2 });
        expect(prismOnBoard(state).counters?.charge).toBeUndefined();
    });

    it("CR 702.44b — a permanent PUT ONTO the battlefield was never cast, so it enters with no counters", () => {
        const prism = makeInstance(pentadPrism.id, {
            id: "prism",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [prism] }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "prism", "graveyard")).toBe(true);
        expect(prismOnBoard(state).counters?.charge).toBeUndefined();
    });

    it("wire format: the charge counters survive projectPublicState for both viewers", () => {
        const state = enterPentadPrismWith({ B: 1, R: 1 });
        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "prism"
            )!;
            expect(slim.counters?.charge).toBe(2);
        }
    });
});

describe("Pentad Prism — 'Remove a charge counter: Add one mana of any color' (CR 605.1a divergence)", () => {
    /** A resolved Pentad Prism with `charge` counters on it, priority with its
     *  controller. */
    function boardWithCharges(charge: number): GameState {
        const prism = makeInstance(pentadPrism.id, {
            id: "prism",
            controllerId: "p1",
            ownerId: "p1",
            ...(charge > 0 ? { counters: { charge } } : {}),
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [prism] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    it("removes exactly one counter and adds one mana of the CHOSEN colour", () => {
        const state = boardWithCharges(2);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "prism",
            abilityId: "pentad-prism-any-color",
            chosenModeId: "add-b",
        });
        // CR 122.6 — the counter is removed as a COST, at announcement.
        expect(prismOnBoard(state).counters?.charge).toBe(1);
        expect(state.players[0].manaPool.B ?? 0).toBe(0);

        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(1);
        // Only the chosen colour.
        expect(state.players[0].manaPool.G ?? 0).toBe(0);
    });

    it("every one of the five colours is a separately choosable mode", () => {
        for (const [modeId, color] of [
            ["add-w", "W"],
            ["add-u", "U"],
            ["add-b", "B"],
            ["add-r", "R"],
            ["add-g", "G"],
        ] as const) {
            const state = boardWithCharges(1);
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "prism",
                abilityId: "pentad-prism-any-color",
                chosenModeId: modeId,
            });
            resolveTopOfStack(state);
            expect(state.players[0].manaPool[color]).toBe(1);
            expect(prismOnBoard(state).counters?.charge ?? 0).toBe(0);
        }
    });

    it("is illegal with no charge counters on it (CR 118.4 — an unpayable cost)", () => {
        const state = boardWithCharges(0);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "prism",
                abilityId: "pentad-prism-any-color",
                chosenModeId: "add-r",
            })
        ).toThrow();
        expect(state.stack).toEqual([]);
        expect(state.players[0].manaPool.R ?? 0).toBe(0);
    });
});
