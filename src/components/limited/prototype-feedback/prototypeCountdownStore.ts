// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-countdown`). Never merge.
//
// A CLIENT-ONLY pre-draft countdown. It is a fake: the server stamps the
// round-0 pick deadlines the moment `startLimitedEvent` → `startDraft` runs,
// so the real pick clock is already ticking underneath this cover. The real
// feature must shift those server deadlines by the countdown length (and the
// Bots' first picks with them) — nothing here does.
import { useSyncExternalStore } from "react";

export const PROTOTYPE_COUNTDOWN_SECONDS = 12;

let endsAt: number | null = null;
let snapshot: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function tick(): void {
    let next = endsAt === null ? null : Math.ceil((endsAt - Date.now()) / 1000);
    if (next !== null && next <= 0) next = null;
    if (next === null) {
        endsAt = null;
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
    }
    if (next !== snapshot) {
        snapshot = next;
        listeners.forEach((l) => l());
    }
}

export function startPrototypeCountdown(
    seconds = PROTOTYPE_COUNTDOWN_SECONDS
): void {
    endsAt = Date.now() + seconds * 1000;
    if (timer === undefined) timer = setInterval(tick, 200);
    tick();
}

export function skipPrototypeCountdown(): void {
    endsAt = null;
    tick();
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/** Whole seconds left, or `null` when no countdown is running. */
export function usePrototypeCountdownSeconds(): number | null {
    return useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => null
    );
}

/** The number's once-a-second "pop"; each countdown variant injects it. */
export const PROTOTYPE_TICK_CSS = `
@keyframes prototype-count-tick {
    from { transform: scale(1.25); opacity: 0.4; }
    to { transform: scale(1); opacity: 1; }
}`;
