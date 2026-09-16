// Grantable attack requirement — "This creature attacks each combat if able"
// granted by a resolving ability (CR 508.1d / 613.1f, issue #1972).
//
// No shipped card grants the requirement yet (Carnage, Crimson Chaos waits on
// Mayhem, issue #1971), so the grant is exercised through synthetic
// definitions registered into the same registry `getDefinition` reads — the
// `grantedActivatedAbilities.test.ts` pattern. This file is the permanent
// Op-level test for the `grantAbility` Op's `attackRequirement` payload: the
// interpreter, the single predicate, the duration purge, the CR 400.7 scope,
// control change, serialization, the wire flag and the `game.ts` mutations.
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { CardInstanceState, GameState } from "../state";
import {
    applyControlChange,
    removePermanentTo,
    resetBattlefieldTransientState,
    resolveTopOfStack,
} from "../state";
import { finalizeCleanup } from "../phases";
import { getRequiredAttackerIds, isRequiredAttacker } from "../combat";
import { validateEffectScript } from "../effects/validate";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { confirmAttackers, toggleAttacker } from "../../game";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** "Target creature gains 'This creature attacks each combat if able.'" — no
 *  duration clause, so INDEFINITE (CR 611.2a). The Carnage shape. */
const INDEFINITE_GRANTER_ID = "test-1972-indefinite-granter";
const indefiniteGranter: CardDefinition = {
    id: INDEFINITE_GRANTER_ID,
    name: "Test Indefinite Attack Requirement",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    oracleText:
        'Target creature gains "This creature attacks each combat if able."',
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "grantAbility",
            target: { target: 0 },
            attackRequirement: true,
        },
    ],
};
registerTokenDefinition(indefiniteGranter);

/** The until-end-of-turn sibling. */
const EOT_GRANTER_ID = "test-1972-eot-granter";
const eotGranter: CardDefinition = {
    id: EOT_GRANTER_ID,
    name: "Test Until-EOT Attack Requirement",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    oracleText:
        'Target creature gains "This creature attacks each combat if able" until end of turn.',
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "grantAbility",
            target: { target: 0 },
            attackRequirement: true,
            duration: { phase: "end-of-turn" },
        },
    ],
};
registerTokenDefinition(eotGranter);

/** A creature that PRINTS "attacks each combat if able" (Juggernaut's
 *  shape) — the projected flag must cover it exactly like a granted one. */
const PRINTED_ID = "test-1972-printed";
registerTokenDefinition({
    id: PRINTED_ID,
    name: "Test Printed Requirement",
    rarity: "common",
    manaCost: { X: 4 },
    types: ["Creature"],
    power: 5,
    toughness: 3,
    staticEffects: [
        {
            kind: "attack-requirement",
            id: "test-1972-printed-req",
            oracleText: "This creature attacks each combat if able.",
        },
    ],
});

