// Compiled "when you cast this spell, if it was kicked" triggers reach the
// engine as REAL gates (CR 702.33d, CR 702.33f, CR 603.4).
//
// The grammar test (`oracle/__tests__/castKickedCondition.test.ts`) proves the
// Oracle text lowers to the right descriptor. It cannot prove the rebuilt
// ability reads the right record: a false positive announces a target for an
// ability CR 603.4 says never triggered, a false negative loses the ability.
// So each test compiles a real Oracle row, registers it, and drives a real cast
// through the commit path `convex/game.ts` runs.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import { forest, solRing } from "../../cards/sets/lea/colorless.cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { finalizeTargetSelection, tryAutoCommitPendingCast } from "../../game";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { compactState, expandState } from "../serialize";
import { resolveTopOfStack, type GameState } from "../state";

/** Grizzly Bears — a registered vanilla creature, an inert target. */
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const FOREST_ID = forest().id;
const SOL_RING_ID = solRing().id;

function register(
    id: string,
    card: ReturnType<typeof oracleCard>
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "rare" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const SOWING_MYCOSPAWN = register(
    "test-8170-sowing-mycospawn",
    oracleCard({
        name: "Sowing Mycospawn",
        manaCost: "{3}{G}",
        typeLine: "Creature — Eldrazi Fungus",
        oracleText:
            "Devoid (This card has no color.)\nKicker {1}{C} (You may pay an additional {1}{C} as you cast this spell.)\nWhen you cast this spell, search your library for a land card, put it onto the battlefield, then shuffle.\nWhen you cast this spell, if it was kicked, exile target land.",
        power: "3",
        toughness: "3",
    })
);

const WASTESCAPE_BATTLEMAGE = register(
    "test-8170-wastescape-battlemage",
    oracleCard({
        name: "Wastescape Battlemage",
        manaCost: "{1}{C}",
        typeLine: "Creature — Eldrazi Wizard",
        oracleText:
            "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\nWhen you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
        power: "2",
        toughness: "2",
    })
);

/** The real commit path: a paid `pendingCast`, carrying the announced kicker
 *  record, committed by the same call the cast mutation makes. */
function cast(
    definition: CardDefinition,
    kickerPayments: Record<string, number> | undefined,
    opponentBattlefield: ReturnType<typeof makeInstance>[]
): GameState {
    const spell = makeInstance(definition.id, {
        id: "cast-spell",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [spell] }),
            makePlayer("p2", { battlefield: opponentBattlefield }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "cast-spell",
            manaCost: {},
            tappedLandIds: [],
            ...(kickerPayments ? { kickerPayments } : {}),
        },
    });
    expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
    return state;
}

const permanent = (cardId: string, id: string) =>
    makeInstance(cardId, { id, controllerId: "p2", ownerId: "p2" });

const triggerIds = (state: GameState): (string | undefined)[] =>
    state.stack
        .filter((item) => item.triggeredAbilityId !== undefined)
        .map((item) => item.triggeredAbilityId);

function chooseTarget(state: GameState, id: string): void {
    const pending = state.pendingTarget!;
    pending.selected = [{ type: "permanent", id }];
    finalizeTargetSelection(state, pending, pending.playerId);
}

describe("the unnamed gate (CR 702.33d + CR 603.4)", () => {
    // Two legal targets, so the announcement raises a prompt.
    const lands = () => [
        permanent(FOREST_ID, "land"),
        permanent(FOREST_ID, "other-land"),
    ];

    it("an unkicked cast: the gated trigger never comes into being, no target announced", () => {
        const state = cast(SOWING_MYCOSPAWN, undefined, lands());
        expect(triggerIds(state)).toEqual(["sowing-mycospawn-trigger"]);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("a kicked cast: the gated trigger announces its target above the spell", () => {
        const state = cast(SOWING_MYCOSPAWN, { kicker: 1 }, lands());
        expect(triggerIds(state)).toEqual([
            "sowing-mycospawn-trigger",
            "sowing-mycospawn-trigger-2",
        ]);
        expect(state.pendingTarget?.kind).toBe("trigger");
    });

    it("resolving it exiles the chosen land", () => {
        const state = cast(SOWING_MYCOSPAWN, { kicker: 1 }, lands());
        chooseTarget(state, "land");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "other-land",
        ]);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["land"]);
    });

    it("the record outlives the spell: a countered kicked spell still resolves the trigger (CR 113.7a)", () => {
        const state = cast(SOWING_MYCOSPAWN, { kicker: 1 }, lands());
        chooseTarget(state, "land");
        state.stack = state.stack.filter((item) => item.id !== "cast-spell");
        resolveTopOfStack(state);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["land"]);
    });

    it("the record survives a save at the target prompt (a stable point)", () => {
        const live = cast(SOWING_MYCOSPAWN, { kicker: 1 }, lands());
        const state = expandState(compactState(live));
        chooseTarget(state, "land");
        resolveTopOfStack(state);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["land"]);
    });
});

describe("the per-kicker gate (CR 702.33f + CR 603.4)", () => {
    const board = () => [
        permanent(GRIZZLY_BEARS_ID, "creature"),
        permanent(GRIZZLY_BEARS_ID, "other-creature"),
        permanent(SOL_RING_ID, "artifact"),
        permanent(SOL_RING_ID, "other-artifact"),
    ];

    it("unkicked: neither trigger", () => {
        expect(
            triggerIds(cast(WASTESCAPE_BATTLEMAGE, undefined, board()))
        ).toEqual([]);
    });

    it("the {1}{U} kicker alone: only its own trigger", () => {
        const state = cast(WASTESCAPE_BATTLEMAGE, { "kicker-u": 1 }, board());
        expect(triggerIds(state)).toEqual(["wastescape-battlemage-trigger-2"]);
        chooseTarget(state, "creature");
        resolveTopOfStack(state);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["creature"]);
    });

    it("the {G} kicker alone: only its own trigger", () => {
        expect(
            triggerIds(cast(WASTESCAPE_BATTLEMAGE, { "kicker-g": 1 }, board()))
        ).toEqual(["wastescape-battlemage-trigger"]);
    });

    it("both kickers: both triggers", () => {
        expect(
            triggerIds(
                cast(
                    WASTESCAPE_BATTLEMAGE,
                    { "kicker-g": 1, "kicker-u": 1 },
                    board()
                )
            )
        ).toEqual([
            "wastescape-battlemage-trigger",
            "wastescape-battlemage-trigger-2",
        ]);
    });
});
