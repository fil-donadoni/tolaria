// Human name for a Limited Event. The wire carries the raw machine shape —
// `type: "draft"` plus `packSlots: ["vintage-cube", "vintage-cube",
// "vintage-cube"]` (one entry PER BOOSTER, so a 3-pack draft repeats its
// source three times) — which rendered literally reads
// "draft — VINTAGE-CUBE, VINTAGE-CUBE, VINTAGE-CUBE". The repetition carries
// no information a player wants: the pack COUNT is already visible as
// "Booster 1 of 3". An event's name is the label of its Limited Origin
// (ADR 0106 §6, issue #5393) — the same words a deck saved from it is named
// by default — so both derive from ONE key (`convex/limited/limitedOrigin.ts`).
import {
    limitedOriginKey,
    limitedOriginLabel,
    packSourceName,
    type LimitedOriginSource,
} from "@convex/limited/limitedOrigin";

export { packSourceName };

/**
 * Full event name — "Vintage Cube Draft", "Limited Edition Alpha Sealed", or
 * "Invasion / Planeshift / Apocalypse Draft" for a multi-set block draft.
 */
export function limitedEventName(event: LimitedOriginSource): string {
    // A key built from an event always parses, so the label is never null.
    return limitedOriginLabel(limitedOriginKey(event)) ?? "";
}
