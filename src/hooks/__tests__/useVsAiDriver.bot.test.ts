// Driver integration (ADR 0001, issue #110): the full client path
// query(bot viewpoint) → gate → consultBrain (Worker; here the inline fallback
// in jsdom enumerates with the real GRE) → executor → existing mutation. Mocks
// only the Convex transport (useQuery/useMutation); everything else is the real
// spine. Proves a vs-AI bot enumerates from its own view and submits a legal
// move on the bot seat.
//
// Tick-gated subscription (issue #1778): the driver now subscribes to
// `getGameTick` first and only mounts `getPublicState` (`currentState`) once
// the tick names the bot's own seat as one of `owedPlayerIds`. The mock
// derives the tick from the REAL `computeOwedPlayerIds`/`computeExpectedInput`
// (`convex/gre/expectedInput.ts`) run against `currentState` — NOT a
// hand-picked `priorityPlayerId` echo — so a fixture where the combat-damage
// assigner differs from `priorityPlayerId` (banding, CR 702.22j-k) exercises
// the same gate the server actually applies (review finding 2: the old mock
// baked in `expectedInputPlayerId: s.priorityPlayerId`, which is exactly the
// assumption finding 1 proved false).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { getCardByName } from "@convex/cards";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import { makeInstance } from "@convex/cards/__tests__/setup";
import {
    computeExpectedInput,
    computeOwedPlayerIds,
} from "@convex/gre/expectedInput";

const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

const calls: { ref: unknown; args: unknown }[] = [];
// Every `useQuery` invocation whose args were NOT "skip" — used to prove the
// fat `getPublicState` subscription never mounts with real args unless the
// tick says the bot owes input (issue #1778).
const queryMounts: { ref: unknown; args: unknown }[] = [];
// The state the tick is derived from — the "server" the mock stands in for.
let currentState: unknown = undefined;
// Lets a test make `getPublicState` diverge from `currentState` (issue #1778
// finding 3 — a freshly (re)mounted subscription serving a stale/undefined
// value behind a tick that has already advanced). `active: false` is the
// default for every test that doesn't care about the race: `getPublicState`
// then simply mirrors `currentState`, matching the pre-fix mock's behavior.
let publicStateOverride: { active: boolean; value: unknown } = {
    active: false,
    value: undefined,
};
function setPublicStateOverride(value: unknown) {
    publicStateOverride = { active: true, value };
}
function clearPublicStateOverride() {
    publicStateOverride = { active: false, value: undefined };
}
// Forces `getGameTick` to resolve `null` — a settled query that found no
// `gameTicks` row, as distinct from `undefined` (still loading) — regardless
// of `currentState` (issue #1778 finding 4: a vs-AI game already in progress
// when this feature deploys has never had a tick row written for it).
let forceNullTick = false;
// What `getSeatDeck` answers (issue #2506). `undefined` = still loading;
// `null` = the seat has no decklist row, or the caller does not own it.
let seatDeck:
    | { playerId: string; cards: { cardId: string; cardName: string }[] }
    | null
    | undefined = undefined;
// Every `projectedToGameState` call the search path makes, with the `ownDeck`
// it was handed and the bot library it produced — the seam where a real
// decklist either becomes real card identities or is thrown away for
// placeholders (issue #1509).
const adapterCalls: {
    /** 2 only for the SEARCH rehydration (`handleBrainRequest` passes
     *  `ownDeck`); the driver's own `shouldThink` gate and `bot-view` call the
     *  adapter with the state alone, and those calls are not this seam. */
    argCount: number;
    ownDeck: unknown;
    libraries: Record<string, string[]>;
}[] = [];
/** The adapter calls made by the SEARCH — see `argCount` above. */
function searchAdapterCalls() {
    return adapterCalls.filter((c) => c.argCount === 2);
}
// When active, every mutation returns a promise that only settles once
// `heldMutation.release()` is called (issue #1209).
let heldMutation: {
    active: boolean;
    release?: () => void;
    /** Settle the held mutation as a REJECTION instead (issue #2470): the only
     *  way to make a submission fail AFTER the board has moved on, which is
     *  what tells a `submit-error` breadcrumb's `seq` apart from the latest. */
    fail?: (message: string) => void;
} = {
    active: false,
    release: undefined,
    fail: undefined,
};
// When active, every mutation REJECTS — the server refusing the bot's
// submission (issue #2470: a rejection is one of the two ways a decision dies
// without changing the board, and it must leave a breadcrumb).
let rejectMutation: { active: boolean; message: string } = {
    active: false,
    message: "",
};

