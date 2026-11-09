// Issue #9002 (PRD issue #8998, ADR 0176) — `forceAdvanceOwedInput`, the last
// line of defence of the Bot liveness guarantee. Per Expected Input kind: the
// LEGAL rung closes the window; a legal rung made to throw falls to the FORCED
// DISCARD; nothing left to discard → the Bot CONCEDES (CR 104.3a). Whatever the
// fixture, the function never throws and its result is either a finished game
// or a Bot no longer owed on the container it was handed.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition } from "../../cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    computeExpectedInput,
    EXPECTED_INPUT_KINDS,
    type ExpectedInputKind,
} from "../expectedInput";
import {
    botOwedWindow,
    FORCE_ADVANCE_MAX_STEPS,
    forceAdvanceOwedInput,
    roundTripsThroughCompactState,
    type ForceAdvanceResult,
} from "../forceAdvance";
import { LEGAL_STEPS } from "../forceAdvanceLegal";
import {
    autoResolveFungible,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "../sacrificeChoice";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";

const LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // Savannah Lions — {W}
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains — {T}: add {W}
const BRAINSTORM = getDefinition("8d42d7aa-7f53-4cfc-842a-086aab2448d1").id;
const BEAR = grizzlyBears().id;

/** A fixture: the state, and the seat the Bot plays. */
type Fixture = { state: GameState; bot: string };

function bear(id: string, controllerId: string, extra = {}) {
    return makeInstance(BEAR, {
        id,
        controllerId,
        ownerId: controllerId,
        ...extra,
    });
}

/** p1 (the Bot) holds priority in a plain main phase. */
function priorityOwed(): Fixture {
    return { state: makeState({ priorityPlayerId: "p1" }), bot: "p1" };
}

/** p1 (the Bot) holds priority with a half-paid cast parked. */
function priorityWithParkedCast(): Fixture {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [makeInstance(LIONS, { id: "lions", zone: "hand" })],
                battlefield: [
                    makeInstance(PLAINS, { id: "plains", isTapped: true }),
                ],
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "lions",
            manaCost: { W: 1 },
            tappedLandIds: ["plains"],
        },
    });
    return { state, bot: "p1" };
}

/** p1 (the Bot, active) has an attack declaration open: a pass is illegal
 *  until it confirms (CR 508.1), and no ctx-free confirm core exists. */
function attackDeclarationOpen(): Fixture {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [bear("attacker", "p1")] }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["attacker"],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    return { state, bot: "p1" };
}

/** p1 attacks with a Bear; p2 (the Bot) has its Bear assigned to block. */
function blockersOwed(): Fixture {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [bear("attacker", "p1", { isAttacking: true })],
            }),
            makePlayer("p2", { battlefield: [bear("blocker", "p2")] }),
        ],
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["attacker"],
            confirmed: true,
            blockerAssignments: { blocker: ["attacker"] },
            blockersConfirmed: false,
        },
    });
    return { state, bot: "p2" };
}

/** p1 (the Bot) owes an attack mana tax, one Plains already tapped toward it. */
function attackManaTaxOwed(): Fixture {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(PLAINS, { id: "plains", isTapped: true }),
                    bear("attacker", "p1"),
                ],
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["attacker"],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            pendingAttackManaTax: {
                playerId: "p1",
                cost: { generic: 2 },
                reason: "attack tax",
                tappedLandIds: ["plains"],
            },
        },
    });
    return { state, bot: "p1" };
}

/** p1 (the Bot) owes the target of its own mandatory trigger. */
function triggerTargetOwed(): Fixture {
    const state = makeState({ priorityPlayerId: "p1" });
    state.stack.push({
        id: "trig",
        card: { id: "trigger-source" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        castById: "p1",
    } as unknown as StackItem);
    state.pendingTarget = {
        playerId: "p1",
        cardInstanceId: "trig",
        targetType: "any",
        count: 1,
        selected: [],
        kind: "trigger",
    } as GameState["pendingTarget"];
    return { state, bot: "p1" };
}

/** p1 (the Bot) resolved a real Brainstorm and owes its two put-backs. */
function choiceOwed(): Fixture {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: ["l1", "l2", "l3", "l4", "l5"].map((id) =>
                    makeInstance(BEAR, { id, zone: "library" })
                ),
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
    });
    const item = pushSpell(state, BRAINSTORM, "p1");
    item.id = "brainstorm";
    resolveTopOfStack(state);
    return { state, bot: "p1" };
}

