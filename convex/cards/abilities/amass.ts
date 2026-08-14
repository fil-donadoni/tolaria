// `amassOps` — declarative template for Amass [subtype] N (CR 701.47), the
// keyword ACTION printed as the tail of another effect ("Then amass Orcs 1.").
//
// CR 701.47a: "To amass [subtype] N means 'If you don't control an Army
//   creature, create a 0/0 black [subtype] Army creature token. Choose an Army
//   creature you control. Put N +1/+1 counters on that creature. If it isn't a
//   [subtype], it becomes a [subtype] in addition to its other types.'"
// CR 701.47b: a player "amassed" once that process is complete, even if some
//   or all of those actions were impossible.
// CR 701.47c: "the Army you amassed" / "the amassed Army" is the creature you
//   chose, whether or not it received counters.
//
// NO new Effect Op (primitive reuse, ADR 0045 § primitive reuse /
// `.claude/rules/gre-development.md` § DSL-first authoring). Every one of CR
// 701.47a's four steps already has a shipped primitive, and the whole action
// is their ordered composition — the same call the `adapt` (CR 701.46) and
// `incubate` (CR 701.53) rows already made:
//   1. "If you don't control an Army creature" — the `if` construct's
//      comparison predicate over the `count` EffectValue, counting battlefield
//      permanents matching `{ type: "Creature", subtype: "Army" }` under
//      `controller`. `lt 1` rather than `eq 0`: a literal `0` is not a legal
//      EffectValue (CR 107.1's positive-int literal rule, `isPositiveInt` in
//      `validate.ts`), and "fewer than one" is exactly "zero" for a count.
//   2. "create a 0/0 black [subtype] Army creature token" — the `createToken`
//      Op with `makeArmyTokenSpec(subtype)`. The token is printed WITH its
//      subtypes (CR 701.47a creates an "[subtype] Army" token), so step 4 is
//      already satisfied for the fresh token.
//   3. "Choose an Army creature you control" — a real choice ONLY when there
//      is one to make. With 0 or 1 Army after step 2 the pick is forced, so
//      the script iterates the (single) Army with `forEach` and raises no
//      prompt; with 2+ Armies it raises the `choice` Op (kind
//      `choose-permanents`) and iterates its picks binding, the exact
//      `choice` → `forEach { set: "bound" }` shape Frantic Search ships
//      (`sets/ulg/blue.ts`, issue #1284). A mandatory prompt over a single
//      legal Army would be a zero-branch prompt, which this project treats as
//      a UX regression, and `choose-permanents` has no single-candidate
//      auto-resolve of its own (`requestChoice`, `gre/state.ts`, always
//      suspends).
//   4. "Put N +1/+1 counters on that creature" + "If it isn't a [subtype], it
//      becomes a [subtype] in addition to its other types" — the `counters`
//      Op (`action: "add"`) and the `addSubtype` Op, both on `{ ref: "$each" }`
//      inside that `forEach`. `addSubtype` is CR 613.1d layer 4 subtype
//      addition and is idempotent (`SpellContext.addSubtype`, `gre/state.ts`,
//      no-ops when the permanent already has the subtype), so applying it to a
//      freshly created "[subtype] Army" token is a no-op — matching CR
//      701.47a's own "if it isn't a [subtype]" guard.
//
// Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) row `id: "amass"`
// is the name authority; its `binding` field points back to this factory.

import type {
    EffectCountSpec,
    EffectOp,
    EffectTokenSpec,
    EffectValue,
} from "../types";

/** The battlefield filter for "an Army creature you control" (CR 701.47a).
 *  Army is a creature type (it appears in CR 205.3m's list), so the filter
 *  pairs the card type with the subtype rather than relying on either alone. */
const ARMY_YOU_CONTROL: EffectCountSpec = {
    zone: "battlefield",
    controller: "controller",
    filter: { type: "Creature", subtype: "Army" },
};