// Tag each mutation/query by a plain string so assertions never touch Convex's
// FunctionReference proxies (which throw on primitive coercion in the matcher).
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            getPublicState: "getPublicState",
            getGameTick: "getGameTick",
            getGame: "getGame",
            getSeatDeck: "getSeatDeck",
            playCard: "playCard",
            summonCompanion: "summonCompanion",
            announceCast: "announceCast",
            selectTarget: "selectTarget",
            selectTargets: "selectTargets",
            confirmTargets: "confirmTargets",
            tapForPayment: "tapForPayment",
            activateAbility: "activateAbility",
            tapForActivationPayment: "tapForActivationPayment",
            toggleAttacker: "toggleAttacker",
            confirmAttackers: "confirmAttackers",
            selectBlocker: "selectBlocker",
            assignBlockerTarget: "assignBlockerTarget",
            confirmBlockers: "confirmBlockers",
            confirmDamage: "confirmDamage",
            declareMulligan: "declareMulligan",
            submitResolutionChoice: "submitResolutionChoice",
            submitMayPay: "submitMayPay",
            submitLandEntryChoice: "submitLandEntryChoice",
            submitDrawReplacementPay: "submitDrawReplacementPay",
            submitMadnessDecline: "submitMadnessDecline",
            submitReboundDecline: "submitReboundDecline",
            submitNameCard: "submitNameCard",
            submitRandomRevealAck: "submitRandomRevealAck",
            autoTapForAttackTax: "autoTapForAttackTax",
            cancelAttackTax: "cancelAttackTax",
            resolveManaSpendChoice: "resolveManaSpendChoice",
            selectCastExileCost: "selectCastExileCost",
            selectConvokeCreatures: "selectConvokeCreatures",
            // ADR 0091 / issue #1209 — the owed-payment pickers.
            selectSacrifice: "selectSacrifice",
            selectAdditionalCost: "selectAdditionalCost",
            selectCastAlternativeHandCost: "selectCastAlternativeHandCost",
            selectActivationCost: "selectActivationCost",
            selectActivationExileCost: "selectActivationExileCost",
            selectActivationDiscardCost: "selectActivationDiscardCost",
            passPriority: "passPriority",
        },
    },
}));

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown, args: unknown) => {
        if (args !== "skip") queryMounts.push({ ref, args });
        if (args === "skip") return undefined;
        // issue #1509 — the driver also queries the bot's own decklist
        // (ownDeck), which since issue #2506 is `getSeatDeck` on the split
        // `gameDecks` row. `seatDeck` is `undefined` by default (loading /
        // unowned seat → ownDeck stays undefined and the driver behaves exactly
        // as pre-#1509, the placeholder-library path every other test in this
        // file assumes). The decklist test below sets it to a real answer:
        // stubbing it away unconditionally, as this mock first did, left the
        // ENTIRE #1509 path unproven, and a `getSeatDeck` that returns null
        // degrades the bot in silence (#2506 review, finding 2).
        if (ref === "getSeatDeck") return seatDeck;
        if (ref === "getGame") return undefined;
        if (ref === "getGameTick") {
            if (forceNullTick) return null;
            if (currentState === undefined) return undefined;
            const s = currentState as {
                seq: number;
                priorityPlayerId: string;
                phase: string;
                gameOver?: boolean;
            };
            return {
                seq: s.seq,
                priorityPlayerId: s.priorityPlayerId,
                phase: s.phase,
                expectedInputKind: computeExpectedInput(s as never)?.kind,
                // The real derivation (issue #1778 finding 1/2), not a
                // `priorityPlayerId` echo — folds in the combat-damage
                // assigner sub-flow so a banding fixture below actually
                // exercises the fix instead of restating the old bug.
                owedPlayerIds: computeOwedPlayerIds(s as never),
                gameOver: !!s.gameOver,
            };
        }
        if (ref === "getPublicState") {
            return publicStateOverride.active
                ? publicStateOverride.value
                : currentState;
        }
        return currentState;
    },
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        // ADR 0091 / issue #1209 — a mutation can be held PENDING so a test can
        // observe the window in which a multi-step realisation is half-done
        // (the `inFlight` race the seam closes).
        if (heldMutation.active) {
            return new Promise<null>((resolve, reject) => {
                heldMutation.release = () => resolve(null);
                heldMutation.fail = (message: string) =>
                    reject(new Error(message));
            });
        }
        if (rejectMutation.active) {
            return Promise.reject(new Error(rejectMutation.message));
        }
        return Promise.resolve(null);
    },
}));

