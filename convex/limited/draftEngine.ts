// Pure Draft engine (PRD #1107 stories 10-16, ADR 0054/0055, issue #1112):
// classic booster draft — pick one card, pass the rest, packs rotate
// left/right/left across boosters, per-seat incoming-pack queues so a fast
// seat isn't serialized on a slow one. Mirrors `eventLogic.ts`'s discipline —
// every decision is a plain function of plain data, unit-testable without a
// convex-test harness, so `convex/limitedEvents.ts`'s `startLimitedEvent` /
// `submitPick` mutations stay thin DB-read/write shells around it.
import { generateBooster } from "./boosterGenerator";
import { makeRng } from "../gre/rng";
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

/** Result of the initial round-0 deal at `startLimitedEvent`. */
export interface StartDraftResult {
    seats: LimitedEventSeat[];
    draftRound: number;
    draftPacksRemaining: number;
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
    resolveCardMeta: ResolveCardMeta
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
    return {
        seats: seats.map((seat, i) => ({
            ...seat,
            pool: [],
            currentPack: packs[i],
            packQueue: [],
        })),
        draftRound: 0,
        draftPacksRemaining: seats.length,
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
    resolveCardMeta: ResolveCardMeta
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
    };

    let packsRemaining = draftPacksRemaining;
    let round = draftRound;

    if (remaining.length > 0) {
        const targetIndex =
            (((seatIndex + passDirection(round)) % seatCount) + seatCount) %
            seatCount;
        const target = nextSeats[targetIndex];
        if (!target.currentPack) {
            nextSeats[targetIndex] = { ...target, currentPack: remaining };
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
        nextSeats[seatIndex] = {
            ...seatAfterPass,
            currentPack: next,
            packQueue: restQueue,
        };
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
            nextSeats = nextSeats.map((s, i) => ({
                ...s,
                currentPack: packs[i],
                packQueue: [],
            }));
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
    alreadyCompleted = false
): RunBotAutoPicksResult {
    let curSeats: readonly LimitedEventSeat[] = seats;
    let round = draftRound;
    let remaining = draftPacksRemaining;
    let completed = alreadyCompleted;

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
            resolveCardMeta
        );
        curSeats = result.seats;
        round = result.draftRound;
        remaining = result.draftPacksRemaining;
        completed = result.completed;

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
    };
}
