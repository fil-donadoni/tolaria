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
 *     {T}: Add one mana of any color.
 *
 * ── Why the CR 605.1a criteria hold by construction ────────────────────────
 *
 * CR 605.1a makes an activated ability a mana ability iff it (a) does not
 * require a target, (b) could add mana on resolution, (c) is not a loyalty
 * ability, and (d) neither its cost nor its effect moves a card to or from a
 * library. Its only effect is "Add", so (b) holds and (a) cannot be violated —
 * "Add" takes no target. The COST is the shared activation-cost sub-grammar
 * (`grammar/shared/cost.ts`), which is what lets this slot read "Sacrifice a
 * Goblin: Add {R}" and "{T}, Pay 1 life: Add {B} or {R}"; every atom that
 * sub-grammar accepts pays with the tap symbol, mana, a permanent, life, a
 * card in hand, a counter or a card in a graveyard, and NONE of them touches a
 * library, so (d) holds, and none of them is a loyalty cost, so (c) does. The
 * classification is therefore still a property of the accepted language, not a
 * check applied to the output — which is why `useStack: false` (CR 605.3a: a
 * mana ability does not use the stack) is safe to emit. A cost atom that could
 * move a card to or from a library would have to re-open this argument, and
 * the criterion is written out here so that it must be.
 *
 * ── What v0 deliberately refuses ───────────────────────────────────────────
 *
 * "Add three mana of any one color" and "Add {G} for each Forest you control"
 * need a mana DESCRIPTOR the engine models with `manaColorSource` /
 * `getManaChoices` rather than with a fixed `ManaCost`, so the shared quantity
 * sub-grammar landing in #2697 is necessary but not sufficient for them. They
 * stay `unparsed`, not approximated: a quantity read as a constant is the
 * competitor's documented "for each collapsed to a constant" misparse.
 *
 * "Add one mana of any color" is the ONE member of that family the engine
 * needs no descriptor for (issue #4134): the offered set is the five colours
 * of mana, constant and board-independent (CR 106.1a), which is exactly the
 * `manaChoices` list the hand-written catalogue already ships for it (Birds of
 * Paradise, Phyrexian Altar, Celestial Prism). `anyColorProduction` below
 * reads it; every NEIGHBOUR that restricts or counts the set —
 * "…of any color that a land you control could produce" (board-derived,
 * `manaColorSource`), "…in your commander's color identity", "two mana of any
 * one color" — stays refused, because each needs a descriptor this rule does
 * not emit.
 *
 * The painland rider (`PAINLAND_RIDER` below, issue #3828) is scoped to the
 * literal "This land …" — the Talisman cycle prints the byte-identical shape
 * on "This artifact …" (`cards/abilities/index.ts`'s `makeTalisman`, whose own
 * comment calls out the shared shape) and stays unparsed here. Widening the
 * pattern to every self-referring noun (`grammar/shared/cost.ts`'s
 * `isSelfPhrase`) is the natural next slice — left for the corpus report to
 * rank rather than folded into this one, which is scoped to the land cycle
 * issue #3828 names.
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
    subGrammar,
    terminated,
    type Rule,
} from "../../rule";
import type { ParseContext } from "../../types";
import { activationCostRule } from "../shared/cost";
import { readNumberWord } from "../shared/quantity";
import type { ManaProductionIR, SlotIR } from "../ir";

export const MANA_ABILITY_SLOT = "mana-ability";

/** A run of mana symbols, e.g. `"{G}"`, `"{C}{C}"`, `"{2}"` (CR 107.4). */
const manaSymbols: Rule<ManaCost> = rule("mana symbols", (span) => {
    const read = readManaCost(span);
    return read.ok ? ok(read.cost) : fail(read.reason, read.fragment);
});

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

/** The sub-grammar the attribution diagnostic names for this slot. */
export const MANA_PRODUCTION = "mana production";

/**
 * CR 106.1a — "one mana of any color": the five COLOURS of mana (not the six
 * types — colorless is not a colour), one of which the activating player picks
 * at activation. `ManaCost` objects are minted fresh per parse because the
 * lowering hands the array straight to `ActivatedAbility.manaChoices` and the
 * painland merge spreads it into a longer list; a module-level literal would
 * be one object shared by every compiled card.
 */
function anyColorOptions(): ManaCost[] {
    return [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }];
}

