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
// assigner differs from `priorityPlayerId` (banding, CR 702.21j-k) exercises
// the same gate the server actually applies (review finding 2: the old mock
// baked in `expectedInputPlayerId: s.priorityPlayerId`, which is exactly the
// assumption finding 1 proved false).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { getCardByName } from "@convex/cards";
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
// When active, every mutation returns a promise that only settles once
// `heldMutation.release()` is called (issue #1209).
let heldMutation: { active: boolean; release?: () => void } = {
    active: false,
    release: undefined,
};

// Tag each mutation/query by a plain string so assertions never touch Convex's
// FunctionReference proxies (which throw on primitive coercion in the matcher).
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            getPublicState: "getPublicState",
            getGameTick: "getGameTick",
            getGame: "getGame",
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
        // issue #1509 — the driver now also queries `getGame` to source the
        // bot's own decklist (ownDeck). These tests don't exercise ownDeck,
        // so return undefined for it: ownDeck stays undefined and the driver
        // behaves exactly as pre-#1509 (placeholder library path).
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
            return new Promise<null>((resolve) => {
                heldMutation.release = () => resolve(null);
            });
        }
        return Promise.resolve(null);
    },
}));

// Imported after the mocks so the hook picks up the mocked transport.
const { useVsAiDriver } = await import("../useVsAiDriver");

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
    beforeEach(() => {
        calls.length = 0;
        queryMounts.length = 0;
        currentState = undefined;
        clearPublicStateOverride();
        forceNullTick = false;
        heldMutation = { active: false, release: undefined };
        vi.useFakeTimers();
        // Deterministic random pick (first move).
        vi.spyOn(Math, "random").mockReturnValue(0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("passes on the bot seat when the bot holds priority with no other move", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(calls[0].args).toEqual({ gameId: GAME, playerId: BOT });
    });

    it("does nothing when the human holds priority", async () => {
        currentState = botState({ priorityPlayerId: HUMAN });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });

    // Issue #1778: the driver holds the cheap `getGameTick` subscription
    // continuously, but must NOT mount the fat `getPublicState` subscription
    // (real args, not "skip") on a beat the bot does not own.
    it("never mounts getPublicState with real args while the human holds priority", async () => {
        currentState = botState({ priorityPlayerId: HUMAN });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();

        expect(queryMounts.some((m) => m.ref === "getGameTick")).toBe(true);
        expect(queryMounts.some((m) => m.ref === "getPublicState")).toBe(false);
    });

    // Issue #1778: once the tick names the bot's own seat, the driver DOES
    // mount `getPublicState` and acts exactly once for that tick.
    it("mounts getPublicState and acts exactly once when the tick names the bot's seat", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "keep",
        });

        // New game, same low seq, same reused hook instance.
        currentState = mulliganState(GAME2);
        rerender({ gameId: GAME2 });
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();

        // The first pick is in flight; the second has NOT been sent yet.
        expect(calls.map((c) => c.ref)).toEqual(["selectSacrifice"]);

        // The server bumps the seq on that first pick, re-firing the reactive
        // effect mid-sequence. Nothing new may be dispatched.
        currentState = parked(2);
        rerender();
        await vi.runAllTimersAsync();
        expect(calls.map((c) => c.ref)).toEqual(["selectSacrifice"]);

        // Once the first pick settles the sequence continues on its own.
        heldMutation.active = false;
        heldMutation.release?.();
        await vi.runAllTimersAsync();
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

    it("holds inFlight across a MULTI-STEP executeMove realisation", async () => {
        // The executor branch had the same hole: it read `inFlight` but never
        // wrote it, so a `playCard` mid-sequence could be joined by a second
        // decision off the seq it produced.
        heldMutation = { active: true, release: undefined };
        currentState = botState({
            seq: 1,
            priorityPlayerId: BOT,
            players: [
                {
                    ...player(BOT),
                    hand: [
                        {
                            ...makeInstance(MOUNTAIN, {
                                id: "land1",
                                controllerId: BOT,
                                ownerId: BOT,
                                zone: "hand",
                            }),
                            card: { id: MOUNTAIN },
                        },
                    ],
                },
                player(HUMAN),
            ],
        });
        const { rerender } = renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();
        const first = calls.length;
        expect(first).toBe(1);

        currentState = botState({ seq: 2, priorityPlayerId: BOT });
        rerender();
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(first);
    });

    it("does not act when there is no bot seat", async () => {
        currentState = botState();
        renderHook(() => useVsAiDriver(GAME, null));
        await vi.runAllTimersAsync();
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
        await vi.runAllTimersAsync();
        // After the think beat the bot acts (the search picks a real move).
        expect(calls.length).toBeGreaterThan(0);
    });

    // Issue #1778 review finding 1/2 — the permanent-deadlock regression: the
    // player who owes a multi-blocker/banding combat-damage assignment
    // (CR 510.1c / 702.21j-k) is NOT necessarily `priorityPlayerId`.
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
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);

        // The subscription catches up to the tick it was gated on.
        setPublicStateOverride(seq2);
        rerender();
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();

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
        await vi.runAllTimersAsync();

        // A trivial pass short-circuits the Worker/think-beat entirely (issue
        // #113) — the mount round-trip must not introduce a visible "thinking"
        // flash for it.
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(result.current.thinking).toBe(false);
    });
});
