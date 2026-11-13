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
import { renderHook, render, act, screen } from "@testing-library/react";
import { createElement } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
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
/** When set, an ACCEPTED mutation advances the published board — the real
 *  server writes a new seq, and the watchdog keys on that state version. */
let onMutation: ((ref: unknown) => void) | undefined;
/** Rung 5's hand-off (issue #9003), answered apart from `mutationsThrow`: the
 *  fixtures that reject every ladder rung must still reach the server. The
 *  default is the server's answer for a window it advanced. */
let reportStallImpl: (args: unknown) => Promise<unknown> = () =>
    Promise.resolve({ advanced: true, outcome: "advanced" });
/** Issue #9502 — the failed-consult report, answered apart from
 *  `mutationsThrow` like `reportStall`. The default is the server's `null`. */
let reportConsultFailureImpl: (args: unknown) => Promise<unknown> = () =>
    Promise.resolve(null);

vi.mock("@convex/_generated/api", () => {
    // Every mutation/query the driver reaches for, tagged by a plain string so
    // assertions never touch Convex's FunctionReference proxies. A missing key
    // would silently become `undefined` and swallow the call, so this is
    // deliberately the full surface.
    const names = [
        "getPublicState",
        "playCard",
        "summonCompanion",
        "announceCast",
        "selectTarget",
        "selectTargets",
        "confirmTargets",
        "tapForPayment",
        "activateManaAbility",
        "activateAbility",
        "tapForActivationPayment",
        "selectSacrifice",
        "selectActivationCost",
        "selectActivationExileCost",
        "selectActivationDiscardCost",
        "declineGenericSubstitution",
        "declareAttackers",
        "confirmAttackers",
        "declareBlockers",
        "confirmBlockers",
        "confirmDamage",
        "declareMulligan",
        "submitResolutionChoice",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
        "submitMiracleReveal",
        "submitMadnessDecline",
        "submitReboundDecline",
        "submitNameCard",
        "submitNumberChoice",
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
            botLiveness: {
                reportStall: "reportStall",
                reportConsultFailure: "reportConsultFailure",
            },
            gameReads: Object.fromEntries(
                [
                    "getGameTick",
                    "getGame",
                    "getSeatDeck",
                    "getSeatDeckKnowledge",
                    "getDefinitionManifest",
                    "getMatchBotDifficulty",
                ].map((n) => [n, n])
            ),
        },
        // Reached by the REAL `reportStall` handler the full-path test drives
        // (it schedules the system report's filing).
        internal: {
            bugReports: { fileSystemReportIssue: "fileSystemReportIssue" },
        },
    };
});

vi.mock("convex/react", async () => {
    // `useResilientQuery` (issue #3266) subscribes through `useQueries`, so the
    // mock answers both entry points from the one resolver below.
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    const resolve = (ref: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        // The decklist reads (`getSeatDeckKnowledge`, issue #5617; the legacy
        // `getSeatDeck`, issue #2506) stay unanswered here ON PURPOSE: this
        // suite's subject is the escalation ladder, and deck knowledge only
        // changes what the search sees inside a library, never whether the
        // driver escalates. The #1509 wiring it stubs away has its own
        // coverage in `useVsAiDriver.bot.test.ts` ("feeds the bot's own
        // decklist…" / "falls back to a placeholder library"), which is where
        // a widened stub would otherwise have left it unproven.
        if (
            ref === "getGame" ||
            ref === "getSeatDeck" ||
            ref === "getSeatDeckKnowledge" ||
            ref === "getDefinitionManifest"
        )
            return undefined;
        // Issue #6916: a lobby Match carries no difficulty of its own.
        if (ref === "getMatchBotDifficulty") return null;
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
    };
    const useMutation = (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        if (ref === "reportStall") return reportStallImpl(args);
        if (ref === "reportConsultFailure")
            return reportConsultFailureImpl(args);
        if (mutationsThrow) return Promise.reject(new Error("server rejected"));
        // A hook for the fixtures that need an ACCEPTED mutation to actually
        // move the board — the real server writes a new seq, and the watchdog
        // keys on that state version.
        onMutation?.(ref);
        return Promise.resolve(null);
    };
    return {
        useQuery: resolve,
        useQueries: mockUseQueries(resolve),
        useMutation,
    };
});

// The Brain Worker, stubbed. `brainResult` is what a consult resolves with;
// `{ move: null }` is NOT hypothetical — `brain-client.ts`'s `worker.onerror`
// resolves EVERY in-flight consult with exactly that, and a search over a
// window with no enumerated move does the same. That is the shape that used to
// latch the driver: the runner resolves having sent no mutation at all.
let brainResult: {
    move: unknown;
    trace: unknown;
    outcome?: string;
    via?: string;
    message?: string;
} = {
    move: null,
    trace: null,
    // The real contract since issue #2470 — a consult always says HOW it
    // ended, and the driver records that verdict. A stub that omitted it would
    // file every record under `outcome: undefined`.
    outcome: "no-move",
    via: "worker",
};
/** Hold the consult UNRESOLVED so a test can advance the board while the search
 *  is still running — the only way to tell the version a verdict is filed under
 *  apart from the latest one. */
