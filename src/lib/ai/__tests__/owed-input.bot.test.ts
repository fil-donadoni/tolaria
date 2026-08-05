// The bot's consumption of the engine's Expected Input authority, and the
// escalation ladder built on it (issue #2284).
//
// Two things are under test and they are different:
//
//  1. **Owed-ness is the ENGINE's answer.** `owedInputFor` calls
//     `computeOwedPlayerIds` + `computeExpectedInput` (ADR 0047) and adds
//     nothing. The discriminating case is the CR 510.1c combat-damage
//     sub-flow, where `expectedInput.playerId` is NOT the acting player — a
//     naive `expectedInput.playerId === botId` check drops it, which is
//     precisely how the bot deadlocked before #1778.
//  2. **Every ladder rung is legal and realisable.** A rung that cannot be
//     dispatched is not an escalation, it is a slower freeze.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    EXPECTED_INPUT_KINDS,
    refreshExpectedInput,
    type ExpectedInputKind,
} from "@convex/gre/expectedInput";
import type { GameState } from "@convex/gre/state";
import {
    ESCALATION_POLICY,
    escalationLadder,
    owedInputFor,
} from "../owed-input";
import { botActionRealisation, type BotAction, type BotView } from "../brain";
import { submitDeclineAction, type DeclineMutations } from "../decline";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const BEAR = getCardByName("Grizzly Bears").id;

function baseState(): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
    });
}

function view(overrides: Partial<BotView> = {}): BotView {
    return {
        botId: BOT,
        phase: "PRECOMBAT_MAIN",
        priorityPlayerId: BOT,
        activePlayerId: BOT,
        hasCombat: false,
        attackersConfirmed: false,
        blockersConfirmed: false,
        ...overrides,
    };
}

describe("owedInputFor — the engine's answer, consumed (ADR 0047)", () => {
    it("returns nothing when the game is not waiting on this seat", () => {
        const state = baseState();
        refreshExpectedInput(state);
        expect(owedInputFor(state, BOT)).toBeUndefined();
        expect(owedInputFor(state, HUMAN)).toEqual({
            kind: "priority",
            playerId: HUMAN,
        });
    });

    it("returns nothing once the game is over (CR 104)", () => {
        const state = baseState();
        state.priorityPlayerId = BOT;
        state.gameOver = { winnerId: HUMAN, loserId: BOT, reason: "life" };
        refreshExpectedInput(state);
        expect(owedInputFor(state, BOT)).toBeUndefined();
    });

    it("names the bot in the combat-damage sub-flow where expectedInput.playerId does NOT (CR 510.1c)", () => {
        // The producer row a `expectedInput.playerId === botId` check gets
        // wrong: the damage-assignment sub-flow folds into a `priority` window
        // whose `playerId` is the ACTIVE player, while the real actor lives in
        // `combat.damageAssignerIds` (banding, CR 702.21j-k, can even split it
        // across both players).
        const attacker = makeInstance(BEAR, {
            id: "atk",
            controllerId: HUMAN,
            ownerId: HUMAN,
        });
        const state = makeState({
            players: [
                makePlayer(HUMAN, { battlefield: [attacker] }),
                makePlayer(BOT),
            ],
            activePlayerId: HUMAN,
            priorityPlayerId: HUMAN,
            phase: "COMBAT_DAMAGE",
        });
        state.combat = {
            attackerIds: [attacker.id],
            blockers: {},
            confirmed: true,
            blockersConfirmed: true,
            damageAssignment: {},
            damageConfirmed: false,
            damageAssignerIds: { [attacker.id]: BOT },
        } as never;
        refreshExpectedInput(state);

        const owed = owedInputFor(state, BOT);
        expect(owed).toBeDefined();
        expect(owed!.kind).toBe("priority");
        // The engine's Expected Input names the HUMAN, yet the bot is owed —
        // membership, never equality.
        expect(owed!.playerId).toBe(HUMAN);
    });
});

describe("ESCALATION_POLICY — exhaustive over the Expected Input union", () => {
    it("classifies EVERY kind, named explicitly", () => {
        // The runtime half of the compile-time `Exclude`-to-never witness in
        // `owed-input.ts`. Naming the kinds here (rather than deriving them)
        // is deliberate: a reviewer can see the whole waiting-state surface.
        expect(Object.keys(ESCALATION_POLICY).sort()).toEqual([
            "attack-mana-tax",
            "blockers",
            "choice",
            "priority",
            "sacrifice",
            "target",
        ]);
        expect(Object.keys(ESCALATION_POLICY).sort()).toEqual(
            [...EXPECTED_INPUT_KINDS].sort()
        );
    });

    it("allows a bare priority pass ONLY in a priority window", () => {
        // CR 117.3 — every other kind is a turn-based action or a suspended
        // resolution, where the Expected Input gate rejects `passPriority`.
        for (const kind of EXPECTED_INPUT_KINDS) {
            expect(ESCALATION_POLICY[kind].canPass).toBe(kind === "priority");
        }
    });
});

