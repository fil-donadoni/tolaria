/**
 * Shared sub-grammar: ACTIVATION COST (CR 602.1a, CR 118.1).
 *
 * Everything before the colon of "[Cost]: [Effect.]" — a comma-separated list
 * of cost atoms, each of which must be recognised WHOLE.
 *
 * ── Why the cost half fails harder than the effect half ────────────────────
 *
 * A dropped clause in an effect makes a card do too little. A dropped clause in
 * a COST makes an illegal activation legal, which is unbounded: "{T}, Sacrifice
 * this creature: ..." read as "{T}: ..." is an infinite engine. So every atom
 * here either maps onto a declared field of `ActivatedAbility["cost"]` or the
 * whole line is refused — there is no field-less atom, and no atom is dropped
 * because the engine has nowhere to put it.
 *
 * This is also the sub-grammar the MANA ability slot shares (CR 605.1a): a mana
 * ability's cost is an activation cost like any other, and before this file
 * existed the mana slot carried a private two-atom copy that could not read
 * "Sacrifice a Goblin: Add {R}" or "{T}, Pay 1 life: Add {B} or {R}". None of
 * the atoms below moves a card to or from a library, so CR 605.1a's fourth
 * criterion still holds by construction for everything the mana slot accepts.
 */

import type {
    ActivatedAbility,
    CardType,
    EffectCardFilter,
    ManaCost,
    PermanentFilter,
} from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import { SELF_MARKER } from "../../normalize";
import { fail, listOf, ok, rule, type Rule, type RuleResult } from "../../rule";
import { readNumberWord } from "./quantity";
import { descriptorRule, permanentFilterFromDescriptor } from "./targetFilter";

export const ACTIVATION_COST = "activation cost";

export type CostAtomIR =
    /** CR 107.5 — the tap symbol: tap the source permanent. */
    | { readonly kind: "tap" }
    | { readonly kind: "mana"; readonly mana: ManaCost }
    /** CR 701.21a — sacrifice: "Sacrifice this creature". */
    | { readonly kind: "sacrifice-self" }
    /** CR 602.1 / 118.5 — "Sacrifice a creature", a chosen permanent. */
    | {
          readonly kind: "sacrifice-other";
          readonly filter: PermanentFilter;
          readonly count: number;
      }
    /** CR 119.4 — "Pay 2 life". */
    | { readonly kind: "pay-life"; readonly amount: number }
    /** CR 701.9a — discard: "Discard a card", a chosen card (CR 118.3). */
    | {
          readonly kind: "discard";
          readonly filter: EffectCardFilter;
          readonly count: number;
      }
    /** CR 701.9a — discard: "Discard a card at random". */
    | { readonly kind: "discard-at-random"; readonly count: number }
    /** CR 122.1 — "Remove a charge counter from this artifact". */
    | {
          readonly kind: "remove-counter";
          readonly counter: string;
          readonly count: number;
      }
    /** CR 701.13a — exile: "Exile two cards from your graveyard" (CR 118.5). */
    | {
          readonly kind: "exile-from-graveyard";
          readonly count: number;
          readonly cardType?: CardType;
          readonly owner?: "you";
      }
    /** CR 701.13a — exile: "Exile this artifact" as a cost (CR 118.1). */
    | { readonly kind: "exile-self" };

export interface ActivationCostIR {
    readonly atoms: readonly CostAtomIR[];
}

/**
 * Nouns Oracle text uses for "the object this ability is printed on".
 *
 * Modern templating writes "this creature" / "this artifact"; older wordings
 * (and the gold fixtures reconstructed from them) name the card, which
 * `normalize.ts` has already replaced with `{self}`. Both are the same referent
 * and both are accepted; a noun outside the table is refused rather than
 * assumed to be self, because "this creature" and "that creature" differ by one
 * word and by the whole meaning.
 */
const SELF_NOUNS: ReadonlySet<string> = new Set([
    "creature",
    "artifact",
    "enchantment",
    "land",
    "planeswalker",
    "permanent",
    "card",
    "token",
    "Aura",
    "Equipment",
    "Vehicle",
]);

