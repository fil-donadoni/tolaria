/**
 * `compileCard` — the whole pipeline, and the place the all-consuming invariant
 * is enforced at CARD level rather than at line level.
 *
 * Line level is already covered structurally (`rule.ts`: no residue field) and
 * slot level by unique dispatch (`grammar/router.ts`). What remains is the
 * card: a card is `ready`/`quarantine` only if EVERY normalised line was
 * consumed by a slot. One unconsumed line fails the whole card — not just that
 * ability — because a definition missing one of its abilities is worse than no
 * definition at all. It looks playable and plays wrong.
 *
 * Note the loop below does not stop at the first gap. Every failing line is
 * recorded, because the aggregated fragment histogram is what ranks the next
 * grammar rule by corpus count (PRD #2693 user story 9).
 */

import { runGates } from "./gates";
import { routeLine } from "./grammar/router";
import type { LineParse } from "./grammar/ir";
import { lowerCard } from "./lower";
import { normalizeOracleText, SELF_MARKER } from "./normalize";
import { BASIC_LAND_TYPES, readTypeLine } from "./typeLine";
import type { CompileOutcome, Gap, OracleCard, ParseContext } from "./types";

/**
 * Layouts grammar v0 reads. A multi-faced card (split, transform, adventure, …)
 * has rules text belonging to more than one object, and Scryfall reports it in
 * `card_faces` rather than in `oracle_text` — so compiling the top-level text
 * would compile a fragment of the card while looking complete. Fail closed.
 */
const SUPPORTED_LAYOUTS = new Set<string>(["normal"]);

export function compileCard(card: OracleCard): CompileOutcome {
    const layout = card.layout ?? "normal";
    if (!SUPPORTED_LAYOUTS.has(layout)) {
        return unparsed([
            {
                line: card.typeLine,
                fragment: card.typeLine,
                reason: `layout "${layout}" is not in grammar v0 (multi-faced cards)`,
            },
        ]);
    }

    const typeLine = readTypeLine(card.typeLine);
    if (!typeLine.ok) {
        return unparsed([
            {
                line: card.typeLine,
                fragment: typeLine.fragment,
                reason: typeLine.reason,
            },
        ]);
    }

    // CR 305.6 — a land with a basic land type has the INTRINSIC ability
    // "{T}: Add [mana symbol]" even when the text box does not say so, so
    // whether the compiled definition should carry an explicit ability is a
    // question about how the engine models intrinsic abilities, not a question
    // about the text. The catalogue answers it both ways, and both answers are
    // load-bearing: `getBasicLandMana` (convex/gre/constants.ts) returns the
    // FIRST basic subtype's colour, so a one-type land (Forest) needs no
    // explicit ability and a two-type land (Badlands) does. Neither is
    // derivable from the Oracle text, which for both is pure reminder text.
    // Fail closed until #2697 settles it — see
    // docs/findings/2694-basic-land-type-mana-encoding.md.
    if (
        typeLine.parsed.types.includes("Land") &&
        typeLine.parsed.subtypes.some((s) => BASIC_LAND_TYPES.has(s))
    ) {
        return unparsed([
            {
                line: card.typeLine,
                fragment: card.typeLine,
                reason: "land with a basic land type — intrinsic mana ability (CR 305.6) is not in grammar v0",
            },
        ]);
    }

    const normalized = normalizeOracleText(card);
    if (!normalized.ok) {
        return unparsed([
            {
                line: card.oracleText,
                fragment: normalized.fragment,
                reason: normalized.reason,
            },
        ]);
    }

    const ctx: ParseContext = {
        card,
        typeLine: typeLine.parsed,
        selfMarker: SELF_MARKER,
    };

    const parsedLines: LineParse[] = [];
    const gaps: Gap[] = [];
    for (const line of normalized.text.lines) {
        const routed = routeLine(line, ctx);
        if (routed.ok) parsedLines.push(routed.value);
        else
            gaps.push({
                line,
                fragment: routed.fragment,
                reason: routed.reason,
            });
    }
    if (gaps.length > 0) return unparsed(gaps);

    const lowered = lowerCard(card, typeLine.parsed, parsedLines);
    if (!lowered.ok) {
        return unparsed([
            {
                line: lowered.fragment,
                fragment: lowered.fragment,
                reason: lowered.reason,
            },
        ]);
    }

    const slots = [...new Set(parsedLines.map((p) => p.slot))].sort();
    const { opsUsed, reasons } = runGates({
        oracleId: card.oracleId,
        definition: lowered.definition,
        plannedMechanics: lowered.plannedMechanics,
    });

    if (reasons.length > 0) {
        return {
            state: "quarantine",
            definition: lowered.definition,
            opsUsed,
            slots,
            reasons,
        };
    }
    return { state: "ready", definition: lowered.definition, opsUsed, slots };
}

function unparsed(gaps: readonly Gap[]): CompileOutcome {
    return { state: "unparsed", gaps };
}