// issue #2470 review, finding 1 — `realiseBotAction` returns null on several
// branches, and the driver then submits NOTHING. Off by default (every other
// test in this file exercises the real realisation); flipped on for the one
// test that asserts the silent-death exit now leaves a breadcrumb.
let forceUnrealisable = false;
vi.mock("~/lib/ai/realise", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/ai/realise")>();
    return {
        ...actual,
        realiseBotAction: (
            ...args: Parameters<typeof actual.realiseBotAction>
        ) => (forceUnrealisable ? null : actual.realiseBotAction(...args)),
    };
});

// The adapter is the real one — only WRAPPED, so what it was called with and
// what it produced are both observable. `brain-request` imports it as
// `./state-adapter`; vitest mocks by resolved path, so this alias hits the same
// module.
vi.mock("~/lib/ai/state-adapter", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("~/lib/ai/state-adapter")>();
    return {
        ...actual,
        projectedToGameState: (
            ...args: Parameters<typeof actual.projectedToGameState>
        ) => {
            const out = actual.projectedToGameState(...args);
            adapterCalls.push({
                argCount: args.length,
                ownDeck: args[1],
                libraries: Object.fromEntries(
                    out.players.map((p): [string, string[]] => [
                        p.id,
                        // `CardInstanceState.card` is a loose record here, so
                        // the id comes back `unknown` — normalise it.
                        (p.library ?? []).map((c) => String(c.card.id)),
                    ])
                ),
            });
            return out;
        },
    };
});

// Imported after the mocks so the hook picks up the mocked transport.
const { useVsAiDriver, BOT_WATCHDOG_MS } = await import("../useVsAiDriver");
// The client-only AI rings the driver writes (issue #2470). Not mocked — the
// store IS the subject here.
const { getAiDecisions, clearAiDecisions } =
    await import("~/lib/ai/trace-store");

/** Flush the driver's NORMAL decision path — the think beat, the inline search
 *  and the mutation promises — without reaching the liveness watchdog's deadline
 *  (issue #2284).
 *
 *  These fixtures hold `currentState` FROZEN: an accepted mutation resolves but
 *  the board it publishes never changes. That is fine for asserting what the
 *  decision path submits, but from the driver's point of view it is a game that
 *  stopped advancing, and escalating it is the CORRECT answer — the watchdog
 *  keys on "this state version has not changed", which is the only honest
 *  liveness signal (a resolved mutation is not one: `passPriority` returns
 *  without saving when the caller does not hold priority). Draining EVERY
 *  recursively-scheduled timer therefore used to walk the whole escalation
 *  ladder here and count its rungs as submissions.
 *
 *  The escalation behaviour has its own suite — `useVsAiDriver-liveness.bot.test.ts`,
 *  which drives real projected boards through `computeExpectedInput` — so the
 *  tests in THIS file stop short of the deadline instead of asserting against it. */
const DRIVER_SETTLE_MS = 2000;
async function settleDriver() {
    await vi.advanceTimersByTimeAsync(DRIVER_SETTLE_MS);
}

const GAME = "game1" as Id<"games">;
const GAME2 = "game2" as Id<"games">;
const BOT = "u1-p2";
const HUMAN = "u1-p1";

const POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function player(id: string) {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { ...POOL },
    };
}

function botState(overrides: Record<string, unknown> = {}) {
    return {
        seq: 1,
        turn: 1,
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [player(BOT), player(HUMAN)],
        stack: [],
        ...overrides,
    };
}

