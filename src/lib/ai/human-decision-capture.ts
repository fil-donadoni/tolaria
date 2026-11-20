// The human seat's decisions in a vs-Bot game, kept for the game-end Verdict
// Proposal sample (issue #3984, GLOSSARY.md § Verdict Proposal).
//
// RECORD NOW, JUDGE AT GAME END. During play this store only REMEMBERS: the
// seat's own view at each decision (the `AiTraceSource` shape the verdict quiz
// already lowers from) and the mutations the player submitted until their next
// decision. Nothing here consults the Brain, runs a search or enumerates a move
// — the cost a player pays mid-game is one array push, plus a fire-and-forget
// storage write of the rows that changed.
//
// Client-side by design, and never authoritative (ADR 0074): a proposal is a
// QUESTION, not game state. Nothing reaches the server.
//
// RELOAD-SAFE. Every change is written through to client
// storage (`verdict-proposal-persistence.ts`, best-effort), and a capture
// started for the SAME game and seat rehydrates from it: the kept decisions,
// the open decision and its calls, and the reservoir's state (`closed`, the
// sampling stream's position) — so a reload mid-game resumes the capture where
// it stood and a reload after the game still has decisions to take. Reading
// storage is async; whatever the seat does meanwhile is applied provisionally
// and replayed on the rehydrated state (`humanCaptureReady` resolves then). A
// capture for another game drops the previous game's stored decisions.
//
// HIDDEN INFORMATION. A captured source is the deciding seat's view and
// nothing else: its own projection (the server already hid the opponent's hand
// in it) and its OWN decklist as deck knowledge, never the opponent's — even
// though the vs-Bot driver holds both seats' lists. `captureHumanDecision`
// refuses a projection that was made for another viewer, which is the one way
// a wiring slip could hand the Brain the Bot's hand.
//
// BOUNDED. A game keeps at most `captureLimit` decisions, chosen by reservoir
// sampling over the whole game — a long game is sampled evenly rather than cut
// off after its opening, where the decisions are land drops and nothing else.
//
// THE PLAYER'S OWN WORDS. Beside the
// decisions the capture keeps what the player SAID while playing: Plan
// statements (`stateHumanPlan`, one stands until the seat states another) and
// a per-decision annotation (`annotateHumanDecision`): a comment in their own
// words, or the one-gesture "obvious" mark. Each is tied to the game and the
// `seq` of the state it was made on, and persisted with the decisions, so a
// reload keeps them. A COMMENTED decision leaves the reservoir for `pinned`:
// sampling can never drop the decision the player thought worth explaining.
// Pinned decisions are bounded by the player's own gestures, not by a quota.
//
// SEATS. A vs-Bot game captures its one human seat; a solo game (one user,
// both seats) captures both — one reservoir over the decisions of either,
// each decision naming its own seat (`source.botId`), each call attributed to
// the open decision only when that decision is its seat's.

import { makeRng } from "@convex/gre/rng";
import type { PublicGameState } from "@convex/gameProjections";
import type { AiTraceSource } from "./trace-store";
import type { TappedMutation } from "./mutation-tap";
import {
    proposalStorageAvailable,
    readProposalStore,
    writeProposalStore,
} from "./verdict-proposal-persistence";

/** One human decision: what the seat saw, and what it submitted on it. */
export type CapturedDecision = {
    /** The deciding seat's view — `botId` names the HUMAN seat here; the field
     *  keeps the quiz's name because the quiz lowers from this same shape. */
    source: AiTraceSource;
    /** Every mutation the seat submitted from this decision until its next
     *  one (or the game's end), in order. */
    calls: TappedMutation[];
    /** The declaration this decision is (see `captureHumanDecision`). */
    continuation?: string;
    /** What the player said about this decision while playing (issue
     *  #10088): their words, or the "obvious" mark. Last gesture wins. */
    annotation?: DecisionAnnotation;
};

/** A per-decision annotation: the player's comment, verbatim, or the
 *  one-gesture mark that the decision needed none. */
export type DecisionAnnotation =
    | { kind: "comment"; text: string }
    | { kind: "obvious" };

/** A Plan statement: the seat's words and the `seq` of the state they were
 *  stated on. It stands until the same seat states another. */
export type PlanStatement = { seatId: string; text: string; seq: number };

/** The Plan `seatId` had in force at `seq`: the last statement of that seat
 *  made on a state no later than `seq` — so a Plan changed mid-turn governs
 *  the decisions after the change and not the ones before it. */