let deferConsult = false;
let releaseConsult: ((result: unknown) => void) | undefined;
vi.mock("~/lib/ai/brain-client", () => ({
    consultBrain: () =>
        deferConsult
            ? new Promise((resolve) => {
                  releaseConsult = resolve;
              })
            : Promise.resolve(brainResult),
    disposeBrain: () => {},
    // Spawns the Worker early so its catalogue fetch is not charged to the
    // first consult (issue #3053); a no-op here, where consults are stubbed.
    warmBrain: () => {},
}));

// The stub. `importOriginal` keeps every OTHER export real — the escalation
// ladder is built from `chooseOwedChoiceAction` / `chooseOwedTargetAction` /
// `decidePriorityAction`, and stubbing those too would be testing nothing.
let stubDecideNone = true;
/** Force the "the engine says the bot owes input and the Brain has no answer
 *  for that window" decision (ADR 0047's `unanswered`) — a DEFECT the driver
 *  escalates immediately, and a decision exit that must not be described by
 *  silence. */
let stubDecideUnanswered = false;
/** Issue #8999 — the decision function THROWS (an engine bug reached through
 *  the bot's own view), the shape that used to unmount the board. */
let stubDecideThrows = false;
vi.mock("~/lib/ai/brain", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/brain")>();
    return {
        ...actual,
        decideBotAction: (
            view: Parameters<typeof actual.decideBotAction>[0]
        ) => {
            if (stubDecideThrows) throw new Error("decide exploded");
            return stubDecideUnanswered
                ? ({ kind: "unanswered" } as const)
                : stubDecideNone
                  ? ({ kind: "none" } as const)
                  : actual.decideBotAction(view);
        },
    };
});

/** Issue #8999 — the bot's own view cannot be built at all. */
let stubViewThrows = false;
vi.mock("~/lib/ai/bot-view", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/bot-view")>();
    return {
        ...actual,
        buildBotView: (...args: Parameters<typeof actual.buildBotView>) => {
            if (stubViewThrows) throw new Error("view exploded");
            return actual.buildBotView(...args);
        },
    };
});

/** Issue #8999 — the NEXT realised runner throws synchronously, before it
 *  returns its promise: the shape that skipped `dispatch`'s `.finally` and left
 *  the in-flight guard latched. One-shot, so the ladder's own (real) runner
 *  can prove the guard was released. */
let throwRunnerOnce = false;
vi.mock("~/lib/ai/realise", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/realise")>();
    return {
        ...actual,
        realiseBotAction: (
            ...args: Parameters<typeof actual.realiseBotAction>
        ) => {
            const runner = actual.realiseBotAction(...args);
            if (!runner || !throwRunnerOnce) return runner;
            throwRunnerOnce = false;
            return () => {
                throw new Error("runner threw before its promise");
            };
        },
    };
});

const { useVsAiDriver, BOT_WATCHDOG_MS, BOT_SUBMIT_RETRY_LIMIT } =
    await import("../useVsAiDriver");
const {
    getAiEscalations,
    clearAiEscalations,
    getAiDecisions,
    clearAiDecisions,
} = await import("~/lib/ai/trace-store");
const { botSearchSink, REPORT_KEYS } =
    await import("~/lib/ai/bot-search-telemetry");
// The real mount point, so the rung-5 tests exercise the actual UI seam
// (`VsAiDriver` → `reportStall` → `BotStuckNotice`) rather than a stand-in.
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

/** `target`, ANNOUNCED origin (CR 601.2c) — the bot's own half-built cast is
 *  waiting on its target choice. `buildOwedTargetView` deliberately surfaces no
 *  `owedTarget` here (the executor drives an announced selection atomically), so
 *  the search is the ONLY thing that can answer it and there is no local
 *  fallback: the window where a `{ move: null }` consult submits nothing. */
