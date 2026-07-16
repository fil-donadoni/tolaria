// Pure Draft engine (PRD #1107 stories 10-16, ADR 0054/0055, issue #1112):
// classic booster draft — pick one card, pass the rest, packs rotate
// left/right/left across boosters, per-seat incoming-pack queues so a fast
// seat isn't serialized on a slow one. Mirrors `eventLogic.ts`'s discipline —
// every decision is a plain function of plain data, unit-testable without a
// convex-test harness, so `convex/limitedEvents.ts`'s `startLimitedEvent` /
// `submitPick` mutations stay thin DB-read/write shells around it.
import { generateBooster } from "./boosterGenerator";
import { makeRng } from "../gre/rng";
import { pickTimerSecondsForCardsRemaining } from "./pickTimerSchedule";
import type { GetBoosterConfig, ResolveCardMeta } from "./eventLogic";
import type { DraftPackCard, LimitedEventSeat } from "./eventTypes";

/** Pass direction alternates every booster round (PRD #1107 story 12: "left,
 *  then right, then left"). Round 0 passes "left" (+1 seat index, mod seat
 *  count), round 1 "right" (-1), round 2 "left" again, and so on — the
 *  left/right table-direction labels are an arbitrary but fixed convention
 *  (not CR-governed; classic booster draft doesn't dictate which physical
 *  direction is "left"), so any number of rounds alternates correctly. */
export function passDirection(round: number): 1 | -1 {
    return round % 2 === 0 ? 1 : -1;
}

/** Derives a round-scoped RNG seed from the event's stored seed. Booster
 *  generation for round 0 happens at `startLimitedEvent`; rounds 1+ happen
 *  later, inside whichever `submitPick` call empties the last pack of the
 *  current round — a separate mutation invocation with no persisted RNG
 *  stream position. Deriving the round's seed from `(eventSeed, round)`
 *  keeps the whole draft reproducible from the one seed stored on the event
 *  row without threading mutable counter state across calls. */
export function roundSeed(eventSeed: number, round: number): number {
    return (eventSeed + round * 0x9e3779b1) | 0;
}

/** Generates one fresh booster round: `seatCount` packs, one opened per seat,
 *  from `setCode`'s Booster Config. Every drawn card gets a `pickId` unique
 *  within the event (`r<round>-p<originSeat>-c<cardIndex>`) so `applyPick`
 *  can target an exact physical card even when a pack holds two copies of the
 *  same print. */
function generateRoundPacks(
    seatCount: number,
    setCode: string,
    getConfig: GetBoosterConfig,
    resolveCardMeta: ResolveCardMeta,
    seed: number,
    round: number
): DraftPackCard[][] {
    const config = getConfig(setCode);
    if (!config) {
        throw new Error(
            `generateRoundPacks: no Booster Config for set "${setCode}"`
        );
    }
    const rng = makeRng(seed);
    return Array.from({ length: seatCount }, (_, seatIdx) =>
        generateBooster(config, rng).map((drawn, cardIdx) => {
            const meta = resolveCardMeta(drawn.scryfallId);
            return {
                scryfallId: drawn.scryfallId,
                cardId: meta?.cardId ?? drawn.scryfallId,
                cardName: meta?.cardName ?? drawn.scryfallId,
                pickId: `r${round}-p${seatIdx}-c${cardIdx}`,
            };
        })
    );
}

/** Per-pick timer config (issue #1114, PRD #1107 stories 5/14; ADR 0060 /
 *  issue #1243 replaced the fixed `timerSeconds` with the descending
 *  schedule): threaded through `startDraft`/`applyPick`/`runBotAutoPicks` as
 *  a single optional trailing parameter so every existing call site with no
 *  timer configured compiles and behaves byte-identically (no
 *  `pickDeadline`/`pickSeq` fields are ever written when this is omitted).
 *  `now` is captured ONCE by the mutation shell at the top of the call
 *  (`Date.now()`) and threaded through every pure call in that invocation, so
 *  every deadline stamped within the same mutation shares one time
 *  reference — never re-read mid-computation. The per-pick SECONDS value is
 *  no longer carried here at all: it's computed fresh for every stamped pack
 *  from `pickTimerSecondsForCardsRemaining(pack.length)` (see
 *  `assignFreshPack`), which is what makes a sub-15 pack (ARN/ATQ = 8 cards)
 *  "just work" against the same table with no separate scaling. */
