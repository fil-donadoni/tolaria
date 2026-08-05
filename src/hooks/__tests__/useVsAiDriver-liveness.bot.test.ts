// The bot liveness invariant (issue #2284): **if the engine's Expected Input
// (ADR 0047) names the bot as the player being waited on, the game state
// advances within a bounded time.**
//
// Every test here drives the REAL `useVsAiDriver` over a REAL projected
// `GameState`, with the bot's decision function `decideBotAction` STUBBED to
// answer "nothing owed" — the exact shape of every past freeze. A hand-built
// view or a hand-built tick would mask the thing under test (the tick is derived
// from the engine's own `computeOwedPlayerIds` / `computeExpectedInput`, as in
// `useVsAiDriver.bot.test.ts`), so nothing here is hand-built except the boards.
//
// The stub is the point: it is not a hypothetical. "The bot's decision gate
// returns 'owes nothing' for any waiting state it does not recognise" is the
// bug, and the invariant must hold *without* the gate's cooperation.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    renderHook,
    render,
    act,
    screen,
    fireEvent,
} from "@testing-library/react";
import { createElement } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import {
    computeExpectedInput,
    computeOwedPlayerIds,
    EXPECTED_INPUT_KINDS,
    refreshExpectedInput,
    type ExpectedInputKind,
} from "@convex/gre/expectedInput";
import type { GameState, StackItem } from "@convex/gre/state";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const GAME = "game1" as Id<"games">;
const BEAR = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;
const FOREST = getCardByName("Forest").id;

const calls: { ref: unknown; args: unknown }[] = [];
let currentState: unknown = undefined;
/** When set, EVERY mutation rejects — the thrown-submission fixture. */
let mutationsThrow = false;

vi.mock("@convex/_generated/api", () => {
    // Every mutation/query the driver reaches for, tagged by a plain string so
    // assertions never touch Convex's FunctionReference proxies. A missing key
    // would silently become `undefined` and swallow the call, so this is
    // deliberately the full surface.
    const names = [
        "getPublicState",
        "getGameTick",
        "getGame",
        "playCard",
        "summonCompanion",
        "announceCast",
        "selectTarget",
        "selectTargets",
        "confirmTargets",
        "tapForPayment",
        "activateAbility",
        "tapForActivationPayment",
        "selectSacrifice",
        "selectActivationCost",
        "selectActivationExileCost",
        "selectActivationDiscardCost",
        "toggleAttacker",
        "confirmAttackers",
        "selectBlocker",
        "assignBlockerTarget",
        "confirmBlockers",
        "confirmDamage",
        "declareMulligan",
        "submitResolutionChoice",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
        "submitMadnessDecline",
        "submitReboundDecline",
        "submitNameCard",
        "submitRandomRevealAck",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "resolveManaSpendChoice",
        "selectCastExileCost",
        "selectConvokeCreatures",
        "selectAdditionalCost",
        "selectCastAlternativeHandCost",
        "cancelTarget",
        "cancelCast",
        "cancelActivation",
        "passPriority",
    ];
    return {
        api: {
            game: Object.fromEntries(names.map((n) => [n, n])),
        },
    };
});

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        if (ref === "getGame") return undefined;
        if (ref === "getGameTick") {
            if (currentState === undefined) return undefined;
            const s = currentState as {
                seq: number;
                priorityPlayerId: string;
                phase: string;
                gameOver?: boolean;
            };
            // The REAL derivation, exactly as `saveGameTick` computes it.
            return {
                seq: s.seq,
                priorityPlayerId: s.priorityPlayerId,
                phase: s.phase,
                expectedInputKind: computeExpectedInput(s as never)?.kind,
                owedPlayerIds: computeOwedPlayerIds(s as never),
                gameOver: !!s.gameOver,
            };
        }
        return currentState;
    },
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return mutationsThrow
            ? Promise.reject(new Error("server rejected"))
            : Promise.resolve(null);
    },
}));