function announcedTargetBoard(): GameState {
    const state = targetBoard();
    state.pendingTarget!.kind = "cast";
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

/** The mutation the escalation ladder must reach for each board above — pinned
 *  BY NAME, not merely counted (review finding 2). "The game state advanced" is
 *  the acceptance criterion, and a rung that submits the wrong mutation is
 *  rejected server-side while still bumping a call counter.
 *
 *   - `choice`          rung 2, ADR 0016 conservative default → `submitMayPay`
 *   - `target`          rung 2, the raised-target minimal submission (#2283),
 *                       batched → `selectTargets`
 *   - `blockers`        rung 2, CR 509.1 empty declaration → `confirmBlockers`
 *   - `sacrifice`       rung 2, CR 508.1g minimal victim set → `selectSacrifice`
 *   - `attack-mana-tax` rung 3, the tax is unaffordable on this board (no
 *                       lands), so CR 508.1c declines it → `cancelAttackTax`
 *   - `priority`        rungs 2/3 have nothing parked, so CR 117 → `passPriority`
 */
const EXPECTED_ESCALATION_MUTATION = {
    choice: "submitMayPay",
    target: "selectTargets",
    blockers: "confirmBlockers",
    sacrifice: "selectSacrifice",
    "attack-mana-tax": "cancelAttackTax",
    priority: "passPriority",
} satisfies Record<ExpectedInputKind, string>;

/** Publish a board as the "server" state at state version `seq`: refresh the
 *  authoritative `expectedInput`, project it to the bot's own viewpoint. The
 *  `seq` is the driver's liveness signal — an accepted mutation writes a new
 *  one, and the watchdog measures "this version has not changed". */
function publish(state: GameState, seq = 1) {
    refreshExpectedInput(state);
    currentState = projectPublicState(state, seq, BOT);
    return computeExpectedInput(state);
}

/** Advance fake timers inside `act`, flushing React's passive effects.
 *
 *  **Cadence matters, and it is load-bearing** (review finding 2). Advancing
 *  `BOT_WATCHDOG_MS + 100` in ONE hop fires the escalation timer *before* React
 *  ever flushes the re-render a settled submission schedules — and that flush is
 *  precisely what re-runs the driver's effects in production. A suite that never
 *  interleaves it cannot fail on a watchdog that disarms itself on the re-run,
 *  which is exactly the latch this file exists to make impossible. Every test
 *  below therefore reaches the deadline through {@link runToWatchdog}: settle,
 *  flush, THEN wait. */
async function advance(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

/** One full watchdog round, the way production experiences it: the think delay
 *  and the search settle first (which schedules a React re-render), then a
 *  separate `act` round so that re-render actually flushes, and only then the
 *  watchdog deadline. */
async function runToWatchdog() {
    await advance(300); // THINK_DELAY_MS + the consult settling
    await advance(10); // React flushes the settle's re-render
    await advance(BOT_WATCHDOG_MS + 100);
}

/** Watchdog rounds until rung 5 hands the window off (issue #9003), then one
 *  flush so the server's answer renders — and no further: the skip notice is
 *  transient, and more rounds would outlast it. */
async function runToHandOff(maxRounds = 8) {
    for (let round = 0; round < maxRounds; round++) {
        await runToWatchdog();
        if (calls.some((c) => c.ref === "reportStall")) break;
    }
    await advance(10);
}

beforeEach(() => {
    calls.length = 0;
    currentState = undefined;
    mutationsThrow = false;
    onMutation = undefined;
    reportStallImpl = () =>
        Promise.resolve({ advanced: true, outcome: "advanced" });
    reportConsultFailureImpl = () => Promise.resolve(null);
    stubDecideNone = true;
    stubDecideUnanswered = false;
    stubDecideThrows = false;
    stubViewThrows = false;
    throwRunnerOnce = false;
    deferConsult = false;
    releaseConsult = undefined;
    clearAiDecisions();
    brainResult = { move: null, trace: null };
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
            await runToWatchdog();

            // A legal submission reached the server within the watchdog
            // interval — the game moved. Assert WHICH mutation: `length > 0`
            // would pass on a rung that reached the wrong (server-rejected)
            // mutation, and "the game state advanced" is the criterion.
            expect(calls.map((c) => c.ref)).toContain(
                EXPECTED_ESCALATION_MUTATION[kind]
            );
            expect(calls[0].args).toMatchObject({
                gameId: GAME,
                playerId: BOT,
            });
        });
    }

    it("does NOT latch when a searched window's consult returns no move", async () => {
        // Review finding 1, and the reason the watchdog cannot key on "a
        // dispatch was started". The Worker branch's runner is
        // `consultBrain(...).then(({move}) => chosen ? executeMove(...) :
        // undefined)`: with `move: null` and no local fallback it RESOLVES
        // having submitted nothing. Nothing threw, so the driver's `.catch`
        // never ran; the settle re-rendered, both effects re-ran, and the
        // watchdog used to clear its own already-armed timer and bail on
        // "I already dispatched for this state version" — no mutation, no new
        // tick, nothing left to ever run again.
        //
        // `{ move: null }` is the production shape, not a contrivance:
        // `brain-client.ts`'s `worker.onerror` resolves every in-flight consult
        // with it, so one transient Worker error hit this path.
        stubDecideNone = false;
        const state = announcedTargetBoard();
        const expected = publish(state);
        expect(expected?.kind).toBe("target");
        expect(computeOwedPlayerIds(state)).toContain(BOT);

        renderHook(() => useVsAiDriver(GAME, BOT));
        await runToWatchdog();

        // CR 608.2b / 601.2 — the ladder's rung 3 rewinds the selection through
        // `cancelTarget`, the same mutation a human's "cancel" click drives.
        expect(calls.map((c) => c.ref)).toContain("cancelTarget");
        expect(getAiEscalations().map((r) => r.expectedKind)).toContain(
            "target"
        );
    });

    it("keeps walking the ladder when a rung SUBMITS but the game does not advance", async () => {
        // Review finding 1b: `passPriority` (`convex/game.ts`) deliberately
        // returns WITHOUT saving when the caller does not hold priority, and
        // `ESCALATION_POLICY.priority.canPass` offers that rung in the CR 510.1c
        // combat-damage sub-flow. A resolved mutation is therefore NOT proof the
        // state advanced — so the watchdog must keep watching the same state
        // version until the version itself changes. Every mutation here resolves
        // successfully and the published state never moves.
        publish(priorityBoard());
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        await runToHandOff();

        // It did not go quiet after the first accepted-but-inert submission: it
        // exhausted the ladder and handed the window to the server — never a
        // dead end (issue #9003).
        expect(calls.map((c) => c.ref)).toContain("passPriority");
        expect(calls.map((c) => c.ref)).toContain("reportStall");
        expect(screen.getByRole("status").textContent).toContain(
            "skipped a decision"
        );
    });

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
        // The hardest preset is `DIFFICULTY_BUDGETS.expert`,
        // `{ iterations: 1320, timeMs: 3300 }` (issue #2790 — a +10% margin
        // over `hard`'s `{ iterations: 1200, timeMs: 3000 }`, itself raised
        // from 600 by issue #2682, keeping `hard`'s pre-#2682 2× ratio to
        // `medium.timeMs` once `medium` was re-aligned to the real
        // `DEFAULT_BUDGET`, 1500ms). The floor below is taken as the MAX over
        // every preset, not a named one, so a future harder level re-proves
        // this margin here instead of eroding it in silence. With
        // `THINK_DELAY_MS` and a Worker
        // round-trip on top, a legitimate think still sits comfortably inside
        // the watchdog interval — no longer "an order of magnitude" at this
        // scale (that flat 5× margin was calibrated against the old 600ms
        // figure; literally preserving it here would demand a 15s+ watchdog,
        // which would make a REAL freeze take 15s+ to surface — worse for the
        // player, not safer), but still ample headroom. Asserted against the
        // real constant so tightening one without the other fails here.
        const { DIFFICULTY_BUDGETS } = await import("@convex/gre/difficulty");
        const hardest = Math.max(
            ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.timeMs ?? 0)
        );
        expect(BOT_WATCHDOG_MS).toBeGreaterThan(hardest);
        expect(BOT_WATCHDOG_MS - hardest).toBeGreaterThanOrEqual(2000);

        // And end-to-end: with the real gate, a plain priority window is
        // answered by the bot's OWN decision well before the watchdog, and the
        // watchdog then never fires — exactly one submission, over TWICE the
        // watchdog interval.
        //
        // The fixture advances the board when the pass lands, which is the
        // whole point: the watchdog now measures "this state version has not
        // changed", so a mock server that accepts a pass and then freezes the
        // board is a STUCK game and escalating it is correct. Only a fixture
        // that actually moves proves the non-escalation.
        stubDecideNone = false;
        onMutation = () => {
            const next = priorityBoard();
            next.priorityPlayerId = HUMAN;
            publish(next, (currentState as { seq: number }).seq + 1);
        };
        publish(priorityBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(300);
        await advance(10);
        await advance(BOT_WATCHDOG_MS * 2);
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(getAiEscalations()).toHaveLength(0);
    });

    it("escalates IMMEDIATELY on a 'nothing owed' decision, not after the full interval", async () => {
        // "Nothing owed" while the Expected Input names the bot is a defect,
        // not a slow think: waiting the full interval on a decision that is
        // already KNOWN to be missing is dead time in the human's game.
        publish(priorityBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(50);
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    it("records every escalation past rung 1 in the AI decision trace", async () => {
        clearAiEscalations();
        publish(targetBoard());
        renderHook(() => useVsAiDriver(GAME, BOT));
        await runToWatchdog();

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
        await runToWatchdog();
        await runToWatchdog();

        // The first attempt, plus the retries, plus at least one escalation
        // rung — and crucially MORE than one call: the pre-#2284 driver made
        // exactly one and then went silent forever.
        expect(calls.length).toBeGreaterThan(1);
        expect(calls.length).toBeGreaterThanOrEqual(BOT_SUBMIT_RETRY_LIMIT);
        expect(calls.every((c) => c.ref === "passPriority")).toBe(true);
    });

    // Review round 2, finding A — the breadcrumb reached through the ESCALATION
    // ladder used to be written by a closure frozen at the first render, where
    // `botState` does not exist yet (`tick` is still loading, so the fat query
    // is "skip"). Every `submit-error` note the ladder produced was therefore a
    // silent no-op: the exact "recorded nothing" shape the ring exists to
    // remove, reintroduced by the fix for it. The `seq` assertion is the
    // load-bearing half — a record written from the mount-time closure would
    // carry a stale version and line up against the wrong board.
    it("records a REJECTED escalation submission, at the current state version", async () => {
        // `stubDecideNone` stays TRUE (the file default): the bot answers
        // "nothing owed" while the engine says it owes, so the normal decision
        // path dispatches NOTHING and every submission below comes from the
        // ladder. Without that isolation the test passes on the normal path's
        // own breadcrumb and proves nothing about the ladder's — which is
        // exactly what the first version of it did.
        mutationsThrow = true;

        // Mount with NO data, exactly as production does: `tick` is a live
        // query, so on the first render it is `undefined`, the fat state query
        // is "skip", and `botState` does not exist yet. That first render is
        // the one `escalate` (a `useCallback([], …)`) freezes forever — mount
        // the hook with the state already present, as this harness's
        // synchronous query mock otherwise allows, and the frozen closure
        // captures a usable state, so the bug cannot show.
        currentState = undefined;
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));

        // The data arrives on a LATER render. A non-default seq pins the
        // record to the version actually on screen.
        publish(priorityBoard(), 42);
        rerender();
        await runToWatchdog();
        await runToWatchdog();

        const rejected = getAiDecisions().filter(
            (d) => d.outcome === "submit-error"
        );
        expect(rejected.length).toBeGreaterThan(0);
        expect(rejected[0].message).toContain("server rejected");
        expect(rejected[0].seq).toBe(42);
    });

    // Review of #2475 (post-merge) — the CONSULT verdict was the one record
    // that still read "the latest committed state" instead of the version the
    // search actually ran on. It is also the record type #2450 exists to
    // produce (`worker-error` / `timeout` / `no-move` / `move`), and its window
    // is the widest in the driver: Worker startup plus a full difficulty
    // budget. A verdict filed under a version the search never saw cannot be
    // lined up with the board snapshot beside it.
    it("files the consult verdict under the version the SEARCH ran on", async () => {
        stubDecideNone = false;
        deferConsult = true;
        // A land in hand makes this a window worth searching — otherwise
        // `shouldThink` short-circuits to a trivial pass and no consult happens.
        const board = priorityBoard();
        board.players[1].hand = [
            makeInstance(FOREST, {
                id: "land1",
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            }),
        ];
        publish(board, 1);

        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);
        expect(releaseConsult).toBeDefined();

        // The board moves on while the search is still running.
        publish(board, 2);
        rerender();
        await advance(50);

        // …and only THEN does the Brain answer, badly.
        releaseConsult!({
            move: null,
            trace: null,
            outcome: "worker-error",
            via: "worker",
            message: "Script error",
        });
        await advance(50);

        const verdict = getAiDecisions().find(
            (d) => d.outcome === "worker-error"
        );
        expect(verdict).toBeDefined();
        expect(verdict!.seq).toBe(1);
    });

    // The `unanswered` exit: the engine names the bot, the Brain has no answer,
    // and the driver escalates immediately without dispatching. It records
    // nothing anywhere but the escalation ring unless this breadcrumb exists —
    // and the escalation ring says which rung FIRED, never why the normal path
    // produced nothing.
    it("records the window the Brain had no answer for", async () => {
        stubDecideUnanswered = true;
        publish(priorityBoard(), 7);

        renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);

        const unanswered = getAiDecisions().find(
            (d) => d.outcome === "unanswered"
        );
        expect(unanswered).toBeDefined();
        expect(unanswered!.expectedKind).toBe("priority");
        expect(unanswered!.seq).toBe(7);
    });

    it("rung 5 hands the window to the server ONCE per seq, with diagnostics — no manual exit (issue #9003)", async () => {
        // Every rung's mutation is rejected, so the automatic walk exhausts the
        // ladder. Rung 5 used to wait for the player's click; it now calls
        // `reportStall` by itself, carrying the driver's telemetry.
        mutationsThrow = true;
        publish(targetBoard(), 4);
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        // One round per rung: a settled submission re-renders from a microtask
        // at the END of the previous round, so a single long advance would
        // leave the freshly-scheduled timer unfired.
        await runToHandOff();
        // A transient notice, and no control to click.
        expect(screen.getByRole("status").textContent).toContain(
            "reported automatically"
        );
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        // Two rounds past the ladder: the hand-off does not repeat on the
        // same version, and the notice goes away by itself.
        await runToWatchdog();
        await runToWatchdog();
        expect(screen.queryByRole("status")).toBeNull();

        const handOffs = calls.filter((c) => c.ref === "reportStall");
        expect(handOffs).toHaveLength(1);
        expect(handOffs[0].args).toMatchObject({
            gameId: GAME,
            seq: 4,
            cause: "ladder-exhausted",
        });
        // The collector's payload: the Bot's decision and escalation rings.
        const diagnostics = (
            handOffs[0].args as {
                diagnostics: { ai?: { escalations: unknown[] } };
            }
        ).diagnostics;
        expect(diagnostics.ai?.escalations.length).toBeGreaterThan(0);
    });

    it("shows no skip notice when the server had nothing to advance", async () => {
        // The game moved between the client's decision and the mutation: the
        // server's no-op says nothing was skipped, so nothing is announced.
        mutationsThrow = true;
        reportStallImpl = () =>
            Promise.resolve({ advanced: false, reason: "stale-seq" });
        publish(targetBoard());
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        await runToHandOff();

        expect(calls.map((c) => c.ref)).toContain("reportStall");
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("full path: a stuck board → the driver → the REAL reportStall → an advanced game (issue #9003)", async () => {
        // The Bot holds priority and every ladder rung is rejected. The
        // hand-off runs the REGISTERED mutation over a stub store seeded with
        // the same board, and the board it saves is published back — the game
        // the player sees moves on with no click.
        const { reportStall } = await import("@convex/botLiveness");
        const { makeMutationCtx, runMutation } =
            await import("@convex/__tests__/gameMutationHarness.fixture");
        mutationsThrow = true;
        const board = priorityBoard();
        const store = makeMutationCtx("u1", [
            {
                _id: GAME,
                __table: "games",
                name: "Game",
                status: "playing",
                solo: true,
                vsAi: true,
                players: [{ id: HUMAN }, { id: BOT }],
            },
            {
                _id: "gs-1",
                __table: "gameStates",
                gameId: GAME,
                seq: 3,
                state: structuredClone(board),
                updatedAt: 0,
            },
        ]);
        reportStallImpl = async (args) => {
            const result = await runMutation(reportStall, store.ctx, args);
            publish(store.state(), store.doc("gs-1").seq as number);
            return result;
        };
        publish(board, 3);
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        await runToHandOff();

        expect(calls.filter((c) => c.ref === "reportStall")).toHaveLength(1);
        // CR 117.3d — the server's legal rung passed the Bot's priority.
        expect(store.doc("gs-1").seq).toBe(4);
        const after = store.state();
        expect(after.priorityPlayerId).toBe(HUMAN);
        expect(computeOwedPlayerIds(after)).not.toContain(BOT);
        // The fault is on file, and the player was told.
        const report = store.writes.find((w) => w.table === "bugReports");
        expect(store.doc(report!.id)).toMatchObject({
            source: "system",
            fault: { origin: "client-handoff", expectedKind: "priority" },
        });
        expect(screen.getByRole("status").textContent).toContain(
            "skipped a decision"
        );
    });
});

