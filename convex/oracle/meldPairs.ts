/**
 * CR 712.4 / 712.4a (issue #7581) — resolve the meld PAIRS of a corpus.
 *
 * Every other multi-faced layout reaches the compiler as ONE row carrying its
 * faces in `card_faces`. Meld does not: Scryfall reports the two front cards
 * and the combined back face as THREE separate rows, all `layout: "meld"`, and
 * nothing in a single row says which role it plays. The pair is stated in the
 * rules text instead — CR 712.4a puts the meld ability on exactly one card of
 * the pair, and that ability names both the counterpart ("… and a creature
 * named Hanweir Garrison …") and the combined back face ("… meld them into
 * Hanweir, the Writhing Township").
 *
 * So the pairing is a CORPUS-level fact the per-card compiler cannot see, and
 * it is resolved here, once, before `compileCard` runs: each front card gets
 * the combined back face as `meldBack`, and the back-face row is marked
 * `meldResult`. Names are matched against the corpus's own meld card names
 * rather than cut out of the sentence by punctuation, because a name may hold
 * a comma ("Argoth, Sanctum of Nature, exile them") and a sentence may run on
 * past it ("Mishra, Lost to Phyrexia. It enters tapped").
 *
 * A meld card this cannot place keeps neither field, and `compileCard`
 * refuses it as unpaired — never compiled as a lone front face that looks
 * complete.
 */

import type { OracleCard, OracleFace } from "./types";

/** Scryfall's layout string for every row of a meld pair. */
export const MELD_LAYOUT = "meld";

/** The meld ability's operative clause (CR 701.42a), as Oracle prints it on
 *  every meld card of the corpus. */
export const MELD_CLAUSE = "exile them, then meld them into ";

function faceOf(card: OracleCard): OracleFace {
    return {
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        ...(card.power !== undefined ? { power: card.power } : {}),
        ...(card.toughness !== undefined ? { toughness: card.toughness } : {}),
        ...(card.loyalty !== undefined ? { loyalty: card.loyalty } : {}),
    };
}

/** The meld card whose name directly follows `lead` in `text`, if any — the
 *  LONGEST such name, so a name that is a prefix of another ("Urza" beside
 *  "Urza, Planeswalker") can never win by corpus order. */
function namedAfter(
    text: string,
    lead: string,
    candidates: readonly OracleCard[]
): OracleCard | undefined {
    let best: OracleCard | undefined;
    for (const c of candidates) {
        if (!text.includes(`${lead}${c.name}`)) continue;
        if (best === undefined || c.name.length > best.name.length) best = c;
    }
    return best;
}

/**
 * The corpus with every resolvable meld pair stamped: `meldBack` on both
 * front cards, `meldResult` on the combined back face. Rows of any other
 * layout pass through untouched (same object).
 */
export function withMeldPairs(
    cards: readonly OracleCard[]
): readonly OracleCard[] {
    const meld = cards.filter((c) => c.layout === MELD_LAYOUT);
    if (meld.length === 0) return cards;

    const claims: {
        holder: OracleCard;
        partner: OracleCard;
        result: OracleCard;
    }[] = [];
    const claimed = new Map<string, number>();
    for (const holder of meld) {
        const result = namedAfter(holder.oracleText, MELD_CLAUSE, meld);
        const partner = namedAfter(holder.oracleText, "named ", meld);
        if (result === undefined || partner === undefined) continue;
        if (result === holder || partner === holder || result === partner) {
            continue;
        }
        claims.push({ holder, partner, result });
        for (const c of [holder, partner]) {
            claimed.set(c.oracleId, (claimed.get(c.oracleId) ?? 0) + 1);
        }
    }

    // A front card claimed by two holders is a corpus the rules cannot
    // produce (CR 701.42b: a pair is two cards). EVERY claim touching it is
    // dropped, so none of their cards is stamped and each is refused as
    // unpaired rather than melded by whichever claim came first.
    const backOf = new Map<string, OracleFace>();
    const results = new Set<string>();
    for (const { holder, partner, result } of claims) {
        if (claimed.get(holder.oracleId) !== 1) continue;
        if (claimed.get(partner.oracleId) !== 1) continue;
        const back = faceOf(result);
        backOf.set(holder.oracleId, back);
        backOf.set(partner.oracleId, back);
        results.add(result.oracleId);
    }

    return cards.map((card) => {
        if (card.layout !== MELD_LAYOUT) return card;
        // A row that is both a back face and a front card would be a corpus
        // the rules cannot produce; it keeps neither field and is refused.
        if (results.has(card.oracleId)) {
            return backOf.has(card.oracleId)
                ? card
                : { ...card, meldResult: true };
        }
        const back = backOf.get(card.oracleId);
        return back === undefined ? card : { ...card, meldBack: back };
    });
}
