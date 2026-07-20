import type { CardInstance } from "~/types/game";

/** A counter type ready for display: the raw key, its live count, a
 *  human-readable label, a compact badge token, and a visual tone. */
export type CounterDisplay = {
    type: string;
    count: number;
    /** Full label for the card preview (e.g. "+1/+1", "Gaea's Forest"). */
    label: string;
    /** Compact token for the on-card badge (e.g. "+1/+1", "WIN"). */
    short: string;
    tone: "buff" | "debuff" | "neutral";
};

/** P/T-modifying counters (CR 122 / layer 7d) — match `+N/+N`, `-N/-N`,
 *  `+N/-N`, etc. These fold into effective stats; everything else is a named
 *  counter (corpse, wind, mire, …) that is inert for stats. */
const PT_COUNTER_RE = /^[+-]\d+\/[+-]\d+$/;

export function isPTCounter(type: string): boolean {
    return PT_COUNTER_RE.test(type);
}

/** Title-case a kebab/space counter key: "gaea-forest" → "Gaea Forest". */
function titleCase(type: string): string {
    return type
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/** Compact ≤3-char token for a named counter badge: "wind" → "WIN",
 *  "gaea-forest" → "GF" (initials when multi-word). */
function shortToken(type: string): string {
    const words = type.split(/[-_\s]+/).filter(Boolean);
    if (words.length > 1) {
        return words
            .map((w) => w.charAt(0))
            .join("")
            .toUpperCase()
            .slice(0, 3);
    }
    return type.slice(0, 3).toUpperCase();
}

function toneFor(type: string): CounterDisplay["tone"] {
    if (!isPTCounter(type)) return "neutral";
    // Sign of the power component decides buff/debuff; "+0/+1" is still a buff.
    const [p, t] = type.split("/");
    const negative = p.startsWith("-") && t.startsWith("-");
    if (negative) return "debuff";
    return p.startsWith("-") || t.startsWith("-") ? "neutral" : "buff";
}

/** Shared plate-chip classes per counter tone (phase-3 plate language).
 *  Used by the battlefield CounterBadges and the pile-dialog counter chips. */
export const COUNTER_TONE_CLASS: Record<CounterDisplay["tone"], string> = {
    buff: "border border-success/60 bg-success text-surface-base",
    debuff: "border border-danger/60 bg-danger text-parchment",
    neutral:
        "border border-signal-pending/60 bg-signal-pending text-surface-base",
};

/** Derive the ordered, non-empty counter list for a card. P/T counters first
 *  (most game-relevant), then named counters; both alphabetised within group.
 *  Zero/negative counts are dropped. */
export function getCounterDisplays(card: CardInstance): CounterDisplay[] {
    const counters = card.counters;
    if (!counters) return [];
    return (
        Object.entries(counters)
            // CR 306.5b — loyalty counters are shown by the dedicated planeswalker
            // loyalty badge (bottom-right), not as a generic named-counter badge.
            .filter(([type, count]) => count > 0 && type !== "loyalty")
            .map(([type, count]) => ({
                type,
                count,
                label: isPTCounter(type) ? type : titleCase(type),
                short: isPTCounter(type) ? type : shortToken(type),
                tone: toneFor(type),
            }))
            .sort((a, b) => {
                const ap = isPTCounter(a.type) ? 0 : 1;
                const bp = isPTCounter(b.type) ? 0 : 1;
                return ap - bp || a.type.localeCompare(b.type);
            })
    );
}
