import type { ScenarioCard } from "@convex/debugScenarioSpec";

/** One counter row in the card editor — kept as strings while editing. */
export type CounterDraft = { type: string; count: string };

/** Editable form representation of a `ScenarioCard`. Numeric fields live as raw
 *  strings so a field can be transiently empty; `counters` is an ordered list
 *  (a `Record` is awkward to edit key-by-key). `draftToCard` collapses it back
 *  to a clean `ScenarioCard`, omitting empty/default fields so the saved spec
 *  stays minimal. */
export type CardDraft = {
    name: string;
    owner: "me" | "opp";
    zone: NonNullable<ScenarioCard["zone"]>;
    count: string;
    tapped: boolean;
    summoningSick: boolean;
    counters: CounterDraft[];
    damageMarked: string;
    attachedTo: string;
    copyOf: string;
    position: string;
    faceDown: boolean;
    faceDownExile: boolean;
    castableFromExile: boolean;
    /** CR 305.9 (issue #1689) — only meaningful alongside `castableFromExile`;
     *  true stages the LAND-INCLUSIVE grant shape (Headliner Scarlett /
     *  Expressive Iteration: "you may PLAY that card"), false/omitted stages
     *  the cast-only shape (Ice Cauldron / Robber of the Rich / Ragavan)
     *  under which a land in exile gets no play (or cast) affordance. */
    castableFromExileIncludesLand: boolean;
    attackedLastTurn: boolean;
};

/** A fresh, empty card row (defaults to a battlefield permanent the player
 *  controls — the most common placement). */
export function emptyCardDraft(): CardDraft {
    return {
        name: "",
        owner: "me",
        zone: "battlefield",
        count: "1",
        tapped: false,
        summoningSick: false,
        counters: [],
        damageMarked: "",
        attachedTo: "",
        copyOf: "",
        position: "",
        faceDown: false,
        faceDownExile: false,
        castableFromExile: false,
        castableFromExileIncludesLand: false,
        attackedLastTurn: false,
    };
}

/** Inflate a stored `ScenarioCard` back into an editable draft (inverse of
 *  `draftToCard`) so an existing scenario can be opened in the form. Missing
 *  optionals fall back to the same defaults `emptyCardDraft` uses. */
export function cardToDraft(card: ScenarioCard): CardDraft {
    return {
        name: card.name,
        owner: card.owner,
        zone: card.zone ?? "battlefield",
        count: card.count !== undefined ? String(card.count) : "1",
        tapped: card.tapped ?? false,
        summoningSick: card.summoningSick ?? false,
        counters: Object.entries(card.counters ?? {}).map(([type, count]) => ({
            type,
            count: String(count),
        })),
        damageMarked:
            card.damageMarked !== undefined ? String(card.damageMarked) : "",
        attachedTo: card.attachedTo ?? "",
        copyOf: card.copyOf ?? "",
        position: card.position !== undefined ? String(card.position) : "",
        faceDown: card.faceDown ?? false,
        faceDownExile: card.faceDownExile ?? false,
        castableFromExile: card.castableFromExile ?? false,
        castableFromExileIncludesLand:
            card.castableFromExileIncludesLand ?? false,
        attackedLastTurn: card.attackedLastTurn ?? false,
    };
}

function num(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

/** Collapse an editable draft into a clean `ScenarioCard`, dropping empty and
 *  default-valued fields so the persisted spec carries only what was set. */
export function draftToCard(draft: CardDraft): ScenarioCard {
    const card: ScenarioCard = { name: draft.name.trim(), owner: draft.owner };
    if (draft.zone !== "battlefield") card.zone = draft.zone;

    const count = num(draft.count);
    if (count !== undefined && count !== 1) card.count = count;
    if (draft.tapped) card.tapped = true;
    if (draft.summoningSick) card.summoningSick = true;

    const counters: Record<string, number> = {};
    for (const c of draft.counters) {
        const key = c.type.trim();
        const value = num(c.count);
        if (key !== "" && value !== undefined) counters[key] = value;
    }
    if (Object.keys(counters).length > 0) card.counters = counters;

    const damage = num(draft.damageMarked);
    if (damage !== undefined && damage !== 0) card.damageMarked = damage;
    const position = num(draft.position);
    if (position !== undefined) card.position = position;

    if (draft.attachedTo.trim() !== "")
        card.attachedTo = draft.attachedTo.trim();
    if (draft.copyOf.trim() !== "") card.copyOf = draft.copyOf.trim();

    if (draft.faceDown) card.faceDown = true;
    if (draft.faceDownExile) card.faceDownExile = true;
    if (draft.castableFromExile) card.castableFromExile = true;
    if (draft.castableFromExileIncludesLand)
        card.castableFromExileIncludesLand = true;
    if (draft.attackedLastTurn) card.attackedLastTurn = true;

    return card;
}
