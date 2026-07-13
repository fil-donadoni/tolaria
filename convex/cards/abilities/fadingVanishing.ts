// Fading (CR 702.32) & Vanishing (CR 702.63) — the engine's first
// counter-clock keyword abilities, expanded implicitly from a single
// `staticAbilities` string (ADR 0054). A card declares only
// `staticAbilities: ["fading 3"]` / `["vanishing 3"]`; `expandFadingVanishing`
// injects both the enter-with-counters entry and the synthesized upkeep
// triggered ability at the `getDefinition` seam (convex/cards/index.ts), so `N`
// lives in exactly one place — the keyword string.
//
// The two keywords share a shape (enter with N named counters; at your upkeep
// remove one) but diverge on WHEN they sacrifice:
//
//   * Fading N (CR 702.32b) — at your upkeep, remove a fade counter; if you
//     CAN'T (none remain), sacrifice it. A single upkeep trigger that
//     checks-then-acts: `removeCounter` returning 0 means "couldn't remove".
//     It survives one upkeep longer than vanishing N (the turn it finds no
//     counter is the turn it dies).
//   * Vanishing N (CR 702.63c/d) — at your upkeep, remove a time counter
//     (clause c); and, as a SEPARATE triggered ability, when the last time
//     counter is removed by ANY means (clause d), sacrifice it. The sacrifice
//     keys off `COUNTER_REMOVED` reaching zero, so it dies one upkeep sooner
//     than fading and fires however the last counter leaves (upkeep or a
//     fade-counter-as-cost drain).

import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../types";
import { phaseTrigger } from "./triggers/phaseTrigger";

/** Counter type each keyword enters with (CR 702.32a / 702.63a). */
const FADE_COUNTER = "fade";
const TIME_COUNTER = "time";

const FADING_PATTERN = /^fading (\d+)$/i;
const VANISHING_PATTERN = /^vanishing (\d+)$/i;

interface ParsedKeyword {
    keyword: "fading" | "vanishing";
    count: number;
}

/** Parses the fading/vanishing keyword (and its `N`) out of a card's
 *  `staticAbilities`, or null if neither is present. A card carries at most one
 *  of the two (they are mutually exclusive on real cards). */
export function parseFadingVanishing(
    staticAbilities: string[] | undefined
): ParsedKeyword | null {
    if (!staticAbilities) return null;
    for (const ability of staticAbilities) {
        const fade = FADING_PATTERN.exec(ability);
        if (fade) return { keyword: "fading", count: Number(fade[1]) };
        const vanish = VANISHING_PATTERN.exec(ability);
        if (vanish) return { keyword: "vanishing", count: Number(vanish[1]) };
    }
    return null;
}

/** Fading's single upkeep trigger (CR 702.32b): remove a fade counter, or — if
 *  none remain to remove — sacrifice the permanent. */
function fadingUpkeepTrigger(): TriggeredAbility {
    return phaseTrigger({
        id: "fading",
        oracleText:
            "At the beginning of your upkeep, remove a fade counter from this permanent. If you can't, sacrifice it.",
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            const self = {
                type: "permanent" as const,
                id: ctx.sourceInstanceId,
            };
            const removed = ctx.removeCounter(self, FADE_COUNTER, 1);
            if (removed === 0) ctx.sacrifice(ctx.sourceInstanceId);
        },
    });
}

/** Vanishing's upkeep trigger (CR 702.63c): remove a time counter. The
 *  `COUNTER_REMOVED` this emits drives the separate sacrifice trigger below
 *  when it empties the permanent. */
function vanishingUpkeepTrigger(): TriggeredAbility {
    return phaseTrigger({
        id: "vanishing-upkeep",
        oracleText:
            "At the beginning of your upkeep, remove a time counter from this permanent. (CR 702.63c)",
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx) => {
            ctx.removeCounter(
                { type: "permanent", id: ctx.sourceInstanceId },
                TIME_COUNTER,
                1
            );
        },
    });
}

/** Vanishing's sacrifice trigger (CR 702.63d): "When the last time counter is
 *  removed from this permanent, sacrifice it." Fires on any removal that takes
 *  the `time` count to zero — upkeep or otherwise — not only the upkeep step. */
function vanishingSacrificeTrigger(): TriggeredAbility {
    return {
        id: "vanishing-last-counter",
        oracleText:
            "When the last time counter is removed from this permanent, sacrifice it. (CR 702.63d)",
        event: "COUNTER_REMOVED",
        matches: (event: GameEvent, self: PermanentView) => {
            if (event.type !== "COUNTER_REMOVED") return false;
            if (event.instanceId !== self.id) return false;
            if (event.counterType !== TIME_COUNTER) return false;
            // CR 702.63d — only the removal that empties the last counter.
            return event.remaining === 0;
        },
        resolve: (ctx) => {
            ctx.sacrifice(ctx.sourceInstanceId);
        },
    };
}

/** Expands a card carrying `fading N` / `vanishing N` into a definition that
 *  also enters with N `fade`/`time` counters and carries the synthesized upkeep
 *  (and, for vanishing, sacrifice) triggered abilities. Returns the input
 *  unchanged when neither keyword is present. Never mutates the input — clones
 *  only the touched fields, so the base definition stays shared. Idempotent by
 *  construction: the memo at the `getDefinition` seam (ADR 0054) ensures a given
 *  definition is expanded at most once, but this also guards against
 *  double-injection by skipping when the synthesized trigger id already exists. */
export function expandFadingVanishing(def: CardDefinition): CardDefinition {
    const parsed = parseFadingVanishing(def.staticAbilities);
    if (!parsed) return def;

    const counterType =
        parsed.keyword === "fading" ? FADE_COUNTER : TIME_COUNTER;
    const injectedTriggers =
        parsed.keyword === "fading"
            ? [fadingUpkeepTrigger()]
            : [vanishingUpkeepTrigger(), vanishingSacrificeTrigger()];

    // Guard against re-expansion (defensive — the seam memo already dedups).
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => injectedTriggers.some((n) => n.id === t.id))) {
        return def;
    }

    const existingCounters = def.entersWith?.counters ?? [];
    return {
        ...def,
        entersWith: {
            ...def.entersWith,
            counters: [
                ...existingCounters,
                { type: counterType, count: parsed.count },
            ],
        },
        triggeredAbilities: [...existing, ...injectedTriggers],
    };
}