describe("escalationLadder — every rung is realisable and never a search", () => {
    /** The richest view each kind can present, so the ladder produces its
     *  fullest set of rungs. */
    const VIEWS: Record<ExpectedInputKind, BotView> = {
        choice: view({
            owedChoice: {
                kind: "may-pay",
                min: 0,
                max: 0,
                candidates: [],
                affordable: false,
            },
        }),
        target: view({
            owedTarget: {
                kind: "trigger",
                submission: {
                    targets: [{ type: "permanent", id: "x" }],
                    confirmTargets: true,
                },
            },
        }),
        blockers: view({
            phase: "DECLARE_BLOCKERS",
            hasCombat: true,
            activePlayerId: HUMAN,
        }),
        sacrifice: view({ attackSacrifice: { cardInstanceIds: ["l1"] } }),
        "attack-mana-tax": view({
            attackManaTaxOwed: true,
            attackManaTaxAffordable: true,
        }),
        priority: view({ parkedAnnouncement: "cast" }),
    };

    for (const kind of EXPECTED_INPUT_KINDS) {
        it(`"${kind}" yields at least one rung, and no rung hands the window back to the search`, () => {
            const ladder = escalationLadder(kind, VIEWS[kind]);
            expect(ladder.length).toBeGreaterThan(0);
            for (const step of ladder) {
                const realisation = botActionRealisation(step.action.kind);
                // The ladder only runs because the search already had nothing
                // to say, so no rung may hand the window BACK to the search.
                // `pass` is the one exception and only because
                // `realiseBotAction` submits it directly through
                // `passPriority` — every other `worker` kind would be a no-op
                // dressed as progress.
                if (realisation === "worker") {
                    expect(step.action.kind).toBe("pass");
                }
                expect(realisation).not.toBe("none");
                expect(realisation).not.toBe("unanswered");
                expect(step.rung).toBeGreaterThanOrEqual(2);
            }
            // Rungs are walked in order.
            const rungs = ladder.map((s) => s.rung);
            expect([...rungs].sort()).toEqual(rungs);
        });
    }

    it("ends a priority window with the CR 117 pass, after the announcement rewind", () => {
        const ladder = escalationLadder("priority", VIEWS.priority);
        const kinds = ladder.map((s) => s.action.kind);
        expect(kinds).toContain("abort-announcement");
        expect(kinds[kinds.length - 1]).toBe("pass");
    });

    it("degrades a combat DECLARATION to its empty form rather than re-searching", () => {
        // CR 508.1 / 509.1 — declaring no attackers / no blockers is always
        // legal, and is what `declare-attackers` / `declare-blockers` (real
        // search decisions) become once the search has already failed.
        const attackers = escalationLadder(
            "priority",
            view({
                phase: "DECLARE_ATTACKERS",
                hasCombat: true,
                attackersConfirmed: false,
            })
        );
        expect(attackers[0].action.kind).toBe("confirm-no-attackers");
        const blockers = escalationLadder("blockers", VIEWS.blockers);
        expect(blockers[0].action.kind).toBe("confirm-no-blockers");
    });

    it("offers the CR 608.2b target decline when there is no minimal-legal answer", () => {
        // An ANNOUNCED selection (the bot's own half-built cast) surfaces no
        // `owedTarget`, so rung 2 is empty and the ladder goes straight to the
        // engine's own abort path.
        const ladder = escalationLadder("target", view());
        expect(ladder.map((s) => s.action.kind)).toEqual(["cancel-target"]);
        expect(ladder[0].rung).toBe(3);
    });

    it("skips the announcement rewind when nothing is parked", () => {
        const ladder = escalationLadder("priority", view());
        expect(ladder.map((s) => s.action.kind)).toEqual(["pass"]);
    });
});

describe("submitDeclineAction — every rung reaches a real mutation", () => {
    function spyMutations(calls: string[]): DeclineMutations {
        const rec =
            (name: string) =>
            async (args: Record<string, unknown>): Promise<unknown> => {
                calls.push(
                    args.cardInstanceId
                        ? `${name}:${args.cardInstanceId}`
                        : name
                );
                return null;
            };
        return {
            cancelTarget: rec("cancelTarget"),
            confirmBlockers: rec("confirmBlockers"),
            confirmAttackers: rec("confirmAttackers"),
            cancelCast: rec("cancelCast"),
            cancelActivation: rec("cancelActivation"),
            selectSacrifice: rec("selectSacrifice"),
        } as DeclineMutations;
    }

    const CASES: [BotAction, string[]][] = [
        [{ kind: "cancel-target" }, ["cancelTarget"]],
        [{ kind: "confirm-no-blockers" }, ["confirmBlockers"]],
        [{ kind: "confirm-no-attackers" }, ["confirmAttackers"]],
        [{ kind: "abort-announcement", container: "cast" }, ["cancelCast"]],
        [
            { kind: "abort-announcement", container: "activation" },
            ["cancelActivation"],
        ],
        [
            { kind: "select-sacrifice", cardInstanceIds: ["a", "b"] },
            ["selectSacrifice:a", "selectSacrifice:b"],
        ],
    ];

    for (const [action, expected] of CASES) {
        it(`"${action.kind}" (${expected[0]})`, async () => {
            expect(botActionRealisation(action.kind)).toBe("decline");
            const calls: string[] = [];
            await submitDeclineAction(
                action as Parameters<typeof submitDeclineAction>[0],
                { gameId: "g" as never, playerId: BOT },
                spyMutations(calls)
            );
            expect(calls).toEqual(expected);
        });
    }
});