/**
 * CR 605.1a / 106.1a — "Add one mana of any color."
 *
 * Lowered as a CHOICE production, i.e. the same IR "Add {B} or {R}" produces,
 * because to the engine the two ARE the same thing: a list of `ManaCost`
 * options the activator picks from (`manaChoices`), which is how every
 * hand-written twin of this line already ships it. Sharing the IR node also
 * means the painland rider composes for free — "Add one mana of any color.
 * This land deals N damage to you." (Grand Coliseum, Tarnished Citadel) is
 * read by `addEffect`'s existing rider branch, which fires only on a choice.
 *
 * Fail-closed on the exact span: anything AFTER "color" restricts the offered
 * set (a board-derived filter, a commander's colour identity) or counts it,
 * and would need a descriptor this rule does not emit — refused, with the
 * neighbours pinned by `manaAnyColor.test.ts`.
 */
const ANY_COLOR_SPAN = "one mana of any color";

const anyColorProduction: Rule<ManaProductionIR> = rule(
    "mana any color",
    (span) =>
        span === ANY_COLOR_SPAN
            ? ok({ kind: "choice" as const, options: anyColorOptions() })
            : fail(`production is not "${ANY_COLOR_SPAN}"`, span)
);

const production: Rule<ManaProductionIR> = subGrammar(
    MANA_PRODUCTION,
    oneOf(MANA_PRODUCTION, [
        fixedProduction,
        choiceProduction,
        anyColorProduction,
    ])
);

/**
 * The attribution sub-grammar of a sentence AFTER a production that parsed —
 * "{T}: Add {R}. This land deals 1 damage to you." (issue #3822). The slot has
 * no rider sentences at all, so the production refuses the whole remainder;
 * the missing rule is the rider, and the diagnostic says so.
 */
export const MANA_ABILITY_RIDER = "mana ability rider";

/**
 * CR 605.1a — "This land deals N damage to you", the painland cycle's rider on
 * a CHOICE production (Adarkar Wastes, the enemy painlands — issue #3828):
 * `cards/types.ts`'s `dealsDamageToControllerOnColoredTap`, fired only on the
 * coloured pick. The identical sentence after a FIXED production is the
 * unconditional `dealsDamageToControllerOnTap` (Ancient Tomb) — a different
 * field this rule does not read; a FIXED production is refused the rider by
 * `addEffect` below rather than by this pattern.
 */
const PAINLAND_RIDER = /^This land deals (\S+) damage to you$/;

function readPainlandDamage(span: string): number | null {
    const m = PAINLAND_RIDER.exec(span);
    if (m === null) return null;
    const damage = readNumberWord(m[1]!);
    // "Deals 0 damage" is not a printed sentence, and the field it would
    // write is a no-op the engine silently accepts — stay fail-closed rather
    // than emit a rider with no effect.
    return damage !== null && damage > 0 ? damage : null;
}

/** CR 106.1 / 605.1a — the effect half: "Add <mana>". */
const addEffect: Rule<ManaProductionIR> = rule("add effect", (span, ctx) => {
    if (!span.startsWith("Add "))
        return fail('effect does not begin with "Add "', span);
    const body = span.slice("Add ".length);
    const r = production.run(body, ctx);
    if (r.ok) return r;
    // Verdict and reason are the production's; only the blame moves, and only
    // when the first sentence alone is a production this grammar reads.
    const stop = body.indexOf(". ");
    if (stop === -1) return r;
    const head = production.run(body.slice(0, stop), ctx);
    if (!head.ok) return r;
    const riderSpan = body.slice(stop + ". ".length);
    if (head.value.kind === "choice") {
        const damage = readPainlandDamage(riderSpan);
        if (damage !== null)
            return ok({
                ...head.value,
                dealsDamageToControllerOnColoredTap: damage,
            });
    }
    return fail(r.reason, r.fragment, {
        path: [MANA_ABILITY_RIDER],
        span: riderSpan,
        progress: 1,
    });
});

const manaAbilityBody: Rule<SlotIR> = pair(
    MANA_ABILITY_SLOT,
    ": ",
    activationCostRule,
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