describe("useVsAiDriver (issue #110)", () => {
    it("settles the decision path strictly inside the watchdog interval", () => {
        // Guards the helper above against a future tightening of either
        // constant: if the settle window ever reached the watchdog deadline,
        // every test in this file would silently start asserting against the
        // escalation ladder instead of the decision path.
        expect(DRIVER_SETTLE_MS).toBeLessThan(BOT_WATCHDOG_MS);
    });

    beforeEach(() => {
        calls.length = 0;
        queryMounts.length = 0;
        currentState = undefined;
        clearPublicStateOverride();
        forceNullTick = false;
        seatDeck = undefined;
        adapterCalls.length = 0;
        heldMutation = { active: false, release: undefined, fail: undefined };
        rejectMutation = { active: false, message: "" };
        forceUnrealisable = false;
        clearAiDecisions();
        vi.useFakeTimers();
        // Deterministic random pick (first move).
        vi.spyOn(Math, "random").mockReturnValue(0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ── The bot's OWN decklist reaches the search (issues #1509 / #2506) ────
    //
    // The driver reads it from `getSeatDeck` and hands it to the adapter as
    // `ownDeck`; the adapter rebuilds the bot's library with those identities
    // so fetch/tutor/draw subtrees search real cards. Every OTHER test in this
    // file leaves `seatDeck` undefined, so without these two nothing here ever
    // proved the wiring existed — and its failure mode is silent (the bot just
    // searches blanks again).
    //
    // The window must be a WORTHWHILE one (a land in hand): a trivial pass
    // short-circuits before `consultBrain`, so the search never rehydrates and
    // there is no `ownDeck` seam to observe at all.
    function botStateWithLibrary(count: number) {
        return botState({
            priorityPlayerId: BOT,
            players: [
                {
                    ...player(BOT),
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: BOT,
                            ownerId: BOT,
                            id: "land1",
                            zone: "hand",
                        }),
                    ],
                    library: { count },
                },
                player(HUMAN),
            ],
        });
    }

    it("feeds the bot's own getSeatDeck cards into the search adapter", async () => {
        seatDeck = {
            playerId: BOT,
            cards: [
                { cardId: MOUNTAIN, cardName: "Mountain" },
                { cardId: MOUNTAIN, cardName: "Mountain" },
                { cardId: BEARS, cardName: "Grizzly Bears" },
            ],
        };
        // Library count 2, deck 3: one Mountain is in hand, so the rebuilt
        // library is the deck MINUS what the bot can already see it holds.
        currentState = botStateWithLibrary(2);
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        const searched = searchAdapterCalls();
        expect(searched.length).toBeGreaterThan(0);
        expect(searched[0].ownDeck).toEqual({
            playerId: BOT,
            cardIds: [MOUNTAIN, MOUNTAIN, BEARS],
        });
        // …and the adapter actually USED it: the rebuilt library holds real
        // card identities, not placeholders.
        expect([...searched[0].libraries[BOT]].sort()).toEqual(
            [MOUNTAIN, BEARS].sort()
        );
    });

    it("falls back to a placeholder library when getSeatDeck answers null", async () => {
        // The silent-degradation case the widened stub used to hide: an
        // unowned seat / missing row is not an error anywhere on this path.
        seatDeck = null;
        currentState = botStateWithLibrary(2);
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        const searched = searchAdapterCalls();
        expect(searched.length).toBeGreaterThan(0);
        expect(searched[0].ownDeck).toBeUndefined();
        expect(searched[0].libraries[BOT]).toEqual([
            PLACEHOLDER_CARD_ID,
            PLACEHOLDER_CARD_ID,
        ]);
    });

    it("passes on the bot seat when the bot holds priority with no other move", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(calls[0].args).toEqual({ gameId: GAME, playerId: BOT });
    });

    it("does nothing when the human holds priority", async () => {
        currentState = botState({ priorityPlayerId: HUMAN });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();
        expect(calls).toHaveLength(0);
    });

    // Issue #1778: the driver holds the cheap `getGameTick` subscription
    // continuously, but must NOT mount the fat `getPublicState` subscription
    // (real args, not "skip") on a beat the bot does not own.
    it("never mounts getPublicState with real args while the human holds priority", async () => {
        currentState = botState({ priorityPlayerId: HUMAN });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(queryMounts.some((m) => m.ref === "getGameTick")).toBe(true);
        expect(queryMounts.some((m) => m.ref === "getPublicState")).toBe(false);
    });

    // Issue #1778: once the tick names the bot's own seat, the driver DOES
    // mount `getPublicState` and acts exactly once for that tick.
    it("mounts getPublicState and acts exactly once when the tick names the bot's seat", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(
            queryMounts.some(
                (m) =>
                    m.ref === "getPublicState" &&
                    (m.args as { playerId: string }).playerId === BOT
            )
        ).toBe(true);
        expect(calls).toHaveLength(1);
    });

    it("keeps a reasonable opening hand during the bot's mulligan window", async () => {
        // The keep/mull decision is the cheap gate heuristic (issue #145), not
        // the Worker search: a hand with >=1 land and >=1 spell is kept.
        const botSeat = player(BOT);
        botSeat.hand = [
            makeInstance(MOUNTAIN, {
                id: "m1",
                controllerId: BOT,
                zone: "hand",
            }),
            makeInstance(BEARS, { id: "b1", controllerId: BOT, zone: "hand" }),
        ] as never;
        currentState = botState({
            phase: "MULLIGAN",
            players: [botSeat, player(HUMAN)],
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: BOT,
                bottoming: false,
            },
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("declareMulligan");
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "keep",
        });
    });

    it("mulligans a zero-land opening hand", async () => {
        const botSeat = player(BOT);
        botSeat.hand = Array.from({ length: 7 }, (_, i) =>
            makeInstance(BEARS, {
                id: `b${i}`,
                controllerId: BOT,
                zone: "hand",
            })
        ) as never;
        currentState = botState({
            phase: "MULLIGAN",
            players: [botSeat, player(HUMAN)],
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: BOT,
                bottoming: false,
            },
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("declareMulligan");
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "mull",
        });
    });

    it("re-fires the opening mulligan after the game id swaps under a reused hook", async () => {
        // game.route renders <Board> UNKEYED by gameId, so starting a new game
        // (Restart Solo / rematch) swaps the gameId prop WITHOUT remounting the
        // driver hook. Its dedupe refs must reset on the new gameId, else the
        // prior game's recorded signature — at the SAME low seq the opening
        // mulligan always lands on — collides and silently suppresses the new
        // game's mulligan declaration (the reported freeze, fixed only by a
        // page refresh that remounts the hook).
        const handFor = (seat: ReturnType<typeof player>) => {
            seat.hand = [
                makeInstance(MOUNTAIN, {
                    id: "m1",
                    controllerId: BOT,
                    zone: "hand",
                }),
                makeInstance(BEARS, {
                    id: "b1",
                    controllerId: BOT,
                    zone: "hand",
                }),
            ] as never;
            return seat;
        };
        const mulliganState = (gameId: Id<"games">) =>
            botState({
                seq: 2, // both games' opening mulligan lands at the same low seq
                phase: "MULLIGAN",
                players: [handFor(player(BOT)), player(HUMAN)],
                mulligan: {
                    mulligansTaken: [0, 0],
                    declarations: [null, null],
                    locked: [false, false],
                    declaringPlayerId: BOT,
                    bottoming: false,
                },
                _gameId: gameId,
            });

        currentState = mulliganState(GAME);
        const { rerender } = renderHook(
            ({ gameId }) => useVsAiDriver(gameId, BOT),
            { initialProps: { gameId: GAME } }
        );
        await settleDriver();
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "keep",
        });

        // New game, same low seq, same reused hook instance.
        currentState = mulliganState(GAME2);
        rerender({ gameId: GAME2 });
        await settleDriver();

        expect(calls).toHaveLength(2);
        expect(calls[1].args).toEqual({
            gameId: GAME2,
            playerId: BOT,
            decision: "keep",
        });
    });

    // ADR 0091 decision 6 / issue #1209 — a realisation is ATOMIC. `inFlight`
    // used to be written ONLY by the Worker branch; every direct-mutation and
    // executor branch merely READ it. So each mutation in a multi-step
    // realisation bumped the state seq, re-fired the reactive effect, and let a
    // second decision interleave into a HALF-BUILT announcement — it worked only
    // because the interleaving decision happened to be the right one, and two
    // parks in one sequence (crew + mana spend) had no defined ordering at all.
    it("holds inFlight across a MULTI-STEP owed-payment realisation", async () => {
        // A two-victim filtered sacrifice park (CR 601.2f): the realisation is
        // two sequential `selectSacrifice` calls. THREE distinct creatures are
        // on the board, so the pick is a real choice the server would not
        // auto-resolve.
        const creature = (id: string, cardId: string) => ({
            ...makeInstance(cardId, { id, controllerId: BOT, ownerId: BOT }),
            card: { id: cardId },
        });
        const parked = (seq: number) =>
            botState({
                seq,
                priorityPlayerId: BOT,
                players: [
                    {
                        ...player(BOT),
                        battlefield: [
                            creature("c1", BEARS),
                            creature("c2", WURM),
                            creature("c3", BEARS),
                        ],
                    },
                    player(HUMAN),
                ],
                pendingActivation: {
                    playerId: BOT,
                    cardInstanceId: "c1",
                    abilityId: "a1",
                    manaCost: {},
                    tappedLandIds: [],
                    tapSource: false,
                    sacrificeSource: false,
                    sacrificeSelection: {
                        playerId: BOT,
                        reason: "Sacrifice",
                        requirements: [
                            { filter: { types: "Creature" }, count: 2 },
                        ],
                        picked: [],
                    },
                },
            });

        heldMutation = { active: true, release: undefined };
        currentState = parked(1);
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        // The first pick is in flight; the second has NOT been sent yet.
        expect(calls.map((c) => c.ref)).toEqual(["selectSacrifice"]);

        // The server bumps the seq on that first pick, re-firing the reactive
        // effect mid-sequence. Nothing new may be dispatched.
        currentState = parked(2);
        rerender();
        await settleDriver();
        expect(calls.map((c) => c.ref)).toEqual(["selectSacrifice"]);

        // Once the first pick settles the sequence continues on its own.
        heldMutation.active = false;
        heldMutation.release?.();
        await settleDriver();
        expect(calls.map((c) => c.ref)).toEqual([
            "selectSacrifice",
            "selectSacrifice",
        ]);
        expect(
            calls.map(
                (c) => (c.args as { cardInstanceId: string }).cardInstanceId
            )
        ).toEqual(["c1", "c3"]);
    });

    // The EXECUTOR branch had the same hole, and it is a DIFFERENT branch from
    // the Worker/setTimeout one at the bottom of the effect (which has always
    // written `inFlight`). It is reached only by an executor-realised
    // `BotAction` kind (`botActionRealisation(kind) === "executor"`: the
    // mulligan decisions and the ADR-0016 interactive choices) — never by
    // `pass` / `declare-attackers` / `search-choice`, which are Worker-realised.
    // Before this PR it recorded `lastSignature` and dispatched `executeMove`
    // WITHOUT ever writing `inFlight`, so a fresh seq arriving while the
    // realisation was still in flight produced a brand-new signature, sailed
    // past the dedupe, and dispatched a SECOND decision on top of a half-applied
    // one.
    //
    // The fixture drives a mulligan window (`keep` → executor), holds the
    // `declareMulligan` mutation pending, and then pushes a new seq that is
    // itself a legal decision point — so the ONLY thing that can suppress the
    // second dispatch is `inFlight`.
    it("holds inFlight across an executeMove realisation (executor branch)", async () => {
        const mulliganAt = (seq: number) => {
            const botSeat = player(BOT);
            botSeat.hand = [
                makeInstance(MOUNTAIN, {
                    id: "m1",
                    controllerId: BOT,
                    zone: "hand",
                }),
                makeInstance(BEARS, {
                    id: "b1",
                    controllerId: BOT,
                    zone: "hand",
                }),
            ] as never;
            return botState({
                seq,
                phase: "MULLIGAN",
                players: [botSeat, player(HUMAN)],
                mulligan: {
                    mulligansTaken: [0, 0],
                    declarations: [null, null],
                    locked: [false, false],
                    declaringPlayerId: BOT,
                    bottoming: false,
                },
            });
        };

        heldMutation = { active: true, release: undefined };
        currentState = mulliganAt(1);
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        // The realisation went through the executor branch — not the Worker one,
        // which never reaches `declareMulligan` (a mulligan window is decided by
        // the gate heuristic, issue #145) — and is now pending.
        expect(calls.map((c) => c.ref)).toEqual(["declareMulligan"]);

        // A new seq arrives while it is still in flight. The state is STILL a
        // legal decision point for the bot (the declaration hasn't landed), so
        // the dedupe cannot suppress it — only `inFlight` can.
        currentState = mulliganAt(2);
        rerender();
        await settleDriver();
        expect(calls.map((c) => c.ref)).toEqual(["declareMulligan"]);

        // And once it settles the guard releases: the same still-undecided
        // window at a further seq is driven again, so the test is asserting a
        // HELD guard, not a permanently wedged driver.
        heldMutation.active = false;
        heldMutation.release?.();
        await settleDriver();
        currentState = mulliganAt(3);
        rerender();
        await settleDriver();
        expect(calls.map((c) => c.ref)).toEqual([
            "declareMulligan",
            "declareMulligan",
        ]);
    });

    it("does not act when there is no bot seat", async () => {
        currentState = botState();
        renderHook(() => useVsAiDriver(GAME, null));
        await settleDriver();
        expect(calls).toHaveLength(0);
    });

    // Issue #113: a trivial priority pass skips the Worker + think beat and fires
    // passPriority IMMEDIATELY (no timer), so routine passes never stall.
    it("passes immediately, before any think beat, on a trivial window", () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        // No timer advanced: the pass must already have fired synchronously.
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    // Issue #113: a worthwhile window (a play available in the bot's main phase)
    // does NOT short-circuit — it waits for the think beat, then drives a move.
    it("defers to the search on a worthwhile window (no immediate pass)", async () => {
        currentState = botState({
            priorityPlayerId: BOT,
            players: [
                {
                    ...player(BOT),
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: BOT,
                            ownerId: BOT,
                            id: "land1",
                            zone: "hand",
                        }),
                    ],
                },
                player(HUMAN),
            ],
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        // Nothing fired synchronously: this window is searched, not insta-passed.
        expect(calls).toHaveLength(0);
        await settleDriver();
        // After the think beat the bot acts (the search picks a real move).
        expect(calls.length).toBeGreaterThan(0);
    });

    // Issue #1778 review finding 1/2 — the permanent-deadlock regression: the
    // player who owes a multi-blocker/banding combat-damage assignment
    // (CR 510.1c / 702.22j-k) is NOT necessarily `priorityPlayerId`.
    // `COMBAT_DAMAGE`/`FIRST_STRIKE_DAMAGE` entry sets
    // `priorityPlayerId = activePlayerId` regardless of who assigns
    // (`phases.ts`), and `setDamageAssignment`/`confirmDamage` gate with
    // `anyPlayer: true` precisely because the acting player differs. Here the
    // HUMAN is active and holds priority, but banding shifted the damage
    // assignment for `a1` to the BOT — the old `expectedInputPlayerId ===
    // botId` gate would never have named the bot and the game would hang
    // forever waiting for a `confirmDamage` that never comes.
    it("wakes the bot for a confirmDamage it owes even though the human holds priority", async () => {
        currentState = botState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: HUMAN,
            priorityPlayerId: HUMAN,
            combat: {
                attackerIds: ["a1"],
                confirmed: true,
                blockerAssignments: { b1: ["a1"] },
                blockersConfirmed: true,
                damageAssignments: { a1: { b1: 1 } },
                damageConfirmed: false,
                damageAssignerIds: { a1: BOT },
                damageAssignmentConfirmedBy: [],
            },
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("confirmDamage");
        expect(calls[0].args).toEqual({ gameId: GAME, playerId: BOT });
    });

    // Issue #1778 review finding 3 — the double-drive guard
    // (`botState.seq !== tick.seq`) had zero coverage: the old mock derived
    // the tick's `seq` straight off `currentState.seq`, the same value
    // `getPublicState` returned, so the two could never disagree and the
    // branch never ran. Here the tick (authoritative) has already advanced to
    // seq 2 while a freshly (re)mounted `getPublicState` still serves the
    // stale seq-1 snapshot — the driver must NOT act until `botState` catches
    // up to the tick that gated its mount.
    it("does not double-drive when getPublicState serves a stale snapshot behind a newer tick", async () => {
        const seq1 = botState({ priorityPlayerId: BOT, seq: 1 });
        const seq2 = botState({ priorityPlayerId: BOT, seq: 2 });

        currentState = seq2;
        setPublicStateOverride(seq1);
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();
        expect(calls).toHaveLength(0);

        // The subscription catches up to the tick it was gated on.
        setPublicStateOverride(seq2);
        rerender();
        await settleDriver();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    // Issue #1778 review finding 4 — a vs-AI game already in progress when
    // this feature deploys has no `gameTicks` row: `getGameTick` resolves to
    // `null` (a settled query with no row), not `undefined`. The driver must
    // fail OPEN (mount `getPublicState` anyway) rather than sit silent
    // forever if the bot happens to hold priority at deploy time.
    it("mounts getPublicState and acts when no gameTicks row exists yet (backfill fail-open)", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        forceNullTick = true;
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        // Fails OPEN: mounts the fat subscription despite the missing tick
        // row instead of staying silent forever.
        expect(
            queryMounts.some(
                (m) =>
                    m.ref === "getPublicState" &&
                    (m.args as { playerId: string }).playerId === BOT
            )
        ).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    // Issue #1778 review finding 5 — Care bullet 2 (does the bot visibly
    // stutter on a trivial immediate pass now that each pass costs a
    // `getPublicState` mount round-trip?). Models the real async gap: the
    // tick already names the bot, but the freshly-mounted `getPublicState`
    // subscription hasn't resolved on the FIRST render (mirrors Convex's
    // real "undefined until the subscription delivers" behavior, which the
    // rest of this file's synchronous mock otherwise papers over).
    it("does not flash the thinking indicator while getPublicState is still mounting behind a trivial pass", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        setPublicStateOverride(undefined);
        const { result, rerender } = renderHook(() => useVsAiDriver(GAME, BOT));

        // `botState` hasn't resolved yet — nothing can fire, and the "thinking"
        // indicator must not flip on merely because the mount is pending.
        expect(calls).toHaveLength(0);
        expect(result.current.thinking).toBe(false);

        // The subscription resolves.
        clearPublicStateOverride();
        rerender();
        await settleDriver();

        // A trivial pass short-circuits the Worker/think-beat entirely (issue
        // #113) — the mount round-trip must not introduce a visible "thinking"
        // flash for it.
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(result.current.thinking).toBe(false);
    });
    // ── Decision breadcrumbs (issue #2470) ──────────────────────────────────
    //
    // The bot runs in the reporter's own tab, so a decision that dies leaves no
    // server-side trace at all: #2450 arrived with a perfect board snapshot and
    // nothing about the decision that produced it. Every exit below must append
    // exactly one record, INCLUDING the healthy ones — a run of successes is
    // what tells a reader the Brain was answering and the passes were meant.

    it("records the trivial pass that never consulted the Brain", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        const records = getAiDecisions();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
            outcome: "skip-pass",
            expectedKind: "priority",
            phase: "PRECOMBAT_MAIN",
            seq: 1,
        });
        // No Worker was consulted, so the record must not claim one.
        expect(records[0].via).toBeUndefined();
    });

    it("records the consult's own verdict when the window IS searched", async () => {
        currentState = botState({
            priorityPlayerId: BOT,
            players: [
                {
                    ...player(BOT),
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: BOT,
                            ownerId: BOT,
                            id: "land1",
                            zone: "hand",
                        }),
                    ],
                },
                player(HUMAN),
            ],
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        // jsdom has no Worker, so the consult ran through the inline fallback —
        // the same handler, reported as such.
        const consult = getAiDecisions().find((d) => d.outcome === "move");
        expect(consult).toBeDefined();
        expect(consult).toMatchObject({ via: "inline", moveKind: "play-land" });
        // A healthy consult carries no failure text.
        expect(consult!.message).toBeUndefined();
    });

    it("records a submission the server rejected", async () => {
        rejectMutation = { active: true, message: "not your priority" };
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        const rejected = getAiDecisions().find(
            (d) => d.outcome === "submit-error"
        );
        expect(rejected).toBeDefined();
        expect(rejected).toMatchObject({
            moveKind: "pass",
            message: "not your priority",
        });
    });

    /** The bot's own mulligan window — a NON-search realisation (the keep/mull
     *  declaration is the cheap gate heuristic, issue #145), i.e. the branch
     *  review finding 1 found uninstrumented. */
    function mulliganState() {
        const botSeat = player(BOT);
        botSeat.hand = [
            makeInstance(MOUNTAIN, {
                id: "m1",
                controllerId: BOT,
                zone: "hand",
            }),
            makeInstance(BEARS, { id: "b1", controllerId: BOT, zone: "hand" }),
        ] as never;
        return botState({
            phase: "MULLIGAN",
            players: [botSeat, player(HUMAN)],
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: BOT,
                bottoming: false,
            },
        });
    }

    // Review finding 1: the direct/executor realisation branch — the exit taken
    // by the MAJORITY of BotAction kinds (`botActionRealisation` routes only
    // five to the Worker) — recorded nothing at all in the first pass.
    it("records a non-search realisation", async () => {
        currentState = mulliganState();
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        const direct = getAiDecisions().find((d) => d.outcome === "direct");
        expect(direct).toBeDefined();
        // The BotAction kind, not a Move kind: this exit never reached a Move.
        expect(direct!.actionKind).toBeDefined();
        expect(direct!.moveKind).toBeUndefined();
    });

    // Review finding 1, second half: the bot decided, `realiseBotAction`
    // produced no runner, and NOTHING was submitted. Without this record the
    // ring shows the previous decision, a gap, then escalation rungs — the
    // "died leaving no trace" shape the ring exists to remove.
    it("records a decision that realised into nothing", async () => {
        forceUnrealisable = true;
        currentState = mulliganState();
        renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();

        expect(calls).toHaveLength(0);
        expect(getAiDecisions().some((d) => d.outcome === "unrealisable")).toBe(
            true
        );
    });

    // Review finding 4: `note` used to fire BEFORE `dispatch`'s in-flight
    // guard, so a suppressed dispatch still appended a record — the ring
    // claimed answers the bot never submitted, a lie in the "looks healthy"
    // direction.
    it("records nothing for a dispatch the in-flight guard suppresses", async () => {
        heldMutation = { active: true, release: undefined };
        currentState = botState({ seq: 1, priorityPlayerId: BOT });
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();
        expect(getAiDecisions()).toHaveLength(1);

        // The first submission never settles; a new state version arrives.
        currentState = botState({ seq: 2, priorityPlayerId: BOT });
        rerender();
        await settleDriver();

        // Still one: the second dispatch was suppressed, so it is not an answer.
        expect(getAiDecisions()).toHaveLength(1);
        expect(calls).toHaveLength(1);
    });

    // Review round 3 — a `submit-error` breadcrumb fires from a promise
    // rejection that can land long after the submission, by which time the
    // board has moved on. A record whose `seq` names a version the decision was
    // never made against cannot be lined up with the snapshot beside it, which
    // is the entire job of that field.
    it("records a rejection at the version it was SUBMITTED on, not the latest", async () => {
        heldMutation = { active: true, release: undefined, fail: undefined };
        currentState = botState({ seq: 1, priorityPlayerId: BOT });
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await settleDriver();
        expect(calls).toHaveLength(1);

        // The board advances while the submission is still in flight.
        currentState = botState({ seq: 2, priorityPlayerId: BOT });
        rerender();
        await settleDriver();

        // …and only THEN does the server reject it.
        heldMutation.fail!("not your priority");
        await settleDriver();

        const rejected = getAiDecisions().find(
            (d) => d.outcome === "submit-error"
        );
        expect(rejected).toBeDefined();
        expect(rejected!.seq).toBe(1);
    });
});