// The stub. `importOriginal` keeps every OTHER export real — the escalation
// ladder is built from `chooseOwedChoiceAction` / `chooseOwedTargetAction` /
// `decidePriorityAction`, and stubbing those too would be testing nothing.
let stubDecideNone = true;
vi.mock("~/lib/ai/brain", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/brain")>();
    return {
        ...actual,
        decideBotAction: (
            view: Parameters<typeof actual.decideBotAction>[0]
        ) =>
            stubDecideNone
                ? ({ kind: "none" } as const)
                : actual.decideBotAction(view),
    };
});

const { useVsAiDriver, BOT_WATCHDOG_MS, BOT_SUBMIT_RETRY_LIMIT } =
    await import("../useVsAiDriver");
const { getAiEscalations, clearAiEscalations } =
    await import("~/lib/ai/trace-store");
// The real mount point, so the rung-5 test exercises the actual UI seam
// (`VsAiDriver` → `BotStuckNotice` → `resolveStuck`) rather than a stand-in.
const VsAiDriver = (await import("~/components/board/vs-ai-driver")).default;

// ── Boards, one per Expected Input kind ─────────────────────────────────────

function bear(id: string, controllerId: string) {
    return makeInstance(BEAR, { id, controllerId, ownerId: controllerId });
}

/** `priority` (CR 117) — the plain window: the bot simply holds priority. */
function priorityBoard(): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** `choice` (CR 608.2) — a mid-resolution optional payment owed to the bot. */
function choiceBoard(): GameState {
    const state = priorityBoard();
    state.pendingChoices = [
        {
            playerId: BOT,
            stackItemId: "s1",
            choiceId: "c1",
            kind: "may-pay",
            prompt: "Pay {2}?",
            cost: { generic: 2 },
            candidates: [],
            count: 0,
        } as never,
    ];
    return state;
}

/** `target` (CR 603.3d) — an ENGINE-RAISED targeted trigger the bot controls,
 *  with two legal creatures so the single-legal-target auto-select never fires. */
function targetBoard(): GameState {
    const source = makeInstance(BEAR, {
        id: "src",
        controllerId: BOT,
        ownerId: BOT,
        types: ["Enchantment"],
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN, {
                battlefield: [
                    bear("bear", HUMAN),
                    makeInstance(WURM, {
                        id: "wurm",
                        controllerId: HUMAN,
                        ownerId: HUMAN,
                    }),
                ],
            }),
            makePlayer(BOT, { battlefield: [source] }),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: BOT,
    });
    const trigger: StackItem = {
        ...makeInstance(BEAR, { id: "trig", controllerId: BOT, ownerId: BOT }),
        castById: BOT,
        targets: [],
        isTriggeredAbility: true,
        sourceInstanceId: source.id,
    } as StackItem;
    state.stack.push(trigger);
    state.pendingTarget = {
        playerId: BOT,
        cardInstanceId: trigger.id,
        kind: "trigger",
        targetType: "Creature",
        count: 1,
        selected: [],
    };
    return state;
}

/** `blockers` (CR 509.1) — the human attacks, the bot must declare blocks. */
function blockersBoard(): GameState {
    const attacker = bear("atk", HUMAN);
    const state = makeState({
        players: [
            makePlayer(HUMAN, { battlefield: [attacker] }),
            makePlayer(BOT, { battlefield: [bear("blk", BOT)] }),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
        phase: "DECLARE_BLOCKERS",
    });
    state.combat = {
        attackerIds: [attacker.id],
        blockers: {},
        confirmed: true,
        blockersConfirmed: false,
        damageAssignment: {},
    } as never;
    return state;
}

/** `sacrifice` (CR 508.1g / 701.21a) — the attack-declaration land tax parked on
 *  the bot: it declared an attack and owes a land sacrifice to legalize it. */
function sacrificeBoard(): GameState {
    const attacker = bear("atk", BOT);
    const land = makeInstance(FOREST, {
        id: "forest",
        controllerId: BOT,
        ownerId: BOT,
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, { battlefield: [attacker, land] }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "DECLARE_ATTACKERS",
    });
    state.combat = {
        attackerIds: [attacker.id],
        blockers: {},
        confirmed: false,
        blockersConfirmed: false,
        damageAssignment: {},
        pendingAttackSacrifice: {
            playerId: BOT,
            reason: "Flooded Woodlands",
            requirements: [{ filter: { types: ["Land"] }, count: 1 }],
            picked: [],
        },
    } as never;
    return state;
}

/** `attack-mana-tax` (CR 508.1c) — the parked per-attacker mana tax. */
function attackManaTaxBoard(): GameState {
    const attacker = bear("atk", BOT);
    const state = makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, { battlefield: [attacker] }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "DECLARE_ATTACKERS",
    });
    state.combat = {
        attackerIds: [attacker.id],
        blockers: {},
        confirmed: false,
        blockersConfirmed: false,
        damageAssignment: {},
        pendingAttackManaTax: {
            playerId: BOT,
            cost: { generic: 2 },
            tappedLandIds: [],
        },
    } as never;
    return state;
}

