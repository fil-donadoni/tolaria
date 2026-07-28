// Client-side "a game intent is in flight" store (view layer only, never
// authoritative).
//
// Why it exists: the Space hotkey is overloaded. While a payment banner or a
// resolution choice is up it means "Auto-tap" / "Confirm"; with nothing pending
// it falls through to `passPriority`. Between clicking a card to cast it and
// the payment banner appearing there is a round-trip window in which the client
// still sees NO `pendingCast` — a Space pressed in that window fell through to
// `passPriority` and silently advanced the phase, throwing away the turn (the
// keystroke the player meant as "confirm the auto-tap" did the opposite).
//
// Any dispatch that is EXPECTED to park the engine on player input (announceCast,
// playCard, activateAbility) registers itself here for the duration of its
// round-trip. The hotkey handler refuses to fall through to
// `passPriority` / `endTurn` while the count is non-zero, so the reflex keystroke
// is dropped instead of being reinterpreted as a phase change.
//
// Clearing on promise settle is sufficient: the Convex client applies a
// mutation's effects to its subscribed query results before resolving the
// mutation promise, so by the time the count drops the board already shows the
// banner / prompt the keystroke was meant for.
//
// A module-level external store (same shape as `ai/trace-store.ts`) rather than
// a context: the dispatch sites (hand card, battlefield, graveyard buttons) and
// the reader (`useControllerActions`) sit in unrelated subtrees, and there is
// exactly one live game per client.

let inFlight = 0;
const listeners = new Set<() => void>();

function notify(): void {
    for (const l of listeners) l();
}

/** Registers `promise` as an in-flight game intent for its lifetime. Returns the
 *  same promise so call sites can keep chaining `.catch(reportError)`. */
export function trackGameIntent<T>(promise: Promise<T>): Promise<T> {
    inFlight += 1;
    notify();
    return promise.finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        notify();
    });
}

export function hasPendingGameIntent(): boolean {
    return inFlight > 0;
}

export function subscribePendingGameIntent(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test-only reset — the store outlives a component tree by design. */
export function resetPendingGameIntents(): void {
    inFlight = 0;
    notify();
}