/** p1 (the Bot) attacks into its own Flooded Woodlands and owes the land. */
function sacrificeOwed(): Fixture {
    const mountain = getCardByName("Mountain").id;
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    bear("g1", "p1", { isAttacking: true }),
                    makeInstance(mountain, {
                        id: "land-a",
                        controllerId: "p1",
                    }),
                    makeInstance(mountain, {
                        id: "land-b",
                        controllerId: "p1",
                        isTapped: true,
                    }),
                    makeInstance(getCardByName("Flooded Woodlands").id, {
                        id: "tax",
                        controllerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["g1"],
            blockerAssignments: {},
            confirmed: false,
            blockersConfirmed: false,
        },
    });
    const sel: SacrificeSelection = {
        playerId: "p1",
        reason: "Flooded Woodlands",
        requirements: [{ filter: { types: ["Land"] }, count: 1 }],
        picked: [],
    };
    autoResolveFungible(state, sel);
    state.combat!.pendingAttackSacrifice = sel;
    return { state, bot: "p1" };
}

/** One fixture per Expected Input kind — a `Record`, so a new kind reds `tsc`
 *  here until it has one. */
const FIXTURES: Record<ExpectedInputKind, () => Fixture> = {
    priority: priorityOwed,
    blockers: blockersOwed,
    "attack-mana-tax": attackManaTaxOwed,
    target: triggerTargetOwed,
    choice: choiceOwed,
    sacrifice: sacrificeOwed,
};

const throwing = () => {
    throw new Error("legal rung forced to throw");
};

/** Run with `kind`'s legal rung made to throw. */
function forcedThrow(kind: ExpectedInputKind, f: Fixture): ForceAdvanceResult {
    return forceAdvanceOwedInput(f.state, f.bot, {
        legalSteps: { [kind]: throwing },
    });
}

/** The property every result owes: the game is over, or the Bot is no longer
 *  owed on the container it was handed — and the state can be saved. */
function expectWindowClosed(f: Fixture, result: ForceAdvanceResult) {
    const origin = botOwedWindow(f.state, f.bot);
    expect(origin).not.toBeNull();
    if (!result.state.gameOver) {
        expect(botOwedWindow(result.state, f.bot)?.key).not.toBe(origin!.key);
    }
    expect(roundTripsThroughCompactState(result.state)).toBe(true);
}

describe("forceAdvanceOwedInput — fixtures cover every Expected Input kind", () => {
    it.each(EXPECTED_INPUT_KINDS)(
        "the %s fixture owes the Bot that kind, and a legal rung exists for it",
        (kind) => {
            const f = FIXTURES[kind]();
            expect(computeExpectedInput(f.state)?.kind).toBe(kind);
            expect(botOwedWindow(f.state, f.bot)?.input.kind).toBe(kind);
            expect(typeof LEGAL_STEPS[kind]).toBe("function");
        }
    );
});

