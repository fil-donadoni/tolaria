/**
 * Lowering — intermediate form → `CardDefinition` fields.
 *
 * The second place a clause can go missing. A grammar can consume a line
 * perfectly and then lower only half of what it understood, and the result
 * looks exactly like a correct compile. Two things stop that here:
 *
 *  1. `lowerLine` switches on `SlotIR["kind"]` with an exhaustiveness check, so
 *     a slot that has no lowering is a TYPE ERROR at build time rather than a
 *     silently ignored ability at run time.
 *  2. Every field it writes is derived from the whole IR node. There is no
 *     "take the first keyword" or "take the first mana option" anywhere below —
 *     the IR nodes carry lists, and the lists are lowered whole.
 */

import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    ManaCost,
    SpellMode,
    TargetRequirement,
} from "../cards/types";
import type { CompiledStaticEffect } from "../cards/compiledStatics";
import type { CompiledTriggeredAbility } from "../cards/compiledTriggers";
import { lowerActivationCost } from "./grammar/shared/cost";
import { lowerActivatedAbility } from "./lowerActivated";
import {
    lowerAdditionalCosts,
    lowerFlashback,
    lowerSpellBody,
    lowerSpellModes,
} from "./lowerSpell";
import { isDefinitionLevelKeyword, lowerStaticClause } from "./lowerStatic";
import { lowerTriggeredAbility } from "./lowerTriggered";
import { readManaCost } from "./manaCost";
import type { CompiledDefinition, OracleCard, ParsedTypeLine } from "./types";
import type { LineParse, SlotIR } from "./grammar/ir";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";

export type LowerResult =
    | {
          readonly ok: true;
          readonly definition: CompiledDefinition;
          readonly plannedMechanics: readonly string[];
          readonly ungrantableKeywords: readonly string[];
      }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

/** Deterministic, stable ability ids — the catalogue's own `<card>-mana` shape. */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

interface Accumulator {
    staticAbilities: string[];
    activatedAbilities: ActivatedAbility[];
    compiledTriggeredAbilities: CompiledTriggeredAbility[];
    compiledStaticEffects: CompiledStaticEffect[];
    entersTapped: boolean;
    entersWithCounters: { type: string; count: number }[];
    plannedMechanics: string[];
    ungrantableKeywords: string[];
    /** CR 113.3a — the spell site: at most one per card, see `lowerLine`. */
    spellEffects?: EffectOp[];
    spellTargetRequirement?: TargetRequirement;
    spellModes?: SpellMode[];
    additionalCosts?: NonNullable<CardDefinition["additionalCosts"]>;
    flashback?: NonNullable<CardDefinition["flashback"]>;
}

/**
 * CR 702.1 / #962 — census the keywords an effect SENTENCE grants.
 *
 * The mirror of what `lowerStatic.ts` does for a `keyword-grant` static
 * clause, and it exists for the same reason: `status: "implemented"` is the
 * only thing standing between a grant and a card that resolves and does
 * nothing. Guard A polices `staticAbilities[]`, which a `grantAbility` Op
 * never touches — the grant writes the TARGET instance's abilities at
 * resolution — so nothing else in the pipeline asks the question.
 *
 * Called from every slot whose IR carries effect sentences, rather than from
 * `lowerSentence`, because the census is a CARD-level tally (`plannedMechanics`
 * quarantines the card, not the ability) and routing it through the per-Op
 * lowering would mean threading an accumulator through three call sites to
 * reach the same list.
 */
function censusGrantedKeywords(
    effects: readonly EffectSentenceIR[],
    acc: Accumulator
): void {
    for (const sentence of effects) {
        if (sentence.kind !== "grant-ability") continue;
        const { ability, status } = sentence.keyword;
        if (status !== "implemented") acc.plannedMechanics.push(ability);
        // CR 702.1 — a keyword whose behaviour comes from an ADR 0054
        // definition-level expander produces NOTHING when granted to another
        // permanent, because the expander never reads the target instance's
        // `staticAbilities` (issue #2700).
        else if (isDefinitionLevelKeyword(ability))
            acc.ungrantableKeywords.push(ability);
    }
}