export interface TimerConfig {
    /** Epoch ms "now" for this call — a deadline is `now + seconds * 1000`,
     *  where `seconds` comes from the descending schedule. */
    now: number;
}

/** One seat whose `currentPack` was freshly assigned this call, timer-on
 *  (issue #1114) — the mutation shell schedules exactly one
 *  `ctx.scheduler.runAfter` Auto-Pick timeout per entry, carrying `pickSeq`
 *  as the value `autoPickSeatTimeout` must still match when it fires, and
 *  `pickDeadline` (issue #1243) so the shell can compute THIS entry's own
 *  delay — no longer a single shared `timerSeconds` for the whole event. */
export interface SeatTimerUpdate {
    seatIndex: number;
    pickSeq: number;
    pickDeadline: number;
}

/** Stamps a seat that just received `pack` as its fresh `currentPack` (dealt
 *  or passed in) with a new Auto-Pick deadline, when timer-on
 *  (`timerConfig` present) and the seat is human (a Bot Drafter never idles
 *  on a pack — `runBotAutoPicks` always resolves it within the same call, so
 *  stamping one would be dead state). The per-pick seconds come from the
 *  descending schedule (ADR 0060, issue #1243), indexed by `pack.length`
 *  (cards remaining) — NOT a fixed per-event value. Returns the stamped seat
 *  and, only when a schedule is actually needed, a `SeatTimerUpdate` for the
 *  mutation shell to act on. Timer-off (`timerConfig` undefined) writes
 *  NEITHER field, so a timer-off event's seats stay byte-identical to
 *  pre-#1114 shape.
 *
 *  When the schedule returns `null` ("auto" — 1 card remaining, no real
 *  choice left to time) `pickSeq` is still bumped (invalidating any pending
 *  schedule from the seat's PREVIOUS pack) but no deadline is stamped and no
 *  `SeatTimerUpdate` is returned — the seat shows no countdown and nothing is
 *  scheduled for it; the player still submits the final pick manually. */
function assignFreshPack(
    seat: LimitedEventSeat,
    pack: DraftPackCard[],
    timerConfig: TimerConfig | undefined
): { seat: LimitedEventSeat; update?: SeatTimerUpdate } {
    if (!timerConfig || seat.isBot) {
        return { seat: { ...seat, currentPack: pack } };
    }
    const pickSeq = (seat.pickSeq ?? 0) + 1;
    const seconds = pickTimerSecondsForCardsRemaining(pack.length);
    if (seconds === null) {
        return {
            seat: {
                ...seat,
                currentPack: pack,
                pickSeq,
                pickDeadline: undefined,
            },
        };
    }
    const pickDeadline = timerConfig.now + seconds * 1000;
    return {
        seat: { ...seat, currentPack: pack, pickSeq, pickDeadline },
        update: { seatIndex: seat.seatIndex, pickSeq, pickDeadline },
    };
}

/** Result of the initial round-0 deal at `startLimitedEvent`. */
export interface StartDraftResult {
    seats: LimitedEventSeat[];
    draftRound: number;
    draftPacksRemaining: number;
    /** Timer-on events only (issue #1114): one entry per human seat whose
     *  round-0 pack the mutation shell must schedule an Auto-Pick timeout
     *  for. Empty when `timerConfig` was omitted. */
    timerUpdates: SeatTimerUpdate[];
}

/** Deals round 0: every seat opens one Booster from `packSlots[0]` and it
 *  becomes that seat's `currentPack` (nobody starts with a queue). Throws if
 *  `packSlots` is empty or references an unresolvable set — a Draft can't
 *  start with no Pack Source, mirroring `generateSealedPools`. */