/** Every Expected Input kind the bot can be waited on for, with the board that
 *  produces it. The `satisfies Record<…>` is the runtime half of the
 *  compile-time exhaustiveness witness: a new kind on the engine's union cannot
 *  be added without a board here, so it cannot go untested. */
const BOARDS = {
    choice: choiceBoard,
    target: targetBoard,
    blockers: blockersBoard,
    sacrifice: sacrificeBoard,
    "attack-mana-tax": attackManaTaxBoard,
    priority: priorityBoard,
} satisfies Record<ExpectedInputKind, () => GameState>;

/** Publish a board as the "server" state: refresh the authoritative
 *  `expectedInput`, project it to the bot's own viewpoint. */
function publish(state: GameState) {
    refreshExpectedInput(state);
    currentState = projectPublicState(state, 1, BOT);
    return computeExpectedInput(state);
}

beforeEach(() => {
    calls.length = 0;
    currentState = undefined;
    mutationsThrow = false;
    stubDecideNone = true;
    clearAiEscalations();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("bot liveness invariant (issue #2284)", () => {
    it("the fixture covers EVERY Expected Input kind", () => {
        // Names every kind explicitly, so the list is auditable in review and
        // not merely implied by a type. Pairs with the `satisfies` on `BOARDS`
        // and the `Exclude`-to-never witness in `owed-input.ts`.
        expect(Object.keys(BOARDS).sort()).toEqual(
            [...EXPECTED_INPUT_KINDS].sort()
        );
        expect([...EXPECTED_INPUT_KINDS].sort()).toEqual([
            "attack-mana-tax",
            "blockers",
            "choice",
            "priority",
            "sacrifice",
            "target",
        ]);
    });

    for (const kind of EXPECTED_INPUT_KINDS) {
        it(`advances a "${kind}" window even when the bot answers "nothing owed"`, async () => {
            const state = BOARDS[kind]();
            const expected = publish(state);
            // The board really does rest on the kind under test, and really
            // does name the bot — otherwise the test proves nothing.
            expect(expected?.kind).toBe(kind);
            expect(computeOwedPlayerIds(state)).toContain(BOT);

            renderHook(() => useVsAiDriver(GAME, BOT));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(BOT_WATCHDOG_MS + 100);
            });

            // A legal submission reached the server within the watchdog
            // interval — the game moved.
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0].args).toMatchObject({
                gameId: GAME,
                playerId: BOT,
            });
        });
    }

    it("stays silent when the game is NOT waiting on the bot", () => {
        // The mirror image, and the reason the watchdog can't just fire on a
        // timer: an idle bot is correct, and escalating it would be a bug.
        const state = priorityBoard();
        state.priorityPlayerId = HUMAN;
        publish(state);
        expect(computeOwedPlayerIds(state)).not.toContain(BOT);

        renderHook(() => useVsAiDriver(GAME, BOT));
        vi.advanceTimersByTime(BOT_WATCHDOG_MS * 3);
        expect(calls).toHaveLength(0);
    });

    it("never escalates a slow search at the HARDEST budget", async () => {
        // `DIFFICULTY_BUDGETS.hard` is `{ iterations: 1200, timeMs: 600 }`; with
        // `THINK_DELAY_MS` and a Worker round-trip on top, a legitimate think is
        // an order of magnitude inside the watchdog interval. Asserted against
        // the real constant so tightening one without the other fails here.
        const { DIFFICULTY_BUDGETS } = await import("@convex/gre/difficulty");
        const hardest = Math.max(
            ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.timeMs ?? 0)
        );
        expect(BOT_WATCHDOG_MS).toBeGreaterThan(hardest * 5);

        // And end-to-end: with the real gate, a plain priority window is
        // answered by the bot's OWN decision well before the watchdog, and the
        // watchdog then never fires (exactly one submission, not two).
        stubDecideNone = false;
        publish(priorityBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BOT_WATCHDOG_MS * 2);
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    it("escalates IMMEDIATELY on a 'nothing owed' decision, not after the full interval", async () => {
        // "Nothing owed" while the Expected Input names the bot is a defect,
        // not a slow think: waiting the full interval on a decision that is
        // already KNOWN to be missing is dead time in the human's game.
        publish(priorityBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    it("records every escalation past rung 1 in the AI decision trace", async () => {
        clearAiEscalations();
        publish(targetBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BOT_WATCHDOG_MS + 100);
        });

        const records = getAiEscalations();
        expect(records.length).toBeGreaterThan(0);
        // The Expected Input kind that caused it is the load-bearing field —
        // it names the window nobody wired.
        expect(records[0].expectedKind).toBe("target");
        expect(records[0].rung).toBeGreaterThanOrEqual(2);
        expect(records[0].action).toBe("submit-target");
    });

    it("retries a THROWING submission and then escalates, never latching", async () => {
        // A rejected mutation changes no state, so no new tick arrives — the
        // driver used to go permanently quiet here (it cleared its signature and
        // nothing ever re-drove it).
        stubDecideNone = false;
        mutationsThrow = true;
        publish(priorityBoard());

        renderHook(() => useVsAiDriver(GAME, BOT));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(BOT_WATCHDOG_MS * 2);
        });

        // The first attempt, plus the retries, plus at least one escalation
        // rung — and crucially MORE than one call: the pre-#2284 driver made
        // exactly one and then went silent forever.
        expect(calls.length).toBeGreaterThan(1);
        expect(calls.length).toBeGreaterThanOrEqual(BOT_SUBMIT_RETRY_LIMIT);
        expect(calls.every((c) => c.ref === "passPriority")).toBe(true);
    });

    it("rung 5 hands the player a control that advances the game (end-to-end)", async () => {
        // Every rung's mutation is rejected, so the automatic walk exhausts the
        // ladder and lands on rung 5 — the user-visible, actionable state. The
        // whole point of rung 5 is that it is NEVER a dead end.
        mutationsThrow = true;
        publish(targetBoard());
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        // One `act` round per rung: a rejected submission re-arms the watchdog
        // from a microtask at the END of the previous round, so a single long
        // advance would leave the freshly-scheduled timer unfired.
        for (let round = 0; round < 6; round++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(BOT_WATCHDOG_MS + 100);
            });
        }

        // `getBy*`, not `findBy*`: the async queries poll on real timers, which
        // never advance under `vi.useFakeTimers()`.
        const notice = screen.getByRole("alert");
        expect(notice.textContent).toContain("The AI could not act");
        const button = screen.getByRole("button", { name: /continue game/i });

        // The server recovers; the player clicks. UI action → mutation.
        mutationsThrow = false;
        calls.length = 0;
        await act(async () => {
            fireEvent.click(button);
            await vi.advanceTimersByTimeAsync(50);
        });

        // A LEGAL engine path: the raised target's minimal-legal submission,
        // through the same `selectTargets` a human's clicks make (CR 603.3d) —
        // not an invented skip, and not a state write outside the mutations.
        expect(calls.map((c) => c.ref)).toContain("selectTargets");
        expect(calls[0].args).toMatchObject({ gameId: GAME, playerId: BOT });
        // And the banner clears once the game has moved.
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
