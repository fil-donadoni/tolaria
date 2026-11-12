// Phase Stop preferences as DATA (ADR 0077): the shape, its defaults and the
// sanitiser. Card-free on purpose — `convex/gamePrefs.ts` stores these rows
// and is imported by modules that must not load the engine; the predicate
// that reads a `GameState` lives in `convex/gre/autoPass.ts`.

import type { Phase } from "./gre/types";

export type Side = "self" | "opponent";

/** Per-phase, per-side Phase Stop preferences in the STORED sense: `true`
 *  means the window is SKIPPED (the UI toggles read "Stop on…" and negate). */
export type PhaseSkipPrefs = Partial<Record<Phase, Record<Side, boolean>>>;

export const DEFAULT_SKIP_PREFS: PhaseSkipPrefs = {
    UPKEEP: { self: true, opponent: true },
    DRAW: { self: true, opponent: true },
    PRECOMBAT_MAIN: { self: false, opponent: true },
    POSTCOMBAT_MAIN: { self: false, opponent: true },
    FIRST_STRIKE_DAMAGE: { self: true, opponent: true },
    COMBAT_DAMAGE: { self: true, opponent: true },
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
    "FIRST_STRIKE_DAMAGE",
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

/** Stored preferences reduced to the shape the drain trusts: only skippable
 *  phases, only literal booleans. Anything else in the input is dropped, so
 *  a malformed row can lose a skip but never invent one. */
export function sanitizeSkipPrefs(raw: unknown): PhaseSkipPrefs {
    const out: PhaseSkipPrefs = {};
    if (!raw || typeof raw !== "object") return out;
    for (const phase of SKIPPABLE_PHASES) {
        const entry = (raw as Record<string, unknown>)[phase];
        if (!entry || typeof entry !== "object") continue;
        const { self, opponent } = entry as Record<string, unknown>;
        out[phase] = { self: self === true, opponent: opponent === true };
    }
    return out;
}
