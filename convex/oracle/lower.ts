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

import type { ActivatedAbility, ManaCost } from "../cards/types";
import { readManaCost } from "./manaCost";
import type { CompiledDefinition, OracleCard, ParsedTypeLine } from "./types";
import type { LineParse, SlotIR } from "./grammar/ir";

export type LowerResult =
    | {
          readonly ok: true;
          readonly definition: CompiledDefinition;
          readonly plannedMechanics: readonly string[];
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
    plannedMechanics: string[];
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
            const cost: ActivatedAbility["cost"] = {};
            // Key order matches the catalogue's own hand-written mana abilities
            // so a lockfile row reads like the cards beside it; equality is
            // key-order-insensitive either way (see `gold.ts`).
            if (ir.cost.mana !== undefined) cost.mana = ir.cost.mana;
            if (ir.cost.tap) cost.tap = true;
            const ability: ActivatedAbility = {
                id,
                oracleText: parsed.line,
                cost,
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
        default: {
            const never: never = ir;
            return `no lowering for slot IR ${JSON.stringify(never)}`;
        }
    }
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
        plannedMechanics: [],
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

    return { ok: true, definition, plannedMechanics: acc.plannedMechanics };
}