// Issue #8999 — a THROW anywhere in the driver's decision path. Uncaught, it
// left the effect, reached the router's catch boundary and unmounted `<Board>`
// with the driver inside it: no ladder, no record — one plausible shape of the
// reported Crabomination / Cabal Ritual freezes. Each test mounts the REAL
// `VsAiDriver`, so a throw that escapes an effect fails the render itself.
describe("a throw in the driver's decision path (issue #8999)", () => {
    it("escalates a THROWING decision immediately instead of unmounting, and records it", async () => {
        stubDecideThrows = true;
        publish(priorityBoard(), 5);

        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        // Well inside the watchdog interval: a throw is a known defect, like
        // `unanswered`, never a slow think.
        await advance(50);

        // The ladder ran past the throwing decision to the CR 117 pass.
        expect(calls.map((c) => c.ref)).toContain("passPriority");
        const fault = getAiDecisions().find(
            (d) => d.outcome === "driver-error"
        );
        expect(fault).toBeDefined();
        expect(fault!.message).toContain("decide exploded");
        expect(fault!.expectedKind).toBe("priority");
        expect(fault!.seq).toBe(5);
    });

    it("releases the in-flight guard when a runner throws BEFORE its promise", async () => {
        // The real decision path: the bot declines the unaffordable
        // per-attacker mana tax, a cost to attack (CR 508.1h), through a
        // DIRECT realisation, and that runner throws synchronously. Before the guard the
        // throw skipped `dispatch`'s `.finally`, so `inFlight` stayed latched
        // and every rung after it bailed — the ladder's own submission below is
        // only reachable once the guard has been released.
        stubDecideNone = false;
        throwRunnerOnce = true;
        publish(attackManaTaxBoard(), 3);

        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        await advance(50);

        expect(calls.map((c) => c.ref)).toContain("cancelAttackTax");
        const fault = getAiDecisions().find(
            (d) => d.outcome === "driver-error"
        );
        expect(fault).toBeDefined();
        expect(fault!.message).toContain("runner threw before its promise");
        expect(fault!.expectedKind).toBe("attack-mana-tax");
    });

    it("hands the window off as a driver-error when the bot's own view cannot be built", async () => {
        // Every rung is computed FROM the view, so none can run: the window
        // the TICK names goes straight to rung 5 — the hand-off to the server
        // (issue #9003) — rather than to silence.
        stubViewThrows = true;
        publish(priorityBoard(), 9);

        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        await advance(50);

        const handOff = calls.find((c) => c.ref === "reportStall");
        expect(handOff?.args).toMatchObject({
            gameId: GAME,
            seq: 9,
            cause: "driver-error",
        });
        const fault = getAiDecisions().find(
            (d) => d.outcome === "driver-error"
        );
        expect(fault).toBeDefined();
        expect(fault!.message).toContain("view exploded");
        expect(fault!.expectedKind).toBe("priority");
    });
});

