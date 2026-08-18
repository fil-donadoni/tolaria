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
/** When set, an ACCEPTED mutation advances the published board — the real
 *  server writes a new seq, and the watchdog keys on that state version. */
let onMutation: ((ref: unknown) => void) | undefined;

vi.mock("@convex/_generated/api", () => {
    // Every mutation/query the driver reaches for, tagged by a plain string so
    // assertions never touch Convex's FunctionReference proxies. A missing key
    // would silently become `undefined` and swallow the call, so this is
    // deliberately the full surface.
    const names = [
        "getPublicState",
        "getGameTick",
        "getGame",
        "getSeatDeck",
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
        // `getSeatDeck` (issue #2506) stays unanswered here ON PURPOSE: this
        // suite's subject is the escalation ladder, and `ownDeck` only changes
        // what the search sees inside a library, never whether the driver
        // escalates. The #1509 wiring it stubs away has its own coverage in
        // `useVsAiDriver.bot.test.ts` ("feeds the bot's own getSeatDeck cards
        // into the search adapter" / "falls back to a placeholder library"),
        // which is where a widened stub would otherwise have left it unproven.
        if (ref === "getGame" || ref === "getSeatDeck") return undefined;
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
        if (mutationsThrow) return Promise.reject(new Error("server rejected"));
        // A hook for the fixtures that need an ACCEPTED mutation to actually
        // move the board — the real server writes a new seq, and the watchdog
        // keys on that state version.
        onMutation?.(ref);
        return Promise.resolve(null);
    },
}));

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
vi.mock("~/lib/ai/brain", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/brain")>();
    return {
        ...actual,
        decideBotAction: (
            view: Parameters<typeof actual.decideBotAction>[0]
        ) =>
            stubDecideUnanswered
                ? ({ kind: "unanswered" } as const)
                : stubDecideNone
                  ? ({ kind: "none" } as const)
                  : actual.decideBotAction(view),
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

beforeEach(() => {
    calls.length = 0;
    currentState = undefined;
    mutationsThrow = false;
    onMutation = undefined;
    stubDecideNone = true;
    stubDecideUnanswered = false;
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
        for (let round = 0; round < 4; round++) await runToWatchdog();

        // It did not go quiet after the first accepted-but-inert submission: it
        // exhausted the ladder and surfaced rung 5 — never a dead end.
        expect(calls.map((c) => c.ref)).toContain("passPriority");
        expect(screen.getByRole("alert").textContent).toContain(
            "The AI could not act"
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

    it("rung 5 hands the player a control that advances the game (end-to-end)", async () => {
        // Every rung's mutation is rejected, so the automatic walk exhausts the
        // ladder and lands on rung 5 — the user-visible, actionable state. The
        // whole point of rung 5 is that it is NEVER a dead end.
        mutationsThrow = true;
        publish(targetBoard());
        render(createElement(VsAiDriver, { gameId: GAME, botId: BOT }));
        // One round per rung: a settled submission re-renders from a microtask
        // at the END of the previous round, so a single long advance would
        // leave the freshly-scheduled timer unfired.
        for (let round = 0; round < 6; round++) await runToWatchdog();

        // `getBy*`, not `findBy*`: the async queries poll on real timers, which
        // never advance under `vi.useFakeTimers()`.
        const notice = screen.getByRole("alert");
        expect(notice.textContent).toContain("The AI could not act");
        const button = screen.getByRole("button", { name: /continue game/i });

        // ── The server is still broken: the player clicks anyway ────────────
        //
        // Review finding 3. `resolveStuck` used to clear the banner
        // unconditionally after `await runner()`, taking a settled mutation as
        // proof the game moved — the same false premise the watchdog rested on.
        // The human's ONE manual exit would vanish while the board sat exactly
        // where it was: a dead end, which the issue explicitly forbids.
        calls.length = 0;
        await act(async () => {
            fireEvent.click(button);
            await vi.advanceTimersByTimeAsync(50);
        });
        expect(calls.length).toBeGreaterThan(0); // it really did try
        expect(screen.getByRole("alert")).toBeTruthy(); // …and the exit remains
        expect(
            screen
                .getByRole("button", { name: /continue game/i })
                .hasAttribute("disabled")
        ).toBe(false); // a rejected rung re-enables the button, no unhandled rejection

        // ── The server recovers; the player clicks again ────────────────────
        mutationsThrow = false;
        calls.length = 0;
        // An accepted submission moves the board — that state version change is
        // the ONLY thing that clears the banner.
        onMutation = () => {
            const done = targetBoard();
            done.pendingTarget = undefined;
            done.stack.length = 0;
            done.priorityPlayerId = HUMAN;
            publish(done, (currentState as { seq: number }).seq + 1);
        };
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: /continue game/i })
            );
            await vi.advanceTimersByTimeAsync(50);
        });

        // A LEGAL engine path: the raised target's minimal-legal submission,
        // through the same `selectTargets` a human's clicks make (CR 603.3d) —
        // not an invented skip, and not a state write outside the mutations.
        expect(calls.map((c) => c.ref)).toContain("selectTargets");
        expect(calls[0].args).toMatchObject({ gameId: GAME, playerId: BOT });
        // And the banner clears once the game has actually moved.
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
