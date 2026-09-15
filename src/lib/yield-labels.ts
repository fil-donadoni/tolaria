import { tryGetDefinition } from "@convex/cards";
import { tryGetStateDesignation } from "@convex/cards/designations";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import {
    getAbilityOracleText,
    getDelayedTriggerOracleText,
    getTriggeredAbilityOracleText,
} from "~/lib/card-utils";
import { parseYieldKey, type YieldKey, type YieldKeyParts } from "~/lib/yields";

/** What a **Yield** key reads as in the "Manage yields" box (issue #3629).
 *  Never the raw key and never a definition id — the key is taken apart only by
 *  `parseYieldKey`, beside its minting, and every name is resolved through the
 *  same card / designation / emblem registries the stack row reads. */
export type YieldKeyLabel = {
    /** The source's name: the card, the designation (CR 725) or the emblem
     *  (CR 114). */
    source: string;
    /** `cast` for a spell, else the ability's flavour. */
    kind: string;
    /** The ability's own oracle text when it resolves — what tells two
     *  different abilities of one card apart. */
    detail: string | null;
};

/** One row of the box's **Yields** section. */
export type YieldRow = {
    key: YieldKey;
    /** `<source> — <kind>`, suffixed with an ordinal only when two rows would
     *  otherwise read identically. */
    title: string;
    detail: string | null;
};

const KIND_TEXT: Record<YieldKeyParts["kind"], string> = {
    spell: "cast",
    activated: "activated ability",
    triggered: "triggered ability",
    delayed: "delayed trigger",
};

const UNKNOWN_SOURCE = "Unknown source";

function sourceName(source: YieldKeyParts["source"]): string {
    if (source.type === "designation")
        return tryGetStateDesignation(source.id)?.name ?? UNKNOWN_SOURCE;
    // CR 114 — an emblem-sourced trigger keys under its emblem KEY, which the
    // card registry does not hold; the stack row resolves it the same way.
    return (
        tryGetDefinition(source.id)?.name ??
        tryGetEmblemDefinition(source.id)?.name ??
        UNKNOWN_SOURCE
    );
}

/** The ability's text through the stack row's own resolvers. The two that read
 *  a definition with a THROWING lookup are only called once the definition is
 *  known to exist: a key outlives nothing, but a label must never crash a box. */
function abilityText(parts: YieldKeyParts): string | null {
    if (parts.source.type !== "card" || parts.abilityId === null) return null;
    const cardId = parts.source.id;
    switch (parts.kind) {
        case "activated":
            return tryGetDefinition(cardId)
                ? getAbilityOracleText(cardId, parts.abilityId)
                : null;
        case "triggered":
            return getTriggeredAbilityOracleText(cardId, parts.abilityId);
        case "delayed":
            return tryGetDefinition(cardId)
                ? getDelayedTriggerOracleText(cardId, parts.abilityId)
                : null;
        default:
            return null;
    }
}

export function yieldKeyLabel(key: YieldKey): YieldKeyLabel {
    const parts = parseYieldKey(key);
    if (!parts)
        return { source: UNKNOWN_SOURCE, kind: "ability", detail: null };
    // CR 725 — a designation's end-step draw is an inline delayed trigger in
    // the engine, but to the player it is the Monarch's triggered ability; the
    // stack row labels it the same way.
    const kind =
        parts.source.type === "designation"
            ? KIND_TEXT.triggered
            : KIND_TEXT[parts.kind];
    return {
        source: sourceName(parts.source),
        kind,
        detail: abilityText(parts),
    };
}

/** The **Yields** section's rows, in the seat's key order. Two keys that
 *  still read identically once their ability text is shown (an ability whose
 *  text does not resolve, twice on one card) get an ordinal each, so every row
 *  names something the player can tell apart. */
export function yieldRows(keys: readonly YieldKey[]): YieldRow[] {
    const rows = keys.map((key) => {
        const label = yieldKeyLabel(key);
        return {
            key,
            title: `${label.source} — ${label.kind}`,
            detail: label.detail,
        };
    });
    const identity = (row: YieldRow) => `${row.title}\n${row.detail ?? ""}`;
    const totals = new Map<string, number>();
    for (const row of rows)
        totals.set(identity(row), (totals.get(identity(row)) ?? 0) + 1);
    const seen = new Map<string, number>();
    return rows.map((row) => {
        const id = identity(row);
        if ((totals.get(id) ?? 0) < 2) return row;
        const nth = (seen.get(id) ?? 0) + 1;
        seen.set(id, nth);
        return { ...row, title: `${row.title} #${nth}` };
    });
}

/** A remembered order's source names in its REMEMBERED order — LEFT→RIGHT as
 *  the picker laid it out, so the last name is put on the stack last and
 *  resolves first (CR 405.1). Copies of one card repeat. */
export function triggerOrderSourceNames(order: readonly YieldKey[]): string[] {
    return order.map((key) => yieldKeyLabel(key).source);
}