/** Builds the Army token's `EffectTokenSpec` for a given amass subtype (CR
 *  701.47a — "create a 0/0 black [subtype] Army creature token"). The amass
 *  action does not name the token, so per CR 111.4 its name is its subtype
 *  line — rendered here as "Orc Army" rather than CR 111.4's literal "Orc
 *  Army Token", the same trailing-"Token"-elided convention every other spec
 *  in this catalogue uses ("Treasure", "Incubator"). That is also the name of
 *  the printed Scryfall token every amass source links to, so `tokenPrintIdFor`
 *  (keyed by producing card id + token name) resolves its art with no
 *  hand-pinned `imagePrintId`. */
export function makeArmyTokenSpec(subtype: string): EffectTokenSpec {
    return {
        name: `${subtype} Army`,
        types: ["Creature"],
        subtypes: [subtype, "Army"],
        colors: ["B"],
        power: 0,
        toughness: 0,
    };
}

/** The shared "grow the chosen Army" body (CR 701.47a steps 3–4), applied to
 *  the `forEach` loop variable `$each` — the Army the controller chose (or the
 *  only one they control). */
function growAmassedArmy(subtype: string, n: EffectValue): EffectOp[] {
    return [
        // CR 701.47a — "Put N +1/+1 counters on that creature."
        {
            op: "counters",
            action: "add",
            counter: "+1/+1",
            target: { ref: "$each" },
            count: n,
        },
        // CR 701.47a — "If it isn't a [subtype], it becomes a [subtype] in
        // addition to its other types" (CR 613.1d layer 4). Cumulative across
        // amass sources: an Army fed by two different amass subtypes keeps
        // both.
        { op: "addSubtype", target: { ref: "$each" }, subtype },
    ];
}

/** Builds the Effect Script for "Amass [subtype] N" (CR 701.47a). Splice the
 *  result into a card's `effects` array wherever the Oracle line says "amass":
 *
 *      effects: [
 *          { op: "dealDamage", amount: 1, to: { target: 0 } },
 *          ...amassOps("Orc", 1),
 *      ]
 *
 *  `subtype` is the SINGULAR creature type the printed keyword names in the
 *  plural ("amass Orcs 1" → `"Orc"`, CR 205.3m subtypes are singular).
 *  `n` accepts any `EffectValue`, so a dynamic count ("amass X") composes. */
export function amassOps(subtype: string, n: EffectValue): EffectOp[] {
    const grow = growAmassedArmy(subtype, n);
    return [
        // CR 701.47a — "If you don't control an Army creature, create a 0/0
        // black [subtype] Army creature token."
        {
            op: "if",
            predicate: {
                left: { count: ARMY_YOU_CONTROL },
                op: "lt",
                right: 1,
            },
            then: [
                {
                    op: "createToken",
                    token: makeArmyTokenSpec(subtype),
                    controller: "controller",
                },
            ],
        },
        // CR 701.47a — "Choose an Army creature you control." Re-counted AFTER
        // the token step, so the fresh token is in scope.
        //
        // `then` is the COMMON branch on purpose: 0 or 1 Army, where the pick
        // is forced (or vacuous — CR 701.47b: a player amassed "even if some
        // or all of those actions were impossible") and no prompt is raised.
        // The bot's script walker values an `if` by its `then` arm
        // (`valueOp`, `gre/ai/opValuers.ts`), so keeping the executed path
        // there is what makes a growing Army a weighed consequence: the
        // context-aware `forEach { set: "permanents" }` count is the REAL
        // number of Armies on the board, where a `{ set: "bound" }` picks
        // count would only ever be the constant fallback.
        {
            op: "if",
            predicate: {
                left: { count: ARMY_YOU_CONTROL },
                op: "le",
                right: 1,
            },
            then: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", subtype: "Army" },
                    },
                    effects: grow,
                },
            ],
            // 2+ Armies — a genuine choice, so raise the prompt (CR 701.47a
            // "Choose an Army creature you control").
            else: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: { type: "Creature", subtype: "Army" },
                    count: 1,
                    prompt: `Choose an Army creature to amass ${subtype} onto.`,
                    bind: "$amassedArmy",
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$amassedArmy" },
                    effects: grow,
                },
            ],
        },
    ];
}