/** A vanilla creature with NO printed attack requirement. */
const RECIPIENT_ID = "test-1972-recipient";
registerTokenDefinition({
    id: RECIPIENT_ID,
    name: "Test Recipient",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

// `gameStateSeed` seeds its row under this fixed id.
const GAME_ID = "game-1" as Id<"games">;

/** p1 in DECLARE_ATTACKERS holding one untapped, non-sick vanilla creature. */
function combatBoard(overrides: Partial<CardInstanceState> = {}): GameState {
    const bear = makeInstance(RECIPIENT_ID, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...overrides,
    });
    return makeState({
        turn: 3,
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

/** Resolve `granterId` targeting p1's `bear`, keeping the combat context. */
function grant(state: GameState, granterId: string): CardInstanceState {
    const { phase, combat } = state;
    pushSpell(state, granterId, "p1", [{ type: "permanent", id: "bear" }]);
    resolveTopOfStack(state);
    state.phase = phase;
    state.combat = combat;
    return bearOf(state);
}

function bearOf(state: GameState): CardInstanceState {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "bear")!;
}

function required(state: GameState, playerIndex = 0): string[] {
    const player = state.players[playerIndex];
    const defender = state.players[1 - playerIndex];
    return getRequiredAttackerIds(
        player.battlefield,
        state,
        defender.battlefield,
        state.allCreaturesMustAttack
    );
}

/** CR 514.2 — the cleanup step's duration purge, then back into combat on the
 *  same controller's NEXT turn. */
function nextTurnCombat(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
    state.turn += 2;
    state.phase = "DECLARE_ATTACKERS";
    state.activePlayerId = "p1";
    state.combat = {
        attackerIds: [],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
}

// ── The Op ─────────────────────────────────────────────────────────────────

describe("grantAbility `attackRequirement` payload (CR 508.1d / 613.1f, issue #1972)", () => {
    it("validates alone, with or without a duration", () => {
        expect(validateEffectScript(indefiniteGranter)).toEqual([]);
        expect(validateEffectScript(eotGranter)).toEqual([]);
    });

    it("is rejected beside another payload — exactly one per Op", () => {
        const errors = validateEffectScript({
            ...indefiniteGranter,
            id: "test-1972-two-payloads",
            effects: [
                {
                    op: "grantAbility",
                    target: { target: 0 },
                    attackRequirement: true,
                    ability: "haste",
                },
            ],
        });
        expect(errors.join("\n")).toContain("requires exactly one of");
    });

    it("a creature with no printed requirement is free before the grant", () => {
        expect(required(combatBoard())).toEqual([]);
    });

    it("INDEFINITE: forced to attack this combat AND next turn's (survives cleanup)", () => {
        const state = combatBoard();
        const bear = grant(state, INDEFINITE_GRANTER_ID);
        expect(bear.grantedAttackRequirements).toEqual([
            { seq: expect.any(Number) },
        ]);
        expect(required(state)).toEqual(["bear"]);

        nextTurnCombat(state);
        expect(bearOf(state).grantedAttackRequirements).toHaveLength(1);
        expect(required(state)).toEqual(["bear"]);
    });

    it("UNTIL END OF TURN: forced this combat, free next turn", () => {
        const state = combatBoard();
        const bear = grant(state, EOT_GRANTER_ID);
        expect(bear.grantedAttackRequirements?.[0]?.duration).toEqual({
            phase: "end-of-turn",
        });
        expect(required(state)).toEqual(["bear"]);

        nextTurnCombat(state);
        expect(bearOf(state).grantedAttackRequirements).toBeUndefined();
        expect(required(state)).toEqual([]);
    });

    it("an expiring until-EOT grant does not take an indefinite one with it", () => {
        const state = combatBoard();
        grant(state, INDEFINITE_GRANTER_ID);
        grant(state, EOT_GRANTER_ID);
        expect(bearOf(state).grantedAttackRequirements).toHaveLength(2);
        nextTurnCombat(state);
        expect(bearOf(state).grantedAttackRequirements).toHaveLength(1);
        expect(required(state)).toEqual(["bear"]);
    });

    it("grants nothing when the target has left the battlefield (CR 608.2b)", () => {
        const state = combatBoard();
        pushSpell(state, INDEFINITE_GRANTER_ID, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        removePermanentTo(state, "bear", "graveyard");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // The departed card carries no grant, and returning it does not
        // resurrect one.
        const dead = state.players[0].graveyard.find((c) => c.id === "bear")!;
        expect(dead.grantedAttackRequirements).toBeUndefined();
    });
});

// ── CR 508.1d: a requirement that can't be obeyed is simply skipped ──────────

describe("granted requirement is skipped when the creature can't attack (CR 508.1d)", () => {
    it.each([
        ["tapped", { isTapped: true }],
        ["summoning sick", { isSummoningSick: true }],
        ["prohibited (defender)", { staticAbilities: ["defender"] }],
    ] as const)("%s", (_label, overrides) => {
        const state = combatBoard(overrides as Partial<CardInstanceState>);
        const bear = grant(state, INDEFINITE_GRANTER_ID);
        expect(bear.grantedAttackRequirements).toHaveLength(1);
        expect(required(state)).toEqual([]);
        expect(isRequiredAttacker(bear, state)).toBe(false);
    });
});

// ── Scope: control change and CR 400.7 ──────────────────────────────────────

describe("granted requirement scope (CR 400.7 / 613.1b)", () => {
    it("follows the creature through a control change", () => {
        const state = combatBoard();
        grant(state, INDEFINITE_GRANTER_ID);
        applyControlChange(state, "bear", "p2", "test-thief");
        const stolen = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(stolen.controllerId).toBe("p2");
        expect(stolen.grantedAttackRequirements).toHaveLength(1);

        // p2's combat: the requirement now binds its new controller.
        state.activePlayerId = "p2";
        stolen.isSummoningSick = false;
        expect(required(state, 1)).toEqual(["bear"]);
    });

    it.each(["graveyard", "exile", "hand", "library"] as const)(
        "is gone when the creature leaves the battlefield (→ %s)",
        (zone) => {
            const state = combatBoard();
            grant(state, INDEFINITE_GRANTER_ID);
            removePermanentTo(state, "bear", zone);
            const moved = state.players[0][zone].find((c) => c.id === "bear")!;
            expect(moved).toBeDefined();
            expect(moved.grantedAttackRequirements).toBeUndefined();
        }
    );

    it("the entry-side reset clears it too (a new object enters with none)", () => {
        const state = combatBoard();
        const bear = grant(state, INDEFINITE_GRANTER_ID);
        resetBattlefieldTransientState(bear, state);
        expect(bear.grantedAttackRequirements).toBeUndefined();
    });
});

// ── Serialization ───────────────────────────────────────────────────────────

describe("granted requirement serialization", () => {
    it("round-trips through compactState / expandState", () => {
        const state = combatBoard();
        grant(state, INDEFINITE_GRANTER_ID);
        grant(state, EOT_GRANTER_ID);
        const before = bearOf(state).grantedAttackRequirements;
        expect(before).toHaveLength(2);
        const restored = expandState(
            compactState(state) as Record<string, unknown>
        );
        expect(bearOf(restored).grantedAttackRequirements).toEqual(before);
        expect(required(restored)).toEqual(["bear"]);
    });
});

// ── Wire: the client affordance reads the server's answer ───────────────────

describe("projected `mustAttack` flag (issue #1972)", () => {
    const flagOf = (state: GameState, viewer: string) =>
        projectPublicState(state, 1, viewer)
            .players.flatMap((p) => p.battlefield)
            .find((c) => c.id === "bear")!.mustAttack;

    it("is set for a GRANTED requirement during declare attackers, for both viewers", () => {
        const state = combatBoard();
        expect(flagOf(state, "p1")).toBeUndefined();
        grant(state, INDEFINITE_GRANTER_ID);
        expect(flagOf(state, "p1")).toBe(true);
        expect(flagOf(state, "p2")).toBe(true);
    });

    it("is set for a PRINTED requirement and a this-turn one too (one predicate)", () => {
        const printed = combatBoard();
        printed.players[0].battlefield[0] = makeInstance(PRINTED_ID, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        expect(flagOf(printed, "p1")).toBe(true);

        const thisTurn = combatBoard({ mustAttackThisTurn: true });
        expect(flagOf(thisTurn, "p1")).toBe(true);
    });

    it("is absent outside the declare-attackers step and when the creature can't attack", () => {
        const state = combatBoard();
        grant(state, INDEFINITE_GRANTER_ID);
        state.phase = "PRECOMBAT_MAIN";
        expect(flagOf(state, "p1")).toBeUndefined();

        state.phase = "DECLARE_ATTACKERS";
        bearOf(state).isTapped = true;
        expect(flagOf(state, "p1")).toBeUndefined();
    });
});

// ── game.ts full path ───────────────────────────────────────────────────────

describe("declare-attackers mutations honour a granted requirement (CR 508.1d)", () => {
    type ToggleArgs = {
        gameId: Id<"games">;
        playerId: string;
        cardInstanceId: string;
    };
    type ConfirmArgs = { gameId: Id<"games">; playerId: string };

    const toggle = (ctx: Parameters<typeof runMutation>[1]) =>
        runMutation<ToggleArgs, void>(
            toggleAttacker as unknown as Handler<ToggleArgs, void>,
            ctx,
            { gameId: GAME_ID, playerId: "p1", cardInstanceId: "bear" }
        );
    const confirm = (ctx: Parameters<typeof runMutation>[1]) =>
        runMutation<ConfirmArgs, void>(
            confirmAttackers as unknown as Handler<ConfirmArgs, void>,
            ctx,
            { gameId: GAME_ID, playerId: "p1" }
        );

    function grantedBoard(): GameState {
        const state = combatBoard();
        grant(state, INDEFINITE_GRANTER_ID);
        state.combat!.attackerIds = ["bear"];
        return state;
    }

    it("refuses to deselect a creature granted the requirement", async () => {
        const h = makeMutationCtx("p1", [gameStateSeed(grantedBoard())]);
        await expect(toggle(h.ctx)).rejects.toThrow(
            "must attack this combat if able"
        );
        expect(h.state().combat!.attackerIds).toEqual(["bear"]);
    });

    it("confirming an empty selection folds the granted creature in", async () => {
        const state = grantedBoard();
        state.combat!.attackerIds = [];
        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await confirm(h.ctx);
        expect(h.state().combat!.attackerIds).toEqual(["bear"]);
    });
});