export function startDraft(
    seats: readonly LimitedEventSeat[],
    packSlots: readonly string[],
    eventSeed: number,
    getConfig: GetBoosterConfig,
    resolveCardMeta: ResolveCardMeta,
    timerConfig?: TimerConfig
): StartDraftResult {
    if (packSlots.length === 0) {
        throw new Error("startDraft: packSlots is empty");
    }
    const packs = generateRoundPacks(
        seats.length,
        packSlots[0],
        getConfig,
        resolveCardMeta,
        roundSeed(eventSeed, 0),
        0
    );
    const timerUpdates: SeatTimerUpdate[] = [];
    const nextSeats = seats.map((seat, i) => {
        const { seat: stamped, update } = assignFreshPack(
            { ...seat, pool: [], packQueue: [] },
            packs[i],
            timerConfig
        );
        if (update) timerUpdates.push(update);
        return stamped;
    });
    return {
        seats: nextSeats,
        draftRound: 0,
        draftPacksRemaining: seats.length,
        timerUpdates,
    };
}

/** Result of applying one Pick. */
export interface ApplyPickResult {
    seats: LimitedEventSeat[];
    draftRound: number;
    draftPacksRemaining: number;
    /** True the instant the very last pack of the very last round empties —
     *  every seat's Pool is final (`packSlots.length * boosterSize` cards). */
    completed: boolean;
    /** Timer-on events only (issue #1114): one entry per human seat that just
     *  received a freshly-assigned `currentPack` this call (the pass target,
     *  the picker's own dequeued pack, or every seat on a round advance) — the
     *  mutation shell schedules one Auto-Pick timeout per entry. Empty when
     *  `timerConfig` was omitted. */
    timerUpdates: SeatTimerUpdate[];
}

/** Applies one Pick at `seatIndex`, targeting the card `pickId` in that
 *  seat's `currentPack` (CR: N/A — not a CR-governed rule, a house/tournament
 *  convention). Validates the seat actually holds a non-empty `currentPack`
 *  and that `pickId` is present in it — both are also checked by the
 *  `submitPick` mutation shell (ownership: `seatIndex` is server-derived from
 *  the caller's `userId`, never client-supplied), but the engine re-asserts
 *  them so it is safe to unit-test / reuse standalone.
 *
 *  Passing: the remaining pack (Booster minus the picked card) goes to the
 *  seat `passDirection(draftRound)` away. If that seat's `currentPack` is
 *  free, the pack becomes its `currentPack` immediately; otherwise it queues
 *  behind whatever that seat is still working through (PRD #1107 story 13).
 *  When the picking seat's OWN queue is non-empty, the next queued pack
 *  immediately becomes its `currentPack` (no seat sits idle with packs
 *  waiting).
 *
 *  Round advancement: `draftPacksRemaining` counts packs of the current round
 *  not yet emptied; when it reaches 0, either the next round's boosters are
 *  dealt (mirrors `startDraft`, seeded from `(eventSeed, nextRound)`) or —if
 *  this was the last round in `packSlots`— the draft is `completed`. */
