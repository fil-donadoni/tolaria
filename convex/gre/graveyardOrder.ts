// CR 404.3 (issue #9554) — "If an effect or rule puts two or more cards into
// the same graveyard at the same time, the owner of those cards may arrange
// them in any order."
//
// Three halves, mirroring the meld arrangement (`meld.ts`, CR 712.21a):
//   - COLLECT: `withGraveyardArrivalBatch` brackets one simultaneous event (one
//     resolving instruction, one SBA pass) and diffs every graveyard against a
//     snapshot taken when the outermost bracket opened. The cards that arrived
//     are the batch; nothing at the insertion funnels changes — they keep
//     appending (`moveCard`, `removePermanentTo`), so the engine order is the
//     batch's default order and every "top of your graveyard" reader keeps the
//     array orientation it already relies on (index 0 = bottom, end = top).
//   - QUEUE: a batch of two or more cards that are not all copies of one name
//     is queued per owner, APNAP (CR 101.4 — the active player first).
//   - RAISE / APPLY: the SBA sweep's settle point raises the front arrangement
//     as a `graveyard-order` prompt; the answer permutes the batch among the
//     slots it occupies, so cards that were already in the graveyard stay
//     below, untouched.
import { tryGetDefinition } from "../cards";
import { seededShuffle } from "./rng";
import type {
    CardInstanceState,
    GameState,
    PendingGraveyardArrangement,
    PlayerState,
} from "./state/declarations";

/** How a batch's final order is decided. `"owner"` (CR 404.3, the default):
 *  the owner arranges it. `"random"`: the effect says "in a random order" —
 *  the seeded PRNG decides, no prompt. */
export type GraveyardBatchOrder = "owner" | "random";

type OpenBatch = {
    /** The graveyard ids each player had when the outermost bracket opened. */
    before: Map<string, Set<string>>;
    order: GraveyardBatchOrder;
};

/** The open batch of a state, while one simultaneous event runs inside
 *  `withGraveyardArrivalBatch`. A WeakMap rather than a `GameState` field,
 *  like the library-entry batch: it lives for one synchronous call and must
 *  never be persisted, projected or replayed. */
const openGraveyardBatches = new WeakMap<GameState, OpenBatch>();

/** Runs `run` as ONE simultaneous event for CR 404.3: every card it puts into
 *  a graveyard joins one batch per owner, queued for that owner to arrange
 *  once `run` returns. Nested calls join the outermost batch — a `forEach`
 *  body is part of the one instruction that loops it, and a world-rule sweep
 *  part of the SBA pass that runs it. */
export function withGraveyardArrivalBatch<T>(
    state: GameState,
    run: () => T,
    order: GraveyardBatchOrder = "owner"
): T {
    if (openGraveyardBatches.has(state)) return run();
    const batch: OpenBatch = { before: snapshotGraveyards(state), order };
    openGraveyardBatches.set(state, batch);
    try {
        return run();
    } finally {
        openGraveyardBatches.delete(state);
        closeGraveyardBatch(state, batch);
    }
}

function snapshotGraveyards(state: GameState): Map<string, Set<string>> {
    return new Map(
        state.players.map((p) => [p.id, new Set(p.graveyard.map((c) => c.id))])
    );
}

/** CR 101.4 — the players in APNAP order: the active player, then the others
 *  in turn order. */
function apnapPlayers(state: GameState): PlayerState[] {
    const start = state.players.findIndex((p) => p.id === state.activePlayerId);
    if (start <= 0) return [...state.players];
    return [...state.players.slice(start), ...state.players.slice(0, start)];
}

function closeGraveyardBatch(state: GameState, batch: OpenBatch): void {
    for (const player of apnapPlayers(state)) {
        const before = batch.before.get(player.id) ?? new Set<string>();
        const arrived = player.graveyard.filter((c) => !before.has(c.id));
        if (arrived.length < 2) continue;
        if (batch.order === "random") {
            permuteWithinSlots(
                player.graveyard,
                seededShuffle(
                    state,
                    arrived.map((c) => c.id)
                )
            );
            continue;
        }
        if (!isArrangementMeaningful(arrived)) continue;
        state.pendingGraveyardArrangements = [
            ...(state.pendingGraveyardArrangements ?? []),
            { ownerId: player.id, cardIds: arrived.map((c) => c.id) },
        ];
    }
}

/** No prompt when it can't matter: fewer than two cards, or every card a copy
 *  of one name (any arrangement reads the same — the Arena-parity auto-resolve
 *  the other choice kinds apply). */