export function planInForce(
    plans: readonly PlanStatement[],
    seatId: string,
    seq: number
): PlanStatement | null {
    let found: PlanStatement | null = null;
    for (const plan of plans) {
        if (plan.seatId === seatId && plan.seq <= seq) found = plan;
    }
    return found;
}

/** The reservoir's state — everything a reload must get back. */
type CaptureState = {
    /** Decisions closed so far, by reservoir position. */
    kept: CapturedDecision[];
    /** Commented decisions, outside the reservoir: never sampled away. */
    pinned: CapturedDecision[];
    /** Every Plan statement, in the order they were made. */
    plans: PlanStatement[];
    /** How many decisions have closed, kept or not — the reservoir's `n`. */
    closed: number;
    /** The decision the seat is on now; its calls are still arriving. */
    current: CapturedDecision | null;
    lastSeq: number | null;
    /** How many draws the sampling stream has made — a rehydrated stream is
     *  advanced this far, so sampling continues rather than restarts. */
    rngCalls: number;
};

type Op = (c: GameCapture) => unknown;

type GameCapture = CaptureState & {
    gameId: string;
    seatIds: string[];
    limit: number;
    seed: number;
    rng: () => number;
    /** False while stored state is being read; ops seen meanwhile are queued
     *  in `pending` and replayed on the rehydrated state. */
    hydrated: boolean;
    pending: Op[];
    ready: Promise<void>;
    /** The game-end take ran: nothing more is written, so the stored
     *  decisions outlive the emptied in-memory buffer. */
    taken: boolean;
};

let capture: GameCapture | null = null;

const META_VERSION = 2;

type StoredMeta = {
    v: number;
    gameId: string;
    seatIds: string[];
    limit: number;
    seed: number;
    closed: number;
    lastSeq: number | null;
    rngCalls: number;
    keptCount: number;
    pinnedCount: number;
};

function freshState(): CaptureState {
    return {
        kept: [],
        pinned: [],
        plans: [],
        closed: 0,
        current: null,
        lastSeq: null,
        rngCalls: 0,
    };
}

const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
    version++;
    for (const l of listeners) l();
}

/** Re-render on any change a play-time affordance shows: a Plan stated, a
 *  decision annotated or opened, the capture started, rehydrated or dropped. */
