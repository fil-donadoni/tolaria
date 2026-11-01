// Defender-pinned attack requirement — "This creature attacks THAT PLAYER this
// combat if able" (CR 508.1d, issue #3247). The widening of the granted
// requirement (issue #1972, `grantedAttackRequirement.test.ts`) by the
// `grantAbility` Op's `defender` field: the grant names a player, binds only
// while that player can be attacked, and is obeyed only by attacking that
// player — sending the creature at a planeswalker they control obeys one
// requirement fewer than attacking the player, so the declaration is illegal.
//
// Covers the Op (validation, resolution), the binding predicate, every
// declaration site (`toggleAttacker`, `declareAttackers`, the confirm-time
// backstop `validateDeclaredAttackers`, the Bot's `declaredAttackTargets`) and
// the first shipped card, Ursine Monstrosity.
import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";
import { resolveTopOfStack } from "../state";
import {
    isRequiredAttacker,
    pinnedAttackDefenderOf,
    validateDeclaredAttackers,
} from "../combat";
import { declaredAttackTargets } from "../applyMove";
import { collectTriggers } from "../triggers";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { validateEffectScript } from "../effects/validate";
import { declareAttackers, toggleAttacker } from "../../game";
import type { Id } from "../../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";

// ── Fixtures ────────────────────────────────────────────────────────────────

function pinnedGranter(id: string, defender: "opponent" | "controller") {
    const def: CardDefinition = {
        id,
        name: `Test Pinned Requirement (${defender})`,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        oracleText: "Target creature attacks that player this combat if able.",
        targetRequirement: { type: "Creature", count: 1 },
        effects: [
            {
                op: "grantAbility",
                target: { target: 0 },
                attackRequirement: true,
                defender,
                duration: { phase: "end-of-combat" },
            },
        ],
    };
    registerTokenDefinition(def);
    return def;
}
const opponentPinned = pinnedGranter("test-3247-pin-opponent", "opponent");
const controllerPinned = pinnedGranter(
    "test-3247-pin-controller",
    "controller"
);

/** The unpinned sibling — attacks anything if able (issue #1972). */
const UNPINNED_ID = "test-3247-unpinned";
registerTokenDefinition({
    id: UNPINNED_ID,
    name: "Test Unpinned Requirement",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    oracleText: "Target creature attacks this combat if able.",
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "grantAbility",
            target: { target: 0 },
            attackRequirement: true,
            duration: { phase: "end-of-combat" },
        },
    ],
});