/** True when the span names the source object (CR 109.2). */
export function isSelfPhrase(span: string): boolean {
    if (span === SELF_MARKER) return true;
    if (!span.startsWith("this ")) return false;
    return SELF_NOUNS.has(span.slice("this ".length));
}

const PAY_LIFE = /^Pay (\d+) life$/;
const DISCARD_RANDOM = /^Discard (\S+) cards? at random$/;
const REMOVE_COUNTER = /^Remove (\S+) (\S+) counters? from (.+)$/;
const EXILE_GRAVEYARD =
    /^Exile (\S+) (?:(\S+) )?cards? from (your graveyard|a single graveyard)$/;

/**
 * One cost atom, consumed whole.
 *
 * Written as a single rule with an explicit cascade rather than as `oneOf` over
 * ten alternatives: the alternatives here are told apart by their FIRST WORD
 * ("Sacrifice", "Discard", "Pay", "Remove", "Exile"), so a unique-alternation
 * would run nine rules to reject nine first words and report the near-misses in
 * every gap reason. The cascade is still all-consuming — each branch matches an
 * anchored pattern or an exact phrase, never a prefix.
 */
const costAtom: Rule<CostAtomIR> = rule<CostAtomIR>(
    "cost atom",
    (span, ctx) => {
        if (span === "{T}") return ok({ kind: "tap" as const });
        if (span.startsWith("{")) {
            const read = readManaCost(span);
            return read.ok
                ? ok({ kind: "mana" as const, mana: read.cost })
                : fail(read.reason, read.fragment);
        }

        if (span.startsWith("Sacrifice ")) {
            const object = span.slice("Sacrifice ".length);
            if (isSelfPhrase(object))
                return ok({ kind: "sacrifice-self" as const });
            const counted = splitCount(object);
            if (counted === null)
                return fail("sacrifice cost has no count word", span);
            const descriptor = descriptorRule.run(counted.rest, ctx);
            if (!descriptor.ok) return descriptor;
            const filter = permanentFilterFromDescriptor(descriptor.value);
            if (!filter.ok) return filter;
            return ok({
                kind: "sacrifice-other" as const,
                filter: filter.value,
                count: counted.count,
            });
        }

        if (span.startsWith("Exile ")) {
            if (isSelfPhrase(span.slice("Exile ".length)))
                return ok({ kind: "exile-self" as const });
            const match = span.match(EXILE_GRAVEYARD);
            if (match === null)
                return fail("not an exile cost this grammar knows", span);
            const count = readNumberWord(match[1]!);
            if (count === null)
                return fail(`"${match[1]}" is not a count`, span);
            const atom: {
                kind: "exile-from-graveyard";
                count: number;
                cardType?: CardType;
                owner?: "you";
            } = { kind: "exile-from-graveyard", count };
            if (match[2] !== undefined) {
                const type = CARD_TYPE_ADJECTIVES.get(match[2]);
                if (type === undefined)
                    return fail(`"${match[2]}" is not a card type`, span);
                atom.cardType = type;
            }
            if (match[3] === "your graveyard") atom.owner = "you";
            return ok(atom);
        }

        if (span.startsWith("Pay ")) {
            const match = span.match(PAY_LIFE);
            return match === null
                ? fail("not a life payment this grammar knows", span)
                : ok({ kind: "pay-life" as const, amount: Number(match[1]) });
        }

        if (span.startsWith("Discard ")) {
            const random = span.match(DISCARD_RANDOM);
            if (random !== null) {
                const count = readNumberWord(random[1]!);
                return count === null
                    ? fail(`"${random[1]}" is not a count`, span)
                    : ok({ kind: "discard-at-random" as const, count });
            }
            const rest = span.slice("Discard ".length);
            const counted = splitCount(rest);
            if (counted === null)
                return fail("discard cost has no count word", span);
            if (counted.rest === "card" || counted.rest === "cards")
                return ok({
                    kind: "discard" as const,
                    filter: {},
                    count: counted.count,
                });
            const typed = counted.rest.match(/^(\S+) cards?$/);
            if (typed === null)
                return fail("not a discard cost this grammar knows", span);
            const type = CARD_TYPE_ADJECTIVES.get(typed[1]!);
            return type === undefined
                ? fail(`"${typed[1]}" is not a card type`, span)
                : ok({
                      kind: "discard" as const,
                      filter: { type },
                      count: counted.count,
                  });
        }

        if (span.startsWith("Remove ")) {
            const match = span.match(REMOVE_COUNTER);
            if (match === null)
                return fail(
                    "not a counter-removal cost this grammar knows",
                    span
                );
            const count = readNumberWord(match[1]!);
            if (count === null)
                return fail(`"${match[1]}" is not a count`, span);
            if (!isSelfPhrase(match[3]!))
                return fail(
                    "counters can only be removed from the source in grammar v0",
                    span
                );
            return ok({
                kind: "remove-counter" as const,
                counter: match[2]!,
                count,
            });
        }

        return fail("not a cost atom this grammar knows", span);
    }
);