export function subscribeHumanCapture(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Bumped on every change `subscribeHumanCapture` announces — a stable
 *  snapshot for `useSyncExternalStore`. */
export function humanCaptureVersion(): number {
    return version;
}

function rngAt(seed: number, calls: number): () => number {
    const rng = makeRng(seed);
    for (let i = 0; i < calls; i++) rng();
    return rng;
}

function draw(c: GameCapture): number {
    c.rngCalls++;
    return c.rng();
}

function metaRow(c: GameCapture): StoredMeta {
    return {
        v: META_VERSION,
        gameId: c.gameId,
        seatIds: c.seatIds,
        limit: c.limit,
        seed: c.seed,
        closed: c.closed,
        lastSeq: c.lastSeq,
        rngCalls: c.rngCalls,
        keptCount: c.kept.length,
        pinnedCount: c.pinned.length,
    };
}

function currentRow(c: GameCapture): Omit<CapturedDecision, "calls"> | null {
    if (!c.current) return null;
    const { source, continuation, annotation } = c.current;
    return {
        source,
        ...(continuation === undefined ? {} : { continuation }),
        ...(annotation === undefined ? {} : { annotation }),
    };
}

/** Write the named rows (and `meta`) through to storage — a no-op without
 *  storage, while rehydrating, after the take, or for a stale capture. */
function persist(
    c: GameCapture,
    rows: {
        slot?: number;
        pinned?: number;
        current?: boolean;
        calls?: boolean;
        plans?: boolean;
    }
): void {
    if (!c.hydrated || c.taken || capture !== c) return;
    if (!proposalStorageAvailable()) return;
    const entries: Record<string, unknown> = { meta: metaRow(c) };
    if (rows.slot !== undefined) {
        entries[`kept:${rows.slot}`] = c.kept[rows.slot];
    }
    if (rows.pinned !== undefined) {
        entries[`pinned:${rows.pinned}`] = c.pinned[rows.pinned];
    }
    if (rows.plans) entries.plans = c.plans;
    if (rows.current) entries.current = currentRow(c);
    if (rows.current || rows.calls) {
        entries.currentCalls = c.current ? c.current.calls : [];
    }
    void writeProposalStore("capture", entries);
}

function snapshotRows(c: GameCapture): Record<string, unknown> {
    const entries: Record<string, unknown> = {
        meta: metaRow(c),
        current: currentRow(c),
        currentCalls: c.current ? c.current.calls : [],
        plans: c.plans,
    };
    c.kept.forEach((d, i) => {
        entries[`kept:${i}`] = d;
    });
    c.pinned.forEach((d, i) => {
        entries[`pinned:${i}`] = d;
    });
    return entries;
}

function isRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStoredDecision(x: unknown): x is CapturedDecision {
    return (
        isRecord(x) &&
        isRecord(x.source) &&
        isRecord(x.source.state) &&
        Array.isArray(x.calls)
    );
}

function isStoredPlan(x: unknown): x is PlanStatement {
    return (
        isRecord(x) &&
        typeof x.seatId === "string" &&
        typeof x.text === "string" &&
        typeof x.seq === "number"
    );
}

const sameSeats = (a: unknown, b: readonly string[]): boolean =>
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((seat, i) => seat === b[i]);

/** The stored state of `c`'s game and seat, or `null` when storage holds
 *  another game's, an older format, or anything that does not read. */
function restoredState(
    c: GameCapture,
    rows: Record<string, unknown>
): CaptureState | null {
    const m = rows.meta;
    if (!isRecord(m)) return null;
    const meta = m as Partial<StoredMeta>;
    if (
        meta.v !== META_VERSION ||
        meta.gameId !== c.gameId ||
        !sameSeats(meta.seatIds, c.seatIds) ||
        meta.limit !== c.limit ||
        meta.seed !== c.seed ||
        !Number.isInteger(meta.closed) ||
        !Number.isInteger(meta.rngCalls) ||
        !Number.isInteger(meta.keptCount) ||
        !Number.isInteger(meta.pinnedCount) ||
        (meta.keptCount as number) > c.limit ||
        (meta.keptCount as number) > (meta.closed as number)
    ) {
        return null;
    }
    const kept: CapturedDecision[] = [];
    for (let i = 0; i < (meta.keptCount as number); i++) {
        const d = rows[`kept:${i}`];
        if (!isStoredDecision(d)) return null;
        kept.push(d);
    }
    const pinned: CapturedDecision[] = [];
    for (let i = 0; i < (meta.pinnedCount as number); i++) {
        const d = rows[`pinned:${i}`];
        if (!isStoredDecision(d)) return null;
        pinned.push(d);
    }
    const plans = Array.isArray(rows.plans)
        ? rows.plans.filter(isStoredPlan)
        : [];
    const open = rows.current;
    const calls = rows.currentCalls;
    let current: CapturedDecision | null = null;
    if (isRecord(open)) {
        current = {
            ...(open as Omit<CapturedDecision, "calls">),
            calls: Array.isArray(calls) ? (calls as TappedMutation[]) : [],
        };
        if (!isStoredDecision(current)) return null;
    }
    return {
        kept,
        pinned,
        plans,
        closed: meta.closed as number,
        current,
        lastSeq: typeof meta.lastSeq === "number" ? meta.lastSeq : null,
        rngCalls: meta.rngCalls as number,
    };
}

async function hydrate(c: GameCapture): Promise<void> {
    const rows = await readProposalStore("capture");
    if (capture !== c) return;
    let base: CaptureState;
    try {
        base = restoredState(c, rows) ?? freshState();
    } catch {
        base = freshState();
    }
    Object.assign(c, base);
    c.rng = rngAt(c.seed, c.rngCalls);
    // What the seat did while storage was read, replayed on the stored state.
    const ops = c.pending;
    c.pending = [];
    for (const op of ops) op(c);
    c.hydrated = true;
    emit();
    // One full write: clears another game's rows, or rewrites this game's
    // with the replayed ops folded in.
    await writeProposalStore("capture", snapshotRows(c), true);
}

/** Apply `op` now; while rehydrating, also queue it for the replay. */
function apply<R>(c: GameCapture, op: (c: GameCapture) => R): R {
    if (!c.hydrated) c.pending.push(op);
    return op(c);
}

/** Begin capturing the decisions of `seats` (the human seat of a vs-Bot
 *  game; both seats of a solo game) in `gameId`, dropping any previous game's
 *  buffer — and resuming from storage when it holds this game and these
 *  seats' capture (issue #8889). */
export function startHumanCapture(
    gameId: string,
    seats: string | readonly string[],
    options: { limit: number; seed: number }
): void {
    const persisted = proposalStorageAvailable();
    const c: GameCapture = {
        gameId,
        seatIds: typeof seats === "string" ? [seats] : [...seats],
        limit: options.limit,
        seed: options.seed,
        rng: makeRng(options.seed),
        ...freshState(),
        hydrated: !persisted,
        pending: [],
        ready: Promise.resolve(),
        taken: false,
    };
    capture = c;
    if (persisted) c.ready = hydrate(c);
    emit();
}

/** Resolves once `gameId`'s capture has rehydrated from storage (at once
 *  without storage, or for a game not being captured). */
export function humanCaptureReady(gameId: string): Promise<void> {
    const c = capture;
    return c && c.gameId === gameId ? c.ready : Promise.resolve();
}

/** Whether `state` is `seatId`'s OWN view: every slot of its own hand carries
 *  an identity. A projection made for anyone else hides that hand. */
export function isSeatOwnView(state: PublicGameState, seatId: string): boolean {
    const seat = state.players.find((p) => p.id === seatId);
    return !!seat && seat.hand.every((card) => card !== null);
}

/** The seat's own decklist as the only deck knowledge, or none. */
export function ownDeckKnowledge(
    seatId: string,
    cardIds: readonly string[] | undefined
): AiTraceSource["knowledge"] {
    return cardIds ? [{ playerId: seatId, cardIds: [...cardIds] }] : undefined;
}

/** Close the open decision; returns the row it landed in — a reservoir
 *  slot, or a pinned index for a commented decision. */
function close(c: GameCapture): { slot?: number; pinned?: number } {
    const done = c.current;
    c.current = null;
    if (!done || done.calls.length === 0) return {};
    if (done.annotation?.kind === "comment") {
        c.pinned.push(done);
        return { pinned: c.pinned.length - 1 };
    }
    c.closed++;
    if (c.kept.length < c.limit) {
        c.kept.push(done);
        return { slot: c.kept.length - 1 };
    }
    const slot = Math.floor(draw(c) * c.closed);
    if (slot < c.limit) {
        c.kept[slot] = done;
        return { slot };
    }
    return {};
}

/**
 * The seat owes a fresh decision on `state`: close the previous one and open
 * this. A repeat of the same `seq` is ignored. Returns false — capturing
 * nothing — for another game, another seat, or a projection that is not the
 * seat's own view.
 */
export function captureHumanDecision(
    gameId: string,
    source: AiTraceSource,
    /** Names a declaration several saves belong to (a combat step: one save
     *  per attacker clicked). A state naming the SAME declaration as the open
     *  decision continues it instead of opening a second one. */
    continuation?: string
): boolean {
    const c = capture;
    if (!c || c.gameId !== gameId || !c.seatIds.includes(source.botId)) {
        return false;
    }
    if (!isSeatOwnView(source.state, source.botId)) return false;
    if (source.knowledge?.some((k) => k.playerId !== source.botId)) {
        return false;
    }
    return apply(c, (c) => {
        if (c.lastSeq === source.state.seq) return false;
        c.lastSeq = source.state.seq;
        if (
            continuation !== undefined &&
            c.current?.continuation === continuation
        ) {
            persist(c, {});
            return false;
        }
        const landed = close(c);
        c.current = {
            source,
            calls: [],
            ...(continuation === undefined ? {} : { continuation }),
        };
        persist(c, { ...landed, current: true });
        emit();
        return true;
    });
}

/** The seat owes something that is no decision worth a question: the open
 *  decision is finished, and calls until the next one belong to none. */
export function closeHumanDecision(gameId: string): void {
    const c = capture;
    if (!c || c.gameId !== gameId) return;
    apply(c, (c) => {
        const landed = close(c);
        persist(c, { ...landed, current: true });
        emit();
    });
}

/** One mutation the seat submitted — appended to its current decision. A
 *  call with no open decision (before the first one is seen) is dropped. */
export function recordHumanCall(gameId: string, call: TappedMutation): void {
    const c = capture;
    // While rehydrating, the open decision may be the stored one: queue it.
    if (!c || c.gameId !== gameId || (c.hydrated && !c.current)) return;
    if (
        typeof call.args.playerId !== "string" ||
        !c.seatIds.includes(call.args.playerId) ||
        call.args.gameId !== gameId
    ) {
        return;
    }
    apply(c, (c) => {
        // Solo: a call belongs to the open decision only if it is its seat's.
        if (!c.current || c.current.source.botId !== call.args.playerId) {
            return;
        }
        c.current.calls.push(call);
        persist(c, { calls: true });
    });
}

/** The game is over: close the open decision and hand over everything kept,
 *  in the order the decisions were made. Empties the in-memory buffer; the
 *  stored copy stays (until a capture for another game), so a reload before
 *  the list is built can take them again. Call after `humanCaptureReady`. */
export function takeHumanDecisions(gameId: string): CapturedDecision[] {
    const c = capture;
    if (!c || c.gameId !== gameId) return [];
    const landed = close(c);
    persist(c, { ...landed, current: true });
    if (c.hydrated) c.taken = true;
    const out = [...c.kept, ...c.pinned].sort(
        (a, b) => a.source.state.seq - b.source.state.seq
    );
    c.kept = [];
    c.pinned = [];
    c.closed = 0;
    return out;
}

/** The game being captured, or `null` — what a late game-end result checks
 *  before it lands, so a swap that happened meanwhile drops it. */
export function capturingGame(): string | null {
    return capture?.gameId ?? null;
}

/** Drop the in-memory capture — a game swap, an unmount. Storage is left for
 *  a remount of the same game (a reload) to resume from. */
export function clearHumanCapture(): void {
    capture = null;
    emit();
}

/**
 * The seat states a Plan on the state at `seq` (issue #10088). It stands
 * until the same seat states another. Blank words state nothing: returns
 * false, as it does for a game or seat not being captured.
 */
export function stateHumanPlan(
    gameId: string,
    seatId: string,
    seq: number,
    text: string
): boolean {
    const c = capture;
    const words = text.trim();
    if (!c || c.gameId !== gameId || !c.seatIds.includes(seatId)) return false;
    if (words === "" || !Number.isInteger(seq) || seq < 0) return false;
    apply(c, (c) => {
        if (c.taken) return;
        c.plans.push({ seatId, text: words, seq });
        persist(c, { plans: true });
    });
    emit();
    return true;
}

/** The held decision of `seatId` opened on the state at `seq` — the open
 *  one, or a closed one still held. An exact match: a decision the
 *  reservoir dropped is never silently replaced by an older one. */
function annotatedDecision(
    c: GameCapture,
    seatId: string,
    seq: number
): CapturedDecision | null {
    const opened = (d: CapturedDecision | null): d is CapturedDecision =>
        !!d && d.source.botId === seatId && d.source.state.seq === seq;
    if (opened(c.current)) return c.current;
    return [...c.kept, ...c.pinned].find(opened) ?? null;
}

/**
 * Annotate the seat's decision opened on the state at `seq` (issue #10088):
 * its comment in the player's own words, or the "obvious" mark — the last
 * gesture wins. A comment pins the decision: it leaves the reservoir and is
 * always handed over at game end. Returns false when no held decision of
 * that seat was opened at `seq` (or the words are blank).
 */
export function annotateHumanDecision(
    gameId: string,
    seatId: string,
    seq: number,
    annotation: DecisionAnnotation
): boolean {
    const c = capture;
    if (!c || c.gameId !== gameId || !c.seatIds.includes(seatId)) return false;
    const note: DecisionAnnotation =
        annotation.kind === "comment"
            ? { kind: "comment", text: annotation.text.trim() }
            : { kind: "obvious" };
    if (note.kind === "comment" && note.text === "") return false;
    const attached = apply(c, (c) => {
        if (c.taken) return false;
        const target = annotatedDecision(c, seatId, seq);
        if (!target) return false;
        target.annotation = note;
        if (target === c.current) {
            persist(c, { current: true });
            return true;
        }
        const reservoirSlot = c.kept.indexOf(target);
        if (note.kind === "comment" && reservoirSlot >= 0) {
            // Out of the reservoir, so no later draw can replace it.
            c.kept.splice(reservoirSlot, 1);
            c.pinned.push(target);
        }
        if (c.hydrated && capture === c && proposalStorageAvailable()) {
            void writeProposalStore("capture", snapshotRows(c), true);
        }
        return true;
    });
    emit();
    return attached;
}

/** Every Plan statement of `gameId`'s capture, in the order made. */
export function humanPlans(gameId: string): PlanStatement[] {
    const c = capture;
    return c && c.gameId === gameId ? [...c.plans] : [];
}

/** What a play-time affordance shows for `seatId`: the Plan it has in force
 *  now, and the open decision (its `seq` and annotation) when it is that
 *  seat's. */
export function humanCaptureView(
    gameId: string,
    seatId: string
): {
    plan: PlanStatement | null;
    decision: { seq: number; annotation: DecisionAnnotation | null } | null;
} {
    const c = capture;
    if (!c || c.gameId !== gameId || !c.seatIds.includes(seatId)) {
        return { plan: null, decision: null };
    }
    const plan = planInForce(c.plans, seatId, Number.MAX_SAFE_INTEGER);
    const open = c.current?.source.botId === seatId ? c.current : null;
    return {
        plan,
        decision: open
            ? {
                  seq: open.source.state.seq,
                  annotation: open.annotation ?? null,
              }
            : null,
    };
}