describe("forceAdvanceOwedInput — the legal rung closes the window", () => {
    it.each(EXPECTED_INPUT_KINDS)(
        "%s: one legal step, outcome advanced",
        (kind) => {
            const f = FIXTURES[kind]();
            const result = forceAdvanceOwedInput(f.state, f.bot);

            expect(result.outcome).toBe("advanced");
            expect(result.steps).toHaveLength(1);
            expect(result.steps[0]).toMatchObject({
                kind,
                legal: true,
                discarded: false,
            });
            expectWindowClosed(f, result);
        }
    );

    it("priority: CR 117.3d — the Bot passes and the opponent receives priority", () => {
        const f = priorityOwed();
        const { state, steps } = forceAdvanceOwedInput(f.state, f.bot);
        expect(steps[0].action).toBe("pass");
        expect(state.priorityPlayerId).toBe("p2");
    });

    it("blockers: CR 509.1a — the Bot declares no blockers", () => {
        const f = blockersOwed();
        const { state } = forceAdvanceOwedInput(f.state, f.bot);
        expect(state.combat!.blockersConfirmed).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({});
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("attack-mana-tax: CR 508.1h — the unpaid tax reverses the declaration", () => {
        const f = attackManaTaxOwed();
        const { state } = forceAdvanceOwedInput(f.state, f.bot);
        expect(state.combat!.pendingAttackManaTax).toBeUndefined();
        expect(state.combat!.attackerIds).toEqual([]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "plains")!
                .isTapped
        ).toBe(false);
    });

    it("target: CR 603.3c — a declined mandatory trigger target removes the trigger", () => {
        const f = triggerTargetOwed();
        const { state } = forceAdvanceOwedInput(f.state, f.bot);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toEqual([]);
    });

    it("choice: CR 608.2 — the head choice gets a legal answer and the spell resolves", () => {
        const f = choiceOwed();
        const handBefore = f.state.players[0].hand.length;
        const { state } = forceAdvanceOwedInput(f.state, f.bot);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toEqual([]);
        // Brainstorm drew three, then put back two.
        expect(state.players[0].hand).toHaveLength(handBefore - 2);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "brainstorm"
        );
    });

    it("sacrifice: CR 701.21a — the first legal land is sacrificed and the attack finalizes", () => {
        const f = sacrificeOwed();
        expect(
            isSacrificeSelectionComplete(
                f.state.combat!.pendingAttackSacrifice!
            )
        ).toBe(false);
        const { state } = forceAdvanceOwedInput(f.state, f.bot);
        expect(state.combat!.pendingAttackSacrifice).toBeUndefined();
        expect(state.combat!.confirmed).toBe(true);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(
            state.players[0].battlefield.find((c) => c.id === "g1")!.isAttacking
        ).toBe(true);
    });
});

describe("forceAdvanceOwedInput — a throwing legal rung falls to the forced discard", () => {
    const DISCARDABLE: Record<ExpectedInputKind, () => Fixture> = {
        ...FIXTURES,
        priority: priorityWithParkedCast,
    };

    it.each(EXPECTED_INPUT_KINDS)(
        "%s: the legal step is logged as failed, the discard closes the window",
        (kind) => {
            const f = DISCARDABLE[kind]();
            const result = forcedThrow(kind, f);

            expect(result.outcome).toBe("discarded");
            expect(result.steps).toEqual([
                {
                    kind,
                    action: "legal-step",
                    legal: false,
                    discarded: false,
                    error: "legal rung forced to throw",
                },
                expect.objectContaining({
                    kind,
                    legal: false,
                    discarded: true,
                }),
            ]);
            expect(result.steps[1].error).toBeUndefined();
            expect(result.state.gameOver).toBeUndefined();
            expectWindowClosed(f, result);
        }
    );

    it("choice: the raising spell leaves the stack as if it fizzled (CR 608.2b's shape)", () => {
        const f = choiceOwed();
        const { state } = forcedThrow("choice", f);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toEqual([]);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "brainstorm"
        );
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("target: the trigger is removed", () => {
        const f = triggerTargetOwed();
        const { state } = forcedThrow("target", f);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toEqual([]);
    });

    it("blockers: the declaration closes with no blocker, requirements ignored", () => {
        const f = blockersOwed();
        const { state } = forcedThrow("blockers", f);
        expect(state.combat!.blockersConfirmed).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({});
        expect(state.priorityPlayerId).toBe("p1");
    });

    it.each(["sacrifice", "attack-mana-tax"] as const)(
        "%s: the cost is never paid and the attack is abandoned",
        (kind) => {
            const f = FIXTURES[kind]();
            const { state } = forcedThrow(kind, f);
            expect(state.combat!.pendingAttackSacrifice).toBeUndefined();
            expect(state.combat!.pendingAttackManaTax).toBeUndefined();
            expect(state.combat!.attackerIds).toEqual([]);
            expect(state.combat!.confirmed).toBe(true);
        }
    );

    it("priority: the parked cast is rewound — the card stays in hand", () => {
        const f = priorityWithParkedCast();
        const { state } = forcedThrow("priority", f);
        expect(state.pendingCast).toBeUndefined();
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lions"]);
    });

    it("priority: a pass the rules refuse (attack declaration open) needs no injected throw", () => {
        const f = attackDeclarationOpen();
        const result = forceAdvanceOwedInput(f.state, f.bot);
        expect(result.outcome).toBe("discarded");
        expect(result.steps[0]).toMatchObject({ action: "legal-step" });
        expect(result.steps[0].error).toMatch(/declare attackers/);
        expect(result.state.combat!.confirmed).toBe(true);
        expect(result.state.combat!.attackerIds).toEqual([]);
        expectWindowClosed(f, result);
    });
});

describe("forceAdvanceOwedInput — the Bot concedes when nothing else works (CR 104.3a)", () => {
    it("a priority window with nothing parked has no discard: bot-fault concede", () => {
        const f = priorityOwed();
        const result = forcedThrow("priority", f);

        expect(result.outcome).toBe("conceded");
        expect(result.state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "bot-fault",
        });
        expect(result.steps.at(-1)).toMatchObject({ action: "concede" });
        expect(result.steps.at(-2)).toMatchObject({
            discarded: true,
            error: "Nothing the Bot parked in this priority window",
        });
        expect(roundTripsThroughCompactState(result.state)).toBe(true);
    });

    it("a post-state that fails the compactState round-trip concedes from the INPUT", () => {
        const f = priorityOwed();
        const result = forceAdvanceOwedInput(f.state, f.bot, {
            legalSteps: {
                priority: (s) => {
                    s.priorityPlayerId = "p2";
                    (s as unknown as { poison: bigint }).poison = BigInt(1);
                    s.players[0].battlefield.push({
                        poison: BigInt(1),
                    } as never);
                    return "unsaveable";
                },
            },
        });

        expect(result.outcome).toBe("conceded");
        expect(result.steps.map((s) => s.action)).toEqual([
            "unsaveable",
            "round-trip",
            "concede",
        ]);
        expect(result.state.players[0].battlefield).toEqual([]);
        expect(result.state.gameOver?.reason).toBe("bot-fault");
    });

    it("a game already over, or a window owed by the opponent, is left alone", () => {
        const over = makeState({ priorityPlayerId: "p1" });
        over.gameOver = { winnerId: "p2", loserId: "p1", reason: "life" };
        expect(forceAdvanceOwedInput(over, "p1")).toEqual({
            state: over,
            steps: [],
            outcome: "advanced",
        });

        const theirs = makeState({ priorityPlayerId: "p2" });
        expect(forceAdvanceOwedInput(theirs, "p1").steps).toEqual([]);
    });
});