const CARD_TYPE_ADJECTIVES: ReadonlyMap<string, CardType> = new Map<
    string,
    CardType
>([
    ["artifact", "Artifact"],
    ["creature", "Creature"],
    ["enchantment", "Enchantment"],
    ["instant", "Instant"],
    ["land", "Land"],
    ["planeswalker", "Planeswalker"],
    ["sorcery", "Sorcery"],
]);

/** `"a creature"` → `{ count: 1, rest: "creature" }` (CR 107.1). */
function splitCount(span: string): { count: number; rest: string } | null {
    const at = span.indexOf(" ");
    if (at === -1) return null;
    const count = readNumberWord(span.slice(0, at));
    return count === null ? null : { count, rest: span.slice(at + 1) };
}

/**
 * CR 602.1a — the activation cost is everything before the colon; atoms are
 * comma-separated. Each KIND may appear at most once: two tap symbols or two
 * mana runs in one cost is a line we have misread, not a cost we should merge.
 */
export const activationCostRule: Rule<ActivationCostIR> = rule(
    ACTIVATION_COST,
    (span, ctx) => {
        const atoms = listOf("cost atoms", ", ", costAtom).run(span, ctx);
        if (!atoms.ok) return atoms;
        const seen = new Set<string>();
        for (const atom of atoms.value) {
            if (seen.has(atom.kind))
                return fail(`cost atom "${atom.kind}" appears twice`, span);
            seen.add(atom.kind);
        }
        return ok({ atoms: atoms.value });
    }
);

/**
 * Cost IR → `ActivatedAbility["cost"]`.
 *
 * The key insertion order matches the hand-written catalogue so a lockfile row
 * reads like the cards beside it; equality is key-order-insensitive either way
 * (`gold.ts` sorts keys before comparing).
 */
export function lowerActivationCost(
    ir: ActivationCostIR
): RuleResult<ActivatedAbility["cost"]> {
    const cost: Record<string, unknown> = {};
    for (const atom of ir.atoms) {
        switch (atom.kind) {
            case "tap":
                cost.tap = true;
                break;
            case "mana":
                cost.mana = atom.mana;
                break;
            case "sacrifice-self":
                cost.sacrifice = true;
                break;
            case "sacrifice-other":
                cost.sacrificeFilter = atom.filter;
                if (atom.count !== 1) cost.sacrificeFilterCount = atom.count;
                break;
            case "pay-life":
                cost.life = atom.amount;
                break;
            case "discard":
                cost.discardFilter = { filter: atom.filter, count: atom.count };
                break;
            case "discard-at-random":
                cost.discardAtRandom = atom.count;
                break;
            case "remove-counter":
                cost.removeCounter = {
                    type: atom.counter,
                    count: atom.count,
                };
                break;
            case "exile-from-graveyard": {
                const value: Record<string, unknown> = { count: atom.count };
                if (atom.cardType !== undefined) value.cardType = atom.cardType;
                if (atom.owner !== undefined) value.owner = atom.owner;
                cost.exileFromGraveyard = value;
                break;
            }
            case "exile-self":
                cost.exileThis = true;
                break;
            default: {
                const never: never = atom;
                return fail(
                    `no lowering for cost atom ${JSON.stringify(never)}`,
                    "cost"
                );
            }
        }
    }
    return ok(cost as ActivatedAbility["cost"]);
}