export function applyPick(
    seats: readonly LimitedEventSeat[],
    draftRound: number,
    draftPacksRemaining: number,
    packSlots: readonly string[],
    seatIndex: number,
    pickId: string,
    eventSeed: number,
    getConfig: GetBoosterConfig,
    resolveCardMeta: ResolveCardMeta,
    timerConfig?: TimerConfig
): ApplyPickResult {
    const seatCount = seats.length;
    const seat = seats[seatIndex];
    if (!seat) {
        throw new Error("applyPick: invalid seat index");
    }
    const pack = seat.currentPack;
    if (!pack || pack.length === 0) {
        throw new Error("You have no pack to pick from right now.");
    }
    const pickedIdx = pack.findIndex((c) => c.pickId === pickId);
    if (pickedIdx === -1) {
        throw new Error("That card is not in your current pack.");
    }
    const picked = pack[pickedIdx];
    const remaining = pack.filter((_, i) => i !== pickedIdx);
    const timerUpdates: SeatTimerUpdate[] = [];

    let nextSeats = seats.map((s) => ({ ...s }));
    nextSeats[seatIndex] = {
        ...nextSeats[seatIndex],
        pool: [
            ...(nextSeats[seatIndex].pool ?? []),
            {
                scryfallId: picked.scryfallId,
                cardId: picked.cardId,
                cardName: picked.cardName,
            },
        ],
        currentPack: undefined,
        // Nothing is timed for this seat until it either dequeues its own
        // next pack below or receives a fresh one later — clear any stale
        // deadline so the UI never shows a countdown with no pack behind it.
        ...(timerConfig ? { pickDeadline: undefined } : {}),
    };

    let packsRemaining = draftPacksRemaining;
    let round = draftRound;

    if (remaining.length > 0) {
        const targetIndex =
            (((seatIndex + passDirection(round)) % seatCount) + seatCount) %
            seatCount;
        const target = nextSeats[targetIndex];
        if (!target.currentPack) {
            const { seat: stamped, update } = assignFreshPack(
                target,
                remaining,
                timerConfig
            );
            nextSeats[targetIndex] = stamped;
            if (update) timerUpdates.push(update);
        } else {
            nextSeats[targetIndex] = {
                ...target,
                packQueue: [...(target.packQueue ?? []), remaining],
            };
        }
    } else {
        packsRemaining -= 1;
    }

    // Dequeue the picking seat's own next pack, if one was already waiting.
    const seatAfterPass = nextSeats[seatIndex];
    if (
        !seatAfterPass.currentPack &&
        seatAfterPass.packQueue &&
        seatAfterPass.packQueue.length > 0
    ) {
        const [next, ...restQueue] = seatAfterPass.packQueue;
        const { seat: stamped, update } = assignFreshPack(
            { ...seatAfterPass, packQueue: restQueue },
            next,
            timerConfig
        );
        nextSeats[seatIndex] = stamped;
        if (update) timerUpdates.push(update);
    }

    let completed = false;
    if (packsRemaining === 0) {
        if (round < packSlots.length - 1) {
            round += 1;
            const packs = generateRoundPacks(
                seatCount,
                packSlots[round],
                getConfig,
                resolveCardMeta,
                roundSeed(eventSeed, round),
                round
            );
            nextSeats = nextSeats.map((s, i) => {
                const { seat: stamped, update } = assignFreshPack(
                    { ...s, packQueue: [] },
                    packs[i],
                    timerConfig
                );
                if (update) timerUpdates.push(update);
                return stamped;
            });
            packsRemaining = seatCount;
        } else {
            completed = true;
        }
    }

    return {
        seats: nextSeats,
        draftRound: round,
        draftPacksRemaining: packsRemaining,
        completed,
        timerUpdates,
    };
}

/** Chooses which card a Bot Drafter seat picks from its `currentPack` (issue
 *  #1113, ADR 0054). Injected — like `GetBoosterConfig`/`ResolveCardMeta` —
 *  so this module stays decoupled from the concrete Pick Heuristic
 *  (`convex/limited/botDrafter.ts`'s `chooseBotPick`), which owns the actual
 *  scoring. Returns the `pickId` of the card to take from `pack`. */
export type ChooseBotPick = (
    seat: LimitedEventSeat,
    pack: readonly DraftPackCard[]
) => string;

/** Result of running every pending Bot Drafter pick to exhaustion. */
export interface RunBotAutoPicksResult {
    seats: LimitedEventSeat[];
    draftRound: number;
    draftPacksRemaining: number;
    completed: boolean;
    /** Timer-on events only (issue #1114): every human seat that received a
     *  freshly-assigned `currentPack` as a side effect of a bot pick (e.g. a
     *  bot passes its leftover pack onto a human neighbor, or a bot pick
     *  empties the round and the next one deals straight into human seats
     *  too) — accumulated across every `applyPick` call this loop makes. */
    timerUpdates: SeatTimerUpdate[];
}

/** Safety bound on the auto-pick loop below — comfortably above any real
 *  event's total pick count (8 seats × 3 rounds × a ~15-card Booster ≈ 360
 *  picks at the observed high end). Existing only so a future bug in the
 *  pass-direction/queue bookkeeping surfaces as a loud thrown error instead
 *  of a silent infinite loop hanging the mutation. */
const MAX_AUTO_PICK_ITERATIONS = 10_000;

