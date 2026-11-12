import type { Phase } from "@convex/gre/types";
import {
    DEFAULT_SKIP_PREFS,
    SKIPPABLE_PHASES,
    isPhaseSkipped,
    isSkippablePhase,
    type PhaseSkipPrefs,
    type Side,
} from "@convex/phaseStopPrefs";
import {
    computeAutoPassBlocked,
    type AutoPassBlockedCtx,
} from "~/lib/priority";

// The preference shape, its defaults and the skippable set are the engine's
// (`convex/phaseStopPrefs.ts`, ADR 0077): the server drain reads the same rows
// this file stores, so there is one definition of what a stored `true` means.
export {
    DEFAULT_SKIP_PREFS,
    SKIPPABLE_PHASES,
    isPhaseSkipped,
    isSkippablePhase,
    type PhaseSkipPrefs,
    type Side,
};

export const SKIP_PREFS_KEY = "tolaria:skipPhasePrefs:v1";
export const AUTO_PASS_DELAY_MS = 0;

export function shouldAutoPass(
    ctx: AutoPassBlockedCtx,
    prefs: PhaseSkipPrefs,
    pageVisible: boolean
): boolean {
    if (!pageVisible) return false;
    if (computeAutoPassBlocked(ctx)) return false;
    if (!isSkippablePhase(ctx.phase)) return false;
    const side = ctx.playerId === ctx.activePlayerId ? "self" : "opponent";
    return isPhaseSkipped(prefs, ctx.phase, side);
}

export function togglePhaseStop(
    prefs: PhaseSkipPrefs,
    phase: Phase,
    side: Side
): PhaseSkipPrefs {
    const current = prefs[phase] ?? { self: false, opponent: false };
    const next: Record<Side, boolean> = {
        ...current,
        [side]: !current[side],
    };
    return { ...prefs, [phase]: next };
}

export function loadSkipPrefs(storage: Storage = localStorage): PhaseSkipPrefs {
    try {
        const raw = storage.getItem(SKIP_PREFS_KEY);
        if (!raw) return { ...DEFAULT_SKIP_PREFS };
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return { ...DEFAULT_SKIP_PREFS };
        }
        return mergePrefs(parsed as PhaseSkipPrefs);
    } catch {
        return { ...DEFAULT_SKIP_PREFS };
    }
}

export function saveSkipPrefs(
    prefs: PhaseSkipPrefs,
    storage: Storage = localStorage
): void {
    try {
        storage.setItem(SKIP_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // ignore quota/serialization errors
    }
}

function mergePrefs(stored: PhaseSkipPrefs): PhaseSkipPrefs {
    const merged: PhaseSkipPrefs = { ...DEFAULT_SKIP_PREFS };
    for (const phase of SKIPPABLE_PHASES) {
        const entry = stored[phase];
        if (entry && typeof entry === "object") {
            merged[phase] = {
                self: entry.self === true,
                opponent: entry.opponent === true,
            };
        }
    }
    return merged;
}
