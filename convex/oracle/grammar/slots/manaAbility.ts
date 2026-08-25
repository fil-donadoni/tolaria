/**
 * Slot: mana ability (CR 605.1a).
 *
 * Grammar v0 accepts an activated ability written, per CR 113.3b, as
 * "[Cost]: [Effect.]" whose effect is nothing but adding mana:
 *
 *     {T}: Add {G}.
 *     {T}: Add {C}{C}.
 *     {2}, {T}: Add {B} or {R}.
 *     {T}: Add {W}, {U}, or {B}.
 *
 * ── Why the CR 605.1a criteria hold by construction ────────────────────────
 *
 * CR 605.1a makes an activated ability a mana ability iff it (a) does not
 * require a target, (b) could add mana on resolution, (c) is not a loyalty
 * ability, and (d) neither its cost nor its effect moves a card to or from a
 * library. This grammar's cost atoms are the tap symbol and mana, and its only
 * effect is "Add"; none of the four criteria can be violated by anything it can
 * produce. The classification is therefore a property of the accepted language,
 * not a check applied to the output — which is why `useStack: false`
 * (CR 605.3a: a mana ability does not use the stack) is safe to emit.
 *
 * ── What v0 deliberately refuses ───────────────────────────────────────────
 *
 * "Add one mana of any color", "Add three mana of any one color" and
 * "Add {G} for each Forest you control" all need the shared QUANTITY
 * sub-grammar, which is a stub until #2697. They are `unparsed`, not
 * approximated: a quantity read as a constant is the competitor's documented
 * "for each collapsed to a constant" misparse.
 */

import { PERMANENT_TYPES } from "../../../cards/types";
import type { ManaCost } from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import {
    fail,
    listOf,
    map,
    ok,
    oneOf,
    pair,
    rule,
    terminated,
    type Rule,
} from "../../rule";
import type { ParseContext } from "../../types";
import type { ManaAbilityCostIR, ManaProductionIR, SlotIR } from "../ir";

export const MANA_ABILITY_SLOT = "mana-ability";

/** A run of mana symbols, e.g. `"{G}"`, `"{C}{C}"`, `"{2}"` (CR 107.4). */
const manaSymbols: Rule<ManaCost> = rule("mana symbols", (span) => {
    const read = readManaCost(span);
    return read.ok ? ok(read.cost) : fail(read.reason, read.fragment);
});

/** CR 107.5 — the tap symbol in an activation cost means "tap this permanent". */
const tapAtom: Rule<{ kind: "tap" }> = rule("tap symbol", (span) =>
    span === "{T}"
        ? ok({ kind: "tap" as const })
        : fail("not the tap symbol", span)
);

const manaAtom: Rule<{ kind: "mana"; mana: ManaCost }> = map(
    manaSymbols,
    (mana) => ({
        kind: "mana" as const,
        mana,
    })
);

type CostAtom = { kind: "tap" } | { kind: "mana"; mana: ManaCost };

const costAtom: Rule<CostAtom> = oneOf<CostAtom>("activation cost atom", [
    tapAtom,
    manaAtom,
]);

/**
 * CR 602.1a — the activation cost is everything before the colon. Cost atoms
 * are comma-separated; each KIND may appear at most once, because two tap
 * symbols or two mana runs in one cost is a line we have misread.
 */
const activationCost: Rule<ManaAbilityCostIR> = map(
    listOf("activation cost", ", ", costAtom),
    (atoms) => {
        let tap = false;
        let mana: ManaCost | undefined;
        for (const a of atoms) {
            if (a.kind === "tap") {
                if (tap)
                    return fail("tap symbol appears twice in the cost", "{T}");
                tap = true;
            } else {
                if (mana !== undefined)
                    return fail("two mana runs in one cost", "cost");
                mana = a.mana;
            }
        }
        return mana === undefined ? { tap } : { tap, mana };
    }
);

const fixedProduction: Rule<ManaProductionIR> = map(manaSymbols, (mana) => ({
    kind: "fixed" as const,
    mana,
}));

/**
 * `"{B} or {R}"` / `"{W}, {U}, or {B}"`.
 *
 * The two shapes are told apart by a SYNTACTIC marker (`", or "`) rather than
 * by trying both and taking whichever matches first: `", or "` contains `" or "`
 * as a substring, so an `oneOf` over the two would report every three-way list
 * as ambiguous. Dispatching on the marker keeps the choice deterministic and
 * still leaves each branch all-consuming.
 */
const choiceProduction: Rule<ManaProductionIR> = rule(
    "mana choice",
    (span, ctx) => {
        const inner: Rule<ManaCost[]> = span.includes(", or ")
            ? pair(
                  "oxford mana list",
                  ", or ",
                  listOf("mana list head", ", ", manaSymbols, { min: 2 }),
                  manaSymbols,
                  (head, last) => [...head, last]
              )
            : pair("mana pair", " or ", manaSymbols, manaSymbols, (a, b) => [
                  a,
                  b,
              ]);
        const parsed = inner.run(span, ctx);
        if (!parsed.ok) return parsed;
        return ok({ kind: "choice" as const, options: parsed.value });
    }
);

const production: Rule<ManaProductionIR> = oneOf("mana production", [
    fixedProduction,
    choiceProduction,
]);

/** CR 106.1 / 605.1a — the effect half: "Add <mana>". */
const addEffect: Rule<ManaProductionIR> = rule("add effect", (span, ctx) => {
    if (!span.startsWith("Add "))
        return fail('effect does not begin with "Add "', span);
    return production.run(span.slice("Add ".length), ctx);
});

const manaAbilityBody: Rule<SlotIR> = pair(
    MANA_ABILITY_SLOT,
    ": ",
    activationCost,
    addEffect,
    (cost, produces) => ({ kind: "mana-ability" as const, cost, produces })
);

const PERMANENT_TYPE_SET = new Set<string>(PERMANENT_TYPES);

/**
 * CR 113.3b — the sentence ends in a full stop, which belongs to the ability.
 *
 * The slot additionally refuses any card that is not a permanent: an activated
 * ability whose cost taps something has no meaning on an instant or sorcery.
 *
 * (Lands with a basic land type are refused a level up, in `compile.ts` — the
 * reason is about the card, not about this line, and their text is usually pure
 * reminder text that never reaches a slot at all.)
 */
export const manaAbilitySlot: Rule<SlotIR> = rule(
    MANA_ABILITY_SLOT,
    (span, ctx) => {
        const context = ctx as ParseContext;
        if (!context.typeLine.types.some((t) => PERMANENT_TYPE_SET.has(t))) {
            return fail("a mana ability needs a permanent (CR 605.1a)", span);
        }
        return terminated(".", manaAbilityBody).run(span, ctx);
    }
);