function isArrangementMeaningful(cards: readonly CardInstanceState[]): boolean {
    if (cards.length < 2) return false;
    const names = new Set(cards.map(cardName));
    return names.size > 1;
}

function cardName(card: CardInstanceState): string {
    const id = (card.card as { id?: string }).id ?? card.id;
    return tryGetDefinition(id)?.name ?? id;
}

/** Puts the cards named by `bottomFirst` into the slots those same cards
 *  occupy in `graveyard`, lowest slot first — the batch is rearranged where it
 *  lies, and every other card keeps its position. */
function permuteWithinSlots(
    graveyard: CardInstanceState[],
    bottomFirst: readonly string[]
): void {
    const ids = new Set(bottomFirst);
    const byId = new Map(
        graveyard.filter((c) => ids.has(c.id)).map((c) => [c.id, c])
    );
    const slots = graveyard
        .map((c, i) => (ids.has(c.id) ? i : -1))
        .filter((i) => i !== -1);
    bottomFirst.forEach((id, k) => {
        const card = byId.get(id);
        if (card !== undefined) graveyard[slots[k]] = card;
    });
}

/** The cards of `arrangement` still in their owner's graveyard, TOP first
 *  (the end of the array is the top). A card that left since (CR 400.7 — a
 *  new object) is no longer part of it. */
function presentTopFirst(
    state: GameState,
    arrangement: PendingGraveyardArrangement
): CardInstanceState[] {
    const owner = state.players.find((p) => p.id === arrangement.ownerId);
    const ids = new Set(arrangement.cardIds);
    return (owner?.graveyard ?? []).filter((c) => ids.has(c.id)).reverse();
}

/** The SBA-sweep half of {@link withGraveyardArrivalBatch}: raise the front
 *  arrangement as a `graveyard-order` prompt. An arrangement that no longer
 *  matters (cards left the graveyard since) is dropped unasked. Returns true
 *  when a prompt was raised (the caller suspends). Never stacks a prompt on
 *  another pending choice. */
export function raiseGraveyardArrangement(state: GameState): boolean {
    if ((state.pendingChoices?.length ?? 0) > 0) return false;
    const queue = [...(state.pendingGraveyardArrangements ?? [])];
    while (queue.length > 0) {
        const next = queue[0];
        const cards = presentTopFirst(state, next);
        if (!isArrangementMeaningful(cards)) {
            queue.shift();
            continue;
        }
        const ids = cards.map((c) => c.id);
        state.pendingChoices = [
            {
                stackItemId: "", // SBA-level (no stack item)
                step: 0,
                choiceId: `graveyard-order-${ids.join("-")}`,
                playerId: next.ownerId,
                zoneOwnerId: next.ownerId,
                kind: "graveyard-order",
                zone: "graveyard",
                count: ids.length,
                // Topmost first — the submission's own orientation, so the
                // engine order is the answer a player who changes nothing
                // gives back.
                candidateIds: ids,
                prompt: "Arrange the cards put into your graveyard (rightmost = top).",
            },
        ];
        state.pendingGraveyardArrangements = queue;
        state.priorityPlayerId = next.ownerId;
        return true;
    }
    state.pendingGraveyardArrangements = undefined;
    return false;
}

/** CR 404.3 — a seeded random arrangement of the head `graveyard-order`
 *  choice's cards, topmost first (the "Order randomly" answer). Drawn from the
 *  game's PRNG, server-side, never from the client. */
export function randomGraveyardArrangement(
    state: GameState,
    candidateIds: readonly string[]
): string[] {
    return seededShuffle(state, [...candidateIds]);
}

/** CR 404.3 — commit the head `graveyard-order` choice: `topmostFirst` is a
 *  permutation of its candidates (validated by the submit handler). The batch
 *  is rearranged within the slots it occupies; the choice and its queue entry
 *  are popped. */
export function applyGraveyardArrangement(
    state: GameState,
    topmostFirst: readonly string[]
): void {
    const head = state.pendingChoices?.[0];
    if (!head || head.kind !== "graveyard-order") return;
    const owner = state.players.find(
        (p) => p.id === (head.zoneOwnerId ?? head.playerId)
    );
    if (owner) permuteWithinSlots(owner.graveyard, [...topmostFirst].reverse());
    const rest = (state.pendingGraveyardArrangements ?? []).slice(1);
    state.pendingGraveyardArrangements = rest.length > 0 ? rest : undefined;
    const queue = state.pendingChoices!.slice(1);
    state.pendingChoices = queue.length > 0 ? queue : undefined;
}