// Issue #9502 — a consult that gave NO answer is reported to the server, so a
// Bot that passes a whole game on failed consults leaves a trace there. Driven
// through the real decision path: the REAL `decideBotAction` routes the window
// to the consult, and the consult's verdict reaches the driver's breadcrumb
// seam exactly as `brain-client.ts` resolves it.
describe("failed Brain consults reach the server (issue #9502)", () => {
    /** CR 305.2 — the Bot's main phase with a land in hand: a window worth
     *  searching, so the decision is routed to the Brain. */
    function landWindow(seq = 1) {
        stubDecideNone = false;
        const board = priorityBoard();
        board.players[1].hand = [
            makeInstance(FOREST, {
                id: "land1",
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            }),
        ];
        publish(board, seq);
    }

    const reports = () => calls.filter((c) => c.ref === "reportConsultFailure");

    for (const outcome of ["search-error", "worker-error", "timeout"]) {
        it(`reports a "${outcome}" consult exactly once`, async () => {
            landWindow(4);
            brainResult = {
                move: null,
                trace: null,
                outcome,
                via: "worker",
                message: "Script error",
            };
            renderHook(() => useVsAiDriver(GAME, BOT));
            await advance(500);

            expect(reports()).toHaveLength(1);
            expect(reports()[0].args).toEqual({
                gameId: GAME,
                seq: 4,
                outcome,
                message: "Script error",
            });
        });
    }

    it("reports nothing for a consult that answered", async () => {
        landWindow();
        brainResult = {
            move: { kind: "play-land", cardInstanceId: "land1" },
            trace: null,
            outcome: "move",
            via: "worker",
        };
        renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);

        expect(getAiDecisions().map((d) => d.outcome)).toContain("move");
        expect(reports()).toHaveLength(0);
    });

    it("reports nothing for a consult that chose no move", async () => {
        landWindow();
        brainResult = {
            move: null,
            trace: null,
            outcome: "no-move",
            via: "worker",
        };
        renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);

        expect(getAiDecisions().map((d) => d.outcome)).toContain("no-move");
        expect(reports()).toHaveLength(0);
    });

    it("a rejected or throwing report leaves the bot's play exactly as it was", async () => {
        /** The mutations the driver submits over one ladder round after a
         *  timed-out consult — the report itself excluded. */
        async function play(): Promise<unknown[]> {
            calls.length = 0;
            clearAiDecisions();
            clearAiEscalations();
            landWindow();
            brainResult = {
                move: null,
                trace: null,
                outcome: "timeout",
                via: "worker",
            };
            const { unmount } = renderHook(() => useVsAiDriver(GAME, BOT));
            await runToWatchdog();
            unmount();
            expect(reports()).toHaveLength(1);
            return calls
                .filter((c) => c.ref !== "reportConsultFailure")
                .map((c) => c.ref);
        }

        const baseline = await play();
        expect(baseline.length).toBeGreaterThan(0);

        reportConsultFailureImpl = () =>
            Promise.reject(new Error("server rejected"));
        expect(await play()).toEqual(baseline);

        reportConsultFailureImpl = () => {
            throw new Error("client threw");
        };
        expect(await play()).toEqual(baseline);
    });
});

