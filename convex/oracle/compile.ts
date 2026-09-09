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
import { groupLines } from "./grammar/lineGroups";
import { routeLine } from "./grammar/router";
import type { LineParse } from "./grammar/ir";
import { lowerCard } from "./lower";
import { normalizeOracleText, SELF_MARKER } from "./normalize";
import { BASIC_LAND_TYPES, readTypeLine } from "./typeLine";
import type {
    CompileOutcome,
    CompiledDefinition,
    Gap,
    OracleCard,
    OracleFace,
    ParseContext,
} from "./types";
import type { InsetSpellKind } from "../cards/types";

/**
 * Layouts grammar v0 reads. A multi-faced card (split, transform, adventure, …)
 * has rules text belonging to more than one object, and Scryfall reports it in
 * `card_faces` rather than in `oracle_text` — so compiling the top-level text
 * would compile a fragment of the card while looking complete. Fail closed.
 */
const SUPPORTED_LAYOUTS = new Set<string>(["normal"]);

/**
 * CR 715 / 722 (ADR 0120 §5) — the layouts whose second face is an INSET SPELL
 * rather than a second object, mapped to the `InsetSpellKind` they lower into.
 *
 * These leave the fail-closed bucket above because CR 715.4 / 722.4 make them
 * unlike every other multi-faced layout: "in every zone except the stack … an
 * adventurer card has only its NORMAL characteristics", so no zone ever shows
 * two faces at once and nothing outside the cast path learns anything. A split
 * card (two names and two costs in EVERY zone, CR 709), an MDFC (a back face
 * that is a permanent, CR 712.3) and meld (CR 701.42) stay refused.
 *
 * A `Record`, not a `Set`: the KIND is what the lowered `insetSpell` carries,
 * and CR 722.3 makes it load-bearing (a prepare spell can never be cast). A
 * second entry is one line the day Scryfall reports a preparation layout.
 */
const SUPPORTED_INSET_LAYOUTS: Record<string, InsetSpellKind> = {
    adventure: "adventure",
};

/**
 * The fields the {@link InsetSpell} record can carry. A face that compiled to
 * ANYTHING else is refused rather than truncated: the whole premise of this
 * module's card-level invariant is that "a definition missing one of its
 * abilities is worse than no definition at all", and the inset half is where a
 * silent truncation would be least visible.
 */
const INSET_SPELL_FIELDS = new Set<string>([
    "name",
    "manaCost",
    "types",
    "subtypes",
    "oracleText",
    "effects",
    "targetRequirement",
]);

export function compileCard(card: OracleCard): CompileOutcome {
    const layout = card.layout ?? "normal";
    const insetKind = SUPPORTED_INSET_LAYOUTS[layout];
    if (insetKind !== undefined) return compileInsetLayout(card, insetKind);
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

    // CR 700.2 — a bulleted mode list is part of the clause above it, not a
    // line of its own (`grammar/lineGroups.ts`).
    const grouped = groupLines(normalized.text.lines);
    if (!grouped.ok) {
        return unparsed([
            {
                line: grouped.fragment,
                fragment: grouped.fragment,
                reason: grouped.reason,
            },
        ]);
    }

    const parsedLines: LineParse[] = [];
    const gaps: Gap[] = [];
    for (const line of grouped.lines) {
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
        ungrantableKeywords: lowered.ungrantableKeywords,
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

/** The synthetic single-faced `OracleCard` one FACE of a multi-faced card is,
 *  so each face runs the ordinary `"normal"` pipeline rather than a second
 *  parallel one. */
function faceAsOracleCard(card: OracleCard, face: OracleFace): OracleCard {
    return {
        oracleId: card.oracleId,
        name: face.name,
        manaCost: face.manaCost,
        typeLine: face.typeLine,
        oracleText: face.oracleText,
        ...(face.power !== undefined ? { power: face.power } : {}),
        ...(face.toughness !== undefined ? { toughness: face.toughness } : {}),
        ...(face.loyalty !== undefined ? { loyalty: face.loyalty } : {}),
        layout: "normal",
    };
}

/**
 * CR 715 / 722 (ADR 0120 §5) — compile an inset-spell layout: the FRONT face
 * becomes the card, the second face becomes its `insetSpell`.
 *
 * Both faces run the ordinary pipeline, so a grammar rule written for a normal
 * card serves an Adventure for free and neither face can be half-read. Gaps
 * from BOTH faces are reported together, for the same reason the line loop
 * above does not stop at the first one: the aggregated fragment histogram is
 * what ranks the next grammar rule (PRD #2693 user story 9).
 */
function compileInsetLayout(
    card: OracleCard,
    kind: InsetSpellKind
): CompileOutcome {
    const faces = card.faces ?? [];
    if (faces.length !== 2) {
        return unparsed([
            {
                line: card.typeLine,
                fragment: card.typeLine,
                reason: `layout "${card.layout}" needs exactly two faces, got ${faces.length}`,
            },
        ]);
    }
    const front = compileCard(faceAsOracleCard(card, faces[0]));
    const inset = compileCard(faceAsOracleCard(card, faces[1]));
    if (front.state === "unparsed" || inset.state === "unparsed") {
        return unparsed([
            ...(front.state === "unparsed" ? front.gaps : []),
            ...(inset.state === "unparsed" ? inset.gaps : []),
        ]);
    }
    // Fail CLOSED on anything the `InsetSpell` record cannot carry — a keyword,
    // an activated or triggered ability, a static effect, a mode, an additional
    // cost. Truncating one would produce a card that looks playable and plays
    // wrong, which is exactly what this module's card-level invariant exists to
    // prevent.
    const carried = Object.keys(inset.definition).filter(
        (k) => !INSET_SPELL_FIELDS.has(k)
    );
    if (carried.length > 0) {
        return unparsed([
            {
                line: faces[1].oracleText,
                fragment: faces[1].oracleText,
                reason: `inset spell carries ${carried.join(", ")}, which an InsetSpell cannot hold`,
            },
        ]);
    }
    const insetDef = inset.definition;
    const definition: CompiledDefinition = {
        ...front.definition,
        insetSpell: {
            kind,
            name: insetDef.name,
            ...(insetDef.manaCost ? { manaCost: insetDef.manaCost } : {}),
            types: [...insetDef.types],
            ...(insetDef.subtypes ? { subtypes: [...insetDef.subtypes] } : {}),
            oracleText: faces[1].oracleText,
            ...(insetDef.effects ? { effects: insetDef.effects } : {}),
            ...(insetDef.targetRequirement
                ? { targetRequirement: insetDef.targetRequirement }
                : {}),
        },
    };
    const opsUsed = [...new Set([...front.opsUsed, ...inset.opsUsed])].sort();
    const slots = [...new Set([...front.slots, ...inset.slots])].sort();
    const reasons = [
        ...(front.state === "quarantine" ? front.reasons : []),
        ...(inset.state === "quarantine" ? inset.reasons : []),
    ];
    // One card is one card (CR 715.2c): a quarantined FACE quarantines the
    // card, never half of it.
    return reasons.length > 0
        ? { state: "quarantine", definition, opsUsed, slots, reasons }
        : { state: "ready", definition, opsUsed, slots };
}
