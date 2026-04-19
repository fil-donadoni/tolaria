import type { Phase } from "@convex/gre/types";
import {
    computeAutoPassBlocked,
    type AutoPassBlockedCtx,
} from "~/lib/priority";

export type Side = "self" | "opponent";
export type PhaseSkipPrefs = Partial<Record<Phase, Record<Side, boolean>>>;

export const SKIP_PREFS_KEY = "tolaria:skipPhasePrefs:v1";
export const AUTO_PASS_DELAY_MS = 120;

export const DEFAULT_SKIP_PREFS: PhaseSkipPrefs = {
    DRAW: { self: true, opponent: true },
    END_OF_COMBAT: { self: true, opponent: true },
    END_STEP: { self: true, opponent: false },
};

export const SKIPPABLE_PHASES: readonly Phase[] = [
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
] as const;

export function isSkippablePhase(phase: string): phase is Phase {
    return (SKIPPABLE_PHASES as readonly string[]).includes(phase);
}

export function isPhaseSkipped(
    prefs: PhaseSkipPrefs,
    phase: Phase,
    side: Side
): boolean {
    return prefs[phase]?.[side] === true;
}

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