// ── The game's Bot search report (issue #9526) ──────────────────────────────
//
// Every consult's ending is folded into ONE report per game, emitted at game
// over or when the game is left. Driven through the real decision path, like
// the #9502 block above: the REAL `decideBotAction` routes the window to the
// consult, and the consult's verdict and trace reach the driver exactly as
// `brain-client.ts` resolves them. The report is observed at its sink.
describe("the game's Bot search report (issue #9526)", () => {
    const GAME_2 = "game2" as Id<"games">;

    /** CR 305.2 — the Bot's main phase with a land in hand: a window worth
     *  searching, so the decision is routed to the Brain. */
    function searchWindow(seq: number): GameState {
        stubDecideNone = false;
        const board = priorityBoard();
        board.players[1].hand = [
            makeInstance(FOREST, {
                id: "land1",
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            }),
        ];
        publish(board, seq);
        return board;
    }

    /** A search the clock cut at a quarter of its budget. */
    const CUT_SHORT = {
        iterationsRequested: 1320,
        iterationsCompleted: 330,
        elapsedMs: 3300,
        stoppedBy: "time",
    };

    function answered() {
        brainResult = {
            move: { kind: "play-land", cardInstanceId: "land1" },
            trace: CUT_SHORT,
            outcome: "move",
            via: "worker",
        };
    }

    function timedOut() {
        brainResult = {
            move: null,
            trace: null,
            outcome: "timeout",
            via: "worker",
        };
    }

    let log: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        log = vi.spyOn(botSearchSink, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        log.mockRestore();
    });

    it("reports a game's consults once, when the game ends on the board", async () => {
        const board = searchWindow(1);
        answered();
        const { rerender, unmount } = renderHook(() =>
            useVsAiDriver(GAME, BOT)
        );
        await advance(500);

        searchWindow(2);
        timedOut();
        rerender();
        await advance(500);
        expect(log).not.toHaveBeenCalled();

        board.gameOver = { winnerId: HUMAN, loserId: BOT, reason: "life" };
        publish(board, 3);
        rerender();
        await advance(50);

        expect(log).toHaveBeenCalledTimes(1);
        const report = log.mock.calls[0]![0] as Record<string, unknown>;
        expect(report).toMatchObject({
            gameId: GAME,
            consults: 2,
            "consults.move": 1,
            "consults.timeout": 1,
            searches: 1,
            "iterations.requested": 1320,
            "iterations.completed": 330,
            "iterations.ratio": 0.25,
            "stopped.time": 1,
            "searchMs.max": 3300,
            "msPerIteration.p50": 10,
        });
        expect(typeof report.difficulty).toBe("string");
        const allowed = new Set<string>(REPORT_KEYS);
        expect(Object.keys(report).filter((k) => !allowed.has(k))).toEqual([]);

        // Leaving the game-over screen does not report the game again.
        unmount();
        expect(log).toHaveBeenCalledTimes(1);
    });

    it("times a consult from its posting to its verdict", async () => {
        const board = searchWindow(1);
        deferConsult = true;
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);
        expect(releaseConsult).toBeDefined();

        // The Brain takes 1.2 s to answer.
        await advance(1200);
        releaseConsult!({
            move: null,
            trace: null,
            outcome: "no-move",
            via: "worker",
        });
        await advance(50);

        board.gameOver = { winnerId: HUMAN, loserId: BOT, reason: "life" };
        publish(board, 2);
        rerender();
        await advance(50);

        expect(log).toHaveBeenCalledTimes(1);
        const report = log.mock.calls[0]![0] as Record<string, number>;
        // Posted somewhere inside the first 500 ms (the think delay), settled
        // 1,200 ms after them: never less than the Brain's own 1.2 s, never
        // more than the whole 1.7 s the test has run.
        expect(report["consultMs.max"]).toBeGreaterThanOrEqual(1200);
        expect(report["consultMs.max"]).toBeLessThanOrEqual(1700);
    });

    it("reports a game that is LEFT, once, and starts the next game from zero", async () => {
        searchWindow(1);
        answered();
        let game = GAME;
        const { rerender, unmount } = renderHook(() =>
            useVsAiDriver(game, BOT)
        );
        await advance(500);
        expect(log).not.toHaveBeenCalled();

        // A rematch swaps the game on the same hook instance.
        game = GAME_2;
        searchWindow(1);
        timedOut();
        rerender();
        await advance(500);

        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]![0]).toMatchObject({
            gameId: GAME,
            consults: 1,
            "consults.move": 1,
        });

        unmount();
        expect(log).toHaveBeenCalledTimes(2);
        const second = log.mock.calls[1]![0] as Record<string, unknown>;
        expect(second).toMatchObject({
            gameId: GAME_2,
            consults: 1,
            "consults.timeout": 1,
            searches: 0,
        });
        expect(second).not.toHaveProperty("consults.move");
    });

    it("files a verdict that lands after a swap under NEITHER game's report", async () => {
        searchWindow(1);
        deferConsult = true;
        let game = GAME;
        const { rerender, unmount } = renderHook(() =>
            useVsAiDriver(game, BOT)
        );
        await advance(500);
        expect(releaseConsult).toBeDefined();

        // The player moves to the next game while the search is still running…
        game = GAME_2;
        publish(priorityBoard(), 1);
        stubDecideNone = true;
        rerender();
        await advance(50);

        // …and only then does the old game's consult settle.
        releaseConsult!({
            move: null,
            trace: null,
            outcome: "worker-error",
            via: "worker",
            message: "Brain disposed",
        });
        await advance(50);
        unmount();

        // The old game was left with no settled consult, the new one never
        // consulted the Brain: neither has anything to report.
        expect(log).not.toHaveBeenCalled();
    });

    it("reports nothing for a game the Brain was never consulted in", async () => {
        publish(priorityBoard(), 1);
        const { unmount } = renderHook(() => useVsAiDriver(GAME, BOT));
        await advance(500);
        unmount();
        expect(log).not.toHaveBeenCalled();
    });

    it("a throwing sink leaves the Bot's play exactly as it was", async () => {
        /** The mutations the driver submits over one ladder round after a
         *  timed-out consult, then the game is left. */
        async function play(): Promise<unknown[]> {
            calls.length = 0;
            clearAiDecisions();
            clearAiEscalations();
            searchWindow(1);
            timedOut();
            const { unmount } = renderHook(() => useVsAiDriver(GAME, BOT));
            await runToWatchdog();
            expect(() => unmount()).not.toThrow();
            return calls.map((c) => c.ref);
        }

        const baseline = await play();
        expect(baseline.length).toBeGreaterThan(0);
        expect(log).toHaveBeenCalledTimes(1);

        log.mockImplementation(() => {
            throw new Error("monitoring is down");
        });
        expect(await play()).toEqual(baseline);
        expect(log).toHaveBeenCalledTimes(2);
    });
});
