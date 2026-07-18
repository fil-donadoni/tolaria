// `adaptAbility` — declarative template for Adapt N (CR 701.46), the keyword
// ACTION printed as "{cost}: Adapt N." on an activated ability.
//
// CR 701.46a: "Adapt N" means "If this creature has no +1/+1 counters on it,
//   put N +1/+1 counters on it."
//
// Adapt is a keyword ACTION (CR 701.46), not a CR 702 keyword ABILITY — it's
// never a bare `staticAbilities[]` grant string (unlike Ward/Flying); it's
// always the payload of a printed activated ability, e.g. Merfolk
// Branchwalker's "{4}{G}: Adapt 2." No new Op is needed (primitive reuse,
// ADR 0045 § primitive reuse / .claude/rules/gre-development.md § DSL-first
// authoring): the whole action decomposes into two ALREADY-exercised
// structural/Op primitives —
//   - the `if` structural construct's comparison predicate, reading
//     `{ counters: { of: $source, type: "+1/+1" } } eq 0` (the `counters`
//     EffectValue member, issue #1015) — "if this creature has no +1/+1
//     counters on it", and
//   - the `counters` Op (`action: "add"`, issue #841) inside `then`, putting
//     N counters of type "+1/+1" on `$source` when the predicate holds
//     (CR 122.1).
// Both are already interpreter/wire-format exercised — the per-Op test
// regime applies (`.claude/rules/gre-development.md`): a card whose
// `activatedAbilities` uses only `adaptAbility` needs no hand-written
// interpreter/wire test of its own, only the catalogue-wide static sweep +
// canned-scenario smoke test that already run for every card.
//
// Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) row `id: "adapt"`
// is the name authority; its `binding` field points back to this factory.

import type { ActivatedAbility, ManaCost } from "../types";

/** Spelled-out counts for the printed Adapt reminder text (Scryfall renders
 *  "a +1/+1 counter" for N=1 and spells out the numeral for N>1, matching
 *  every other CR 701 "put N counters" reminder). Adapt has shipped with
 *  N=1 through N=8 across Ixalan block and its reprints; higher values fall
 *  back to the bare numeral. */
const COUNT_WORDS: Record<number, string> = {
    1: "a",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
};

/** Renders the standard Adapt reminder text for the given N. */
function adaptReminder(n: number): string {
    const word = COUNT_WORDS[n] ?? String(n);
    const noun = n === 1 ? "+1/+1 counter" : "+1/+1 counters";
    return `If this creature has no +1/+1 counters on it, put ${word} ${noun} on it.`;
}

export interface AdaptArgs {
    /** Stable id within the source card's `activatedAbilities` array. */
    id?: string;
    /** Full oracle text override. Defaults to the standard printed line
     *  ("{costLabel}: Adapt N. (<reminder>)"). */
    oracleText?: string;
    /** N — the number of +1/+1 counters put on the creature (CR 701.46a). */
    n: number;
    /** The Adapt activation cost (every printed Adapt cost is mana-only). */
    cost: ManaCost;
    /** Label for the cost shown in the printed ability line (e.g. "{4}{G}"). */
    costLabel: string;
}

/** Builds the Adapt N activated ability (CR 701.46). Add it to a card's
 *  `activatedAbilities`. Sorcery-speed vs instant-speed is not restricted by
 *  the keyword itself (CR 701.46 carries no timing restriction) — like any
 *  other activated ability it's usable any time its controller has
 *  priority. */
export function adaptAbility(args: AdaptArgs): ActivatedAbility {
    const oracle =
        args.oracleText ??
        `${args.costLabel}: Adapt ${args.n}. (${adaptReminder(args.n)})`;
    return {
        id: args.id ?? "adapt",
        oracleText: oracle,
        cost: { mana: args.cost },
        useStack: true,
        effects: [
            {
                op: "if",
                // CR 701.46a — "if this creature has no +1/+1 counters on
                // it": a comparison predicate reading the resolving source's
                // own "+1/+1" counter count (issue #1015's `counters` value
                // grammar). `lt 1` rather than `eq 0` — a literal `0` is not
                // a legal EffectValue (CR 107.1's positive-int literal rule,
                // `isPositiveInt`/`isEffectValue` in `validate.ts`), and
                // "fewer than one" is exactly "zero" for a non-negative
                // counter count.
                predicate: {
                    left: {
                        counters: { of: { ref: "$source" }, type: "+1/+1" },
                    },
                    op: "lt",
                    right: 1,
                },
                then: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { ref: "$source" },
                        count: args.n,
                    },
                ],
            },
        ],
    };
}