const RECIPIENT_ID = "test-3247-recipient";
registerTokenDefinition({
    id: RECIPIENT_ID,
    name: "Test Pinned Recipient",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

const WALKER_ID = "test-3247-walker";
registerTokenDefinition({
    id: WALKER_ID,
    name: "Test Walker",
    rarity: "common",
    manaCost: { U: 3 },
    types: ["Planeswalker"],
    loyalty: 3,
});

const GAME_ID = "game-1" as Id<"games">;

/** p1 in DECLARE_ATTACKERS with one ready creature; p2 controls a walker. */
function combatBoard(): GameState {
    const bear = makeInstance(RECIPIENT_ID, {
        id: "bear",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const walker = makeInstance(WALKER_ID, {
        id: "walker",
        controllerId: "p2",
        ownerId: "p2",
        counters: { loyalty: 3 },
    });
    return makeState({
        turn: 3,
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [bear] }),
            makePlayer("p2", { battlefield: [walker] }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function bearOf(state: GameState): CardInstanceState {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "bear")!;
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

// ── The Op ─────────────────────────────────────────────────────────────────

describe("grantAbility `defender` field (CR 508.1d, issue #3247)", () => {
    it("validates beside `attackRequirement` and is refused without it", () => {
        expect(validateEffectScript(opponentPinned)).toEqual([]);
        const errors = validateEffectScript({
            ...opponentPinned,
            effects: [
                {
                    op: "grantAbility",
                    target: { target: 0 },
                    ability: "trample",
                    defender: "opponent",
                },
            ],
        });
        expect(errors.join("\n")).toContain(
            '"defender" is only valid with "attackRequirement"'
        );
    });

    it("resolves the player ref once, storing the concrete id on the grant", () => {
        const bear = grant(combatBoard(), opponentPinned.id);
        expect(bear.grantedAttackRequirements).toHaveLength(1);
        expect(bear.grantedAttackRequirements![0].defenderId).toBe("p2");
    });
});

// ── Binding ─────────────────────────────────────────────────────────────────

describe("a pinned requirement binds only while that player can be attacked (CR 508.1d / 506.2)", () => {
    it("pinned to the opponent: required, and names the opponent", () => {
        const state = combatBoard();
        const bear = grant(state, opponentPinned.id);
        expect(isRequiredAttacker(bear, state)).toBe(true);
        expect(pinnedAttackDefenderOf(bear, state)).toBe("p2");
    });

    it("pinned to its own controller: imposes nothing (cannot be obeyed)", () => {
        const state = combatBoard();
        const bear = grant(state, controllerPinned.id);
        expect(bear.grantedAttackRequirements![0].defenderId).toBe("p1");
        expect(isRequiredAttacker(bear, state)).toBe(false);
        expect(pinnedAttackDefenderOf(bear, state)).toBeUndefined();
    });

    it("an unpinned grant names no defender", () => {
        const state = combatBoard();
        const bear = grant(state, UNPINNED_ID);
        expect(isRequiredAttacker(bear, state)).toBe(true);
        expect(pinnedAttackDefenderOf(bear, state)).toBeUndefined();
    });
});

// ── Declaration legality ───────────────────────────────────────────────────

describe("a planeswalker attack does not obey a pinned requirement (CR 508.1d)", () => {
    it("the confirm-time backstop refuses a pinned attacker sent at a walker", () => {
        const state = combatBoard();
        grant(state, opponentPinned.id);
        state.combat!.attackerIds = ["bear"];
        state.combat!.attackTargets = { bear: "walker" };
        expect(validateDeclaredAttackers(state)).toEqual({
            ok: false,
            reason: "Test Pinned Recipient must attack that player this combat if able",
        });
        state.combat!.attackTargets = undefined;
        expect(validateDeclaredAttackers(state)).toEqual({ ok: true });
    });

    it("an UNPINNED requirement is obeyed by a walker attack", () => {
        const state = combatBoard();
        grant(state, UNPINNED_ID);
        state.combat!.attackerIds = ["bear"];
        state.combat!.attackTargets = { bear: "walker" };
        expect(validateDeclaredAttackers(state)).toEqual({ ok: true });
    });

    it("the Bot's realised attack drops the pinned attacker's walker target", () => {
        const state = combatBoard();
        grant(state, opponentPinned.id);
        const move = {
            kind: "declare-attackers" as const,
            attackerIds: ["bear"],
            attackTargets: { bear: "walker" },
        };
        expect(declaredAttackTargets(state, "p1", move)).toBeUndefined();

        const free = combatBoard();
        grant(free, UNPINNED_ID);
        expect(declaredAttackTargets(free, "p1", move)).toEqual({
            bear: "walker",
        });
    });
});

// ── game.ts full path ───────────────────────────────────────────────────────

describe("declare-attackers mutations honour a pinned requirement (CR 508.1d)", () => {
    type ToggleArgs = {
        gameId: Id<"games">;
        playerId: string;
        cardInstanceId: string;
        planeswalkerId?: string;
    };
    type DeclareArgs = {
        gameId: Id<"games">;
        playerId: string;
        attackerIds: string[];
        attackTargets?: Record<string, string>;
    };

    it("toggleAttacker refuses to point a pinned creature at a walker", async () => {
        const state = combatBoard();
        grant(state, opponentPinned.id);
        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            runMutation<ToggleArgs, void>(
                toggleAttacker as unknown as Handler<ToggleArgs, void>,
                h.ctx,
                {
                    gameId: GAME_ID,
                    playerId: "p1",
                    cardInstanceId: "bear",
                    planeswalkerId: "walker",
                }
            )
        ).rejects.toThrow("must attack that player this combat if able");
        expect(h.state().combat!.attackerIds).toEqual([]);
    });

    it("declareAttackers keeps the pinned attacker and drops its walker target", async () => {
        const state = combatBoard();
        grant(state, opponentPinned.id);
        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation<DeclareArgs, unknown>(
            declareAttackers as unknown as Handler<DeclareArgs, unknown>,
            h.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                attackerIds: ["bear"],
                attackTargets: { bear: "walker" },
            }
        );
        expect(h.state().combat!.attackerIds).toEqual(["bear"]);
        expect(h.state().combat!.attackTargets).toBeUndefined();
    });
});

// ── Ursine Monstrosity ─────────────────────────────────────────────────────

describe("Ursine Monstrosity (CR 507 trigger; CR 701.17a mill; CR 508.1d pinned requirement)", () => {
    const ursine = getDefinition("73cc6df4-3564-4ace-bf8a-eac3e62d725a");
    const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

    function resolveCombatTrigger(): GameState {
        const monster = makeInstance(ursine.id, {
            id: "ursine",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            turn: 3,
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [monster],
                    // Graveyard: one instant. The mill adds a land — a second
                    // card type, counted because the mill resolves first.
                    graveyard: [makeInstance(BOLT_ID, { zone: "graveyard" })],
                    library: [makeInstance(FOREST_ID, { zone: "library" })],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        resolveTopOfStack(state);
        return state;
    }

    const ursineOf = (state: GameState) =>
        state.players[0].battlefield.find((c) => c.id === "ursine")!;

    it("mills, then pumps by the card types counted AFTER the mill, and gains indestructible", () => {
        const state = resolveCombatTrigger();
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
        const live = ursineOf(state);
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(5);
        expect(live.staticAbilities).toContain("indestructible");
    });

    it("must attack the opponent this combat, pinned to that player", () => {
        const state = resolveCombatTrigger();
        state.phase = "DECLARE_ATTACKERS";
        const live = ursineOf(state);
        expect(live.grantedAttackRequirements?.[0].duration?.phase).toBe(
            "end-of-combat"
        );
        expect(pinnedAttackDefenderOf(live, state)).toBe("p2");
        expect(isRequiredAttacker(live, state)).toBe(true);
    });

    it("the pump does not grow when a new card type reaches the graveyard later (CR 608.2h)", () => {
        const state = resolveCombatTrigger();
        state.players[0].graveyard.push(
            makeInstance(ursine.id, { zone: "graveyard" })
        );
        expect(getEffectivePower(state, ursineOf(state))).toBe(5);
    });
});