/** Runs every Bot Drafter seat's pick to exhaustion (PRD #1107 stories 8, 9,
 *  27: "a pack reaches a bot seat, the pick happens server-side... a draft
 *  never stalls waiting for missing humans"). Repeatedly finds ANY bot seat
 *  currently holding a non-empty `currentPack`, asks `chooseBotPick` which
 *  card it takes, and applies it via `applyPick` — exactly the same path a
 *  human `submitPick` drives, so a bot pick advances the queue/round/pass
 *  bookkeeping identically. Stops when no bot seat has a pack to pick from
 *  (every remaining pending pack, if any, belongs to a human seat waiting on
 *  a real player) or the draft completes.
 *
 *  Called once right after `startDraft` deals round 0 (so an all-bot or
 *  mixed-seat Draft never leaves a bot's very first pack sitting unpicked)
 *  and once after every human `submitPick` (a human's pick can pass a pack
 *  onto a bot seat, or empty the round and deal a fresh one straight into
 *  bot seats) — both call sites in `convex/limitedEvents.ts`.
 *
 *  `alreadyCompleted` carries forward the `completed` flag the caller's OWN
 *  `applyPick` call may already have produced (a human's pick can itself be
 *  the very last pick of the whole draft). Without it, a draft finishing on
 *  a human pick would have its `completed: true` silently dropped here: the
 *  loop below finds no bot with a pending pack (correctly — the draft is
 *  over) and would otherwise return `completed: false` regardless. */
export function runBotAutoPicks(
    seats: readonly LimitedEventSeat[],
    draftRound: number,
    draftPacksRemaining: number,
    packSlots: readonly string[],
    eventSeed: number,
    getConfig: GetBoosterConfig,
    resolveCardMeta: ResolveCardMeta,
    chooseBotPick: ChooseBotPick,
    alreadyCompleted = false,
    timerConfig?: TimerConfig
): RunBotAutoPicksResult {
    let curSeats: readonly LimitedEventSeat[] = seats;
    let round = draftRound;
    let remaining = draftPacksRemaining;
    let completed = alreadyCompleted;
    const timerUpdates: SeatTimerUpdate[] = [];

    for (let i = 0; i < MAX_AUTO_PICK_ITERATIONS; i++) {
        if (completed) break;
        const seatIndex = curSeats.findIndex(
            (s) => s.isBot && s.currentPack && s.currentPack.length > 0
        );
        if (seatIndex === -1) break;

        const seat = curSeats[seatIndex];
        const pickId = chooseBotPick(seat, seat.currentPack!);
        const result = applyPick(
            curSeats,
            round,
            remaining,
            packSlots,
            seatIndex,
            pickId,
            eventSeed,
            getConfig,
            resolveCardMeta,
            timerConfig
        );
        curSeats = result.seats;
        round = result.draftRound;
        remaining = result.draftPacksRemaining;
        completed = result.completed;
        timerUpdates.push(...result.timerUpdates);

        if (i === MAX_AUTO_PICK_ITERATIONS - 1) {
            throw new Error(
                "runBotAutoPicks: exceeded the auto-pick iteration bound — likely an infinite loop in pass/queue bookkeeping."
            );
        }
    }

    return {
        seats: [...curSeats],
        draftRound: round,
        draftPacksRemaining: remaining,
        completed,
        timerUpdates,
    };
}

/** Checks whether a scheduled Auto-Pick timeout (issue #1114) is still valid
 *  to apply — the seq-based cancellation guard (see `SeatTimerUpdate`'s doc
 *  comment). Returns the `pickId` to Auto-Pick with, chosen via the SAME
 *  `chooseBotPick` a real Bot Drafter seat uses (PRD #1107 story 14: "an
 *  expired timer Auto-Picks with the bot engine, never randomly" — the
 *  acceptance criterion this directly satisfies), or `null` when the
 *  schedule is stale and must be a no-op:
 *
 *  - the seat no longer exists (out-of-range index — defensive only),
 *  - `expectedSeq` no longer matches the seat's LIVE `pickSeq` (a human pick,
 *    or an earlier Auto-Pick, already superseded this schedule),
 *  - the seat currently has nothing to pick from (should be unreachable
 *    given a matching `pickSeq`, but never assumed away), or
 *  - the seat is a Bot Drafter (defensive: bots are never scheduled, but a
 *    stray schedule must never auto-pick a seat nobody is late on). */
export function resolveAutoPickTimeout(
    seats: readonly LimitedEventSeat[],
    seatIndex: number,
    expectedSeq: number,
    chooseBotPick: ChooseBotPick
): string | null {
    const seat = seats[seatIndex];
    if (!seat || seat.isBot) return null;
    if ((seat.pickSeq ?? 0) !== expectedSeq) return null;
    if (!seat.currentPack || seat.currentPack.length === 0) return null;
    return chooseBotPick(seat, seat.currentPack);
}