describe("forceAdvanceOwedInput — never throws, never mutates its input", () => {
    it.each(EXPECTED_INPUT_KINDS)(
        "%s: the input state is untouched",
        (kind) => {
            const f = FIXTURES[kind]();
            const before = structuredClone(f.state);
            forceAdvanceOwedInput(f.state, f.bot);
            forcedThrow(kind, f);
            expect(f.state).toEqual(before);
        }
    );

    it("a state too corrupt to read concedes instead of throwing", () => {
        const corrupt = {
            priorityPlayerId: "p1",
            players: null,
            stack: 7,
        } as unknown as GameState;
        const result = forceAdvanceOwedInput(corrupt, "p1");
        expect(result.outcome).toBe("conceded");
        expect(result.state.gameOver?.reason).toBe("bot-fault");
    });

    it("fuzz: every fixture with a field corrupted either closes its window or concedes", () => {
        // Deterministic corruption table: each top-level field of each fixture
        // replaced by a value of the wrong shape.
        const garbage: unknown[] = [undefined, null, 0, "x", [], {}, [{}]];
        let runs = 0;
        for (const kind of EXPECTED_INPUT_KINDS) {
            const keys = Object.keys(FIXTURES[kind]().state);
            for (const key of keys) {
                for (const value of garbage) {
                    const f = FIXTURES[kind]();
                    (f.state as unknown as Record<string, unknown>)[key] =
                        value;
                    let result: ForceAdvanceResult | undefined;
                    expect(() => {
                        result = forceAdvanceOwedInput(f.state, f.bot);
                    }).not.toThrow();
                    runs++;
                    expect(result!.steps.length).toBeLessThanOrEqual(
                        2 * FORCE_ADVANCE_MAX_STEPS + 2
                    );
                    if (result!.outcome === "conceded") {
                        expect(result!.state.gameOver).toBeDefined();
                    } else if (!result!.state.gameOver) {
                        let origin;
                        try {
                            origin = botOwedWindow(f.state, f.bot);
                        } catch {
                            origin = undefined;
                        }
                        if (origin) {
                            expect(
                                botOwedWindow(result!.state, f.bot)?.key
                            ).not.toBe(origin.key);
                        }
                    }
                }
            }
        }
        expect(runs).toBeGreaterThan(100);
    });
});