function lowerLine(
    parsed: LineParse,
    card: OracleCard,
    acc: Accumulator
): string | null {
    const ir: SlotIR = parsed.ir;
    switch (ir.kind) {
        case "keywords": {
            for (const kw of ir.keywords) {
                acc.staticAbilities.push(kw.ability);
                // CR 702.1 — a keyword IS its rule; if the engine does not
                // implement it, the card would ship silently inert (the Guard A
                // shape, #962). Recorded, then quarantined by the gates.
                if (kw.status !== "implemented")
                    acc.plannedMechanics.push(kw.ability);
            }
            return null;
        }
        case "mana-ability": {
            const index = acc.activatedAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-mana`
                    : `${slugify(card.name)}-mana-${index + 1}`;
            // The cost lowering is shared with the stack-using activated slot
            // (CR 602.1a draws no distinction); only the EFFECT half differs.
            const cost = lowerActivationCost(ir.cost);
            if (!cost.ok) return cost.reason;
            const ability: ActivatedAbility = {
                id,
                oracleText: parsed.line,
                cost: cost.value,
                // CR 605.3b — a mana ability doesn't go on the stack. Safe to emit
                // unconditionally: see the CR 605.1a argument in the slot file.
                useStack: false,
            };
            if (ir.produces.kind === "fixed")
                ability.manaProduced = ir.produces.mana;
            else ability.manaChoices = ir.produces.options as ManaCost[];
            acc.activatedAbilities.push(ability);
            return null;
        }
        case "activated": {
            const index = acc.activatedAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-ability`
                    : `${slugify(card.name)}-ability-${index + 1}`;
            censusGrantedKeywords(ir.effects, acc);
            const lowered = lowerActivatedAbility({
                id,
                oracleText: parsed.line,
                cost: ir.cost,
                effects: ir.effects,
                restrictions: ir.restrictions,
            });
            if (!lowered.ok) return lowered.reason;
            acc.activatedAbilities.push(lowered.ability);
            return null;
        }
        case "triggered": {
            const index = acc.compiledTriggeredAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-trigger`
                    : `${slugify(card.name)}-trigger-${index + 1}`;
            censusGrantedKeywords(ir.effects, acc);
            const lowered = lowerTriggeredAbility({
                id,
                oracleText: parsed.line,
                head: ir.head,
                ...(ir.condition !== undefined
                    ? { condition: ir.condition }
                    : {}),
                effects: ir.effects,
            });
            if (!lowered.ok) return lowered.reason;
            acc.compiledTriggeredAbilities.push(lowered.ability);
            return null;
        }
        case "static": {
            const lowered = lowerStaticClause(ir.clause);
            if (!lowered.ok) return lowered.reason;
            const out = lowered.lowered;
            if (out.effect !== undefined)
                acc.compiledStaticEffects.push(out.effect);
            // CR 702.1 — see `lowerStatic.ts`: a granted keyword is censused
            // exactly like a printed one, so an unimplemented grant
            // quarantines instead of shipping an inert card.
            if (
                out.grantedKeyword !== undefined &&
                !out.grantedKeyword.implemented
            )
                acc.plannedMechanics.push(out.grantedKeyword.ability);
            if (out.ungrantableKeyword !== undefined)
                acc.ungrantableKeywords.push(out.ungrantableKeyword);
            if (out.entersTapped === true) acc.entersTapped = true;
            if (out.entersWithCounters !== undefined)
                acc.entersWithCounters.push(out.entersWithCounters);
            if (out.staticAbility !== undefined) {
                // The same duplicate check the keyword-line slot pays: a
                // marker named twice on one card is a sign a line was misread,
                // not something to silently dedupe.
                if (acc.staticAbilities.includes(out.staticAbility))
                    return `"${out.staticAbility}" is declared twice on one card`;
                acc.staticAbilities.push(out.staticAbility);
            }
            return null;
        }
        case "spell": {
            // CR 113.3a — a spell has ONE resolution body. Two spell-text
            // lines on one card is not a card that resolves twice; it is a
            // card whose lines we have misread (an unread trailing clause
            // routed as a second sentence, say), so it fails rather than
            // silently concatenating into one script.
            if (acc.spellEffects !== undefined || acc.spellModes !== undefined)
                return "a card declares spell text twice (CR 113.3a)";
            censusGrantedKeywords(ir.effects, acc);
            const body = lowerSpellBody(ir.effects, {
                // CR 107.3 — a spell announces X for the `{X}` pip in its own
                // printed mana cost, and only then. Judged HERE because it is
                // a fact about the cost rather than about the sentence
                // (`lowerEffects.ts` — `SiteOptions`).
                allowX: hasVariableX(card.manaCost),
            });
            if (!body.ok) return body.reason;
            acc.spellEffects = body.value.effects;
            if (body.value.targetRequirement !== undefined)
                acc.spellTargetRequirement = body.value.targetRequirement;
            return null;
        }
        case "spell-modal": {
            if (acc.spellEffects !== undefined || acc.spellModes !== undefined)
                return "a card declares spell text twice (CR 113.3a)";
            for (const mode of ir.modes)
                censusGrantedKeywords(mode.effects, acc);
            const modes = lowerSpellModes(
                ir.modes,
                { slug: slugify(card.name), name: card.name },
                { allowX: hasVariableX(card.manaCost) }
            );
            if (!modes.ok) return modes.reason;
            acc.spellModes = modes.value;
            return null;
        }
        case "additional-cost": {
            // CR 601.2f — two additional-cost lines would both be paid, and
            // merging them into one `additionalCosts` record would silently
            // drop whichever field the second reuses.
            if (acc.additionalCosts !== undefined)
                return "a card declares an additional cost twice (CR 601.2f)";
            const costs = lowerAdditionalCosts(ir.cost.atoms);
            if (!costs.ok) return costs.reason;
            acc.additionalCosts = costs.value;
            return null;
        }
        case "flashback": {
            if (acc.flashback !== undefined)
                return "a card declares flashback twice (CR 702.34a)";
            const flashback = lowerFlashback(ir.cost);
            if (!flashback.ok) return flashback.reason;
            acc.flashback = flashback.value;
            return null;
        }
        default: {
            const never: never = ir;
            return `no lowering for slot IR ${JSON.stringify(never)}`;
        }
    }
}

/**
 * CR 107.3 — does the printed mana cost announce a value for {X}?
 *
 * Read off the RAW printed string rather than the parsed `ManaCost`, because
 * the parse happens later (and can fail) while this question is asked as each
 * line is lowered. `readManaCost` writes a variable pip as `X: "X"`; the
 * printed form is the literal symbol, and nothing else in a cost string
 * contains it.
 */
function hasVariableX(printedManaCost: string): boolean {
    return printedManaCost.includes("{X}");
}

/** CR 208.1 — power/toughness are printed numbers; `*` is a CDA (#2700). */
function readPt(
    value: string | undefined,
    what: string
): number | { error: string } {
    if (value === undefined)
        return { error: `creature has no printed ${what}` };
    if (!/^-?\d+$/.test(value))
        return { error: `non-numeric ${what} "${value}"` };
    return Number(value);
}

export function lowerCard(
    card: OracleCard,
    typeLine: ParsedTypeLine,
    lines: readonly LineParse[]
): LowerResult {
    const acc: Accumulator = {
        staticAbilities: [],
        activatedAbilities: [],
        compiledTriggeredAbilities: [],
        compiledStaticEffects: [],
        entersTapped: false,
        entersWithCounters: [],
        plannedMechanics: [],
        ungrantableKeywords: [],
    };
    for (const line of lines) {
        const err = lowerLine(line, card, acc);
        if (err !== null)
            return { ok: false, reason: err, fragment: line.line };
    }

    const definition: CompiledDefinition = {
        name: card.name,
        types: [...typeLine.types],
    };
    if (typeLine.supertypes.length > 0)
        definition.supertypes = [...typeLine.supertypes];
    if (typeLine.subtypes.length > 0)
        definition.subtypes = [...typeLine.subtypes];

    if (card.manaCost.trim().length > 0) {
        const cost = readManaCost(card.manaCost);
        if (!cost.ok)
            return { ok: false, reason: cost.reason, fragment: cost.fragment };
        definition.manaCost = cost.cost;
    }

    if (typeLine.types.includes("Creature")) {
        const power = readPt(card.power, "power");
        if (typeof power !== "number")
            return { ok: false, reason: power.error, fragment: card.typeLine };
        const toughness = readPt(card.toughness, "toughness");
        if (typeof toughness !== "number")
            return {
                ok: false,
                reason: toughness.error,
                fragment: card.typeLine,
            };
        definition.power = power;
        definition.toughness = toughness;
    }
    if (typeLine.types.includes("Planeswalker")) {
        const loyalty = readPt(card.loyalty, "loyalty");
        if (typeof loyalty !== "number")
            return {
                ok: false,
                reason: loyalty.error,
                fragment: card.typeLine,
            };
        definition.loyalty = loyalty;
    }

    if (card.oracleText.length > 0) definition.oracleText = card.oracleText;
    if (acc.staticAbilities.length > 0)
        definition.staticAbilities = acc.staticAbilities;
    if (acc.activatedAbilities.length > 0)
        definition.activatedAbilities = acc.activatedAbilities;
    // CR 113.3c — descriptors, not abilities: the seam rebuilds them
    // (`cards/compiledTriggers.ts`). Nothing downstream of the compiler ever
    // sees this field — `expandDefinition` consumes it.
    if (acc.compiledTriggeredAbilities.length > 0)
        definition.compiledTriggeredAbilities = acc.compiledTriggeredAbilities;
    // CR 611 — descriptors, not effects, for the same reason as the triggers
    // above: `StaticEffect` is a predicate closure and the compiler emits JSON
    // (`cards/compiledStatics.ts`). `expandDefinition` consumes the field.
    if (acc.compiledStaticEffects.length > 0)
        definition.compiledStaticEffects = acc.compiledStaticEffects;
    // CR 614.1c / 122.1 — entry riders, applied AS the permanent enters. Never
    // a continuous effect and never a trigger (issue #1693).
    if (acc.entersTapped) definition.entersTapped = true;
    if (acc.entersWithCounters.length > 0)
        definition.entersWith = { counters: acc.entersWithCounters };
    // CR 113.3a — the spell site. `modes` and `effects` are mutually exclusive
    // by construction (one `lowerLine` case writes each, and the second one to
    // run fails the card), which is also what `validateEffectScript` asserts.
    // CR 601.2f / 702.34a — an additional cost and a flashback cost are RIDERS
    // on casting the spell; neither is a spell. A card that consumed one and
    // no body line is a card whose effect line we failed to read while
    // reporting success, so it fails rather than compiling to a castable spell
    // that does nothing. (No corpus card reaches this today — it is the
    // invariant, not a fix.)
    if (
        (acc.additionalCosts !== undefined || acc.flashback !== undefined) &&
        acc.spellEffects === undefined &&
        acc.spellModes === undefined
    )
        return {
            ok: false,
            reason: "a cast-time cost rider with no spell text to ride on",
            fragment: card.oracleText,
        };
    if (acc.spellEffects !== undefined) definition.effects = acc.spellEffects;
    if (acc.spellTargetRequirement !== undefined)
        definition.targetRequirement = acc.spellTargetRequirement;
    if (acc.spellModes !== undefined) definition.modes = acc.spellModes;
    if (acc.additionalCosts !== undefined)
        definition.additionalCosts = acc.additionalCosts;
    if (acc.flashback !== undefined) definition.flashback = acc.flashback;

    return {
        ok: true,
        definition,
        plannedMechanics: acc.plannedMechanics,
        ungrantableKeywords: acc.ungrantableKeywords,
    };
}
