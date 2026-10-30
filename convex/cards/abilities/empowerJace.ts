// `empowerJaceOps` — declarative template for Empower Jace N (CR 701.71), the
// keyword ACTION printed on its own or as the tail of another effect
// ("Counter target spell. Empower Jace 1.", "When this creature enters,
// empower Jace 2.").
//
// CR 701.71a: "To empower Jace N means 'If you don't control a Jace
//   planeswalker token, create a blue Jace planeswalker token with 0 loyalty,
//   "[−1]: Surveil 1," and "[−3]: Draw a card." Choose a Jace planeswalker
//   token you control. Put N loyalty counters on it.'"
//
// NO new Effect Op (primitive reuse, ADR 0045 § primitive reuse). CR 701.71a
// is CR 701.47a (Amass) with a different token and a different counter, so it
// is the same ordered composition `amassOps` ships (`abilities/amass.ts`):
//   1. "If you don't control a Jace planeswalker token" — the `if` construct's
//      comparison predicate over the `count` EffectValue, counting battlefield
//      permanents matching `{ type: "Planeswalker", subtype: "Jace", isToken:
//      true }` under `controller`. A nontoken Jace planeswalker does NOT
//      satisfy it: the rule names a TOKEN.
//   2. "create a blue Jace planeswalker token with 0 loyalty, …" — the
//      `createToken` Op with {@link JACE_PLANESWALKER_TOKEN}. "With 0 loyalty"
//      is its printed loyalty, so CR 306.5b's "enters with a number of
//      loyalty counters … equal to its printed loyalty number" places none:
//      the spec carries no `entersWith`.
//      Step 4 follows inside the same resolution, so the CR 704.5i SBA never
//      sees a 0-loyalty token unless N is 0 (CR 704.3: SBAs are checked only
//      when a player would receive priority).
//   3. "Choose a Jace planeswalker token you control" — a real choice ONLY
//      with 2+ such tokens. With 0 or 1 the pick is forced (or vacuous), so the
//      script iterates the token(s) with `forEach` and raises no prompt; with
//      2+ it raises the `choice` Op (kind `choose-permanents`) and iterates its
//      picks binding — the exact split `amassOps` documents, and for the same
//      two reasons: `choose-permanents` has no single-candidate auto-resolve,
//      and the bot's script walker values an `if` by its `then` arm.
//   4. "Put N loyalty counters on it" — the `counters` Op (`action: "add"`,
//      `"loyalty"`, the engine's loyalty key `LOYALTY_COUNTER_KEY`,
//      `gre/loyalty.ts`) on `{ ref: "$each" }`.
//
// Mechanics Registry (`convex/cards/mechanicsRegistry.ts`) row
// `id: "empower-jace"` is the name authority; its `binding` field points back
// to this factory.

import type {
    EffectCountSpec,
    EffectOp,
    EffectTokenSpec,
    EffectValue,
} from "../types";

/** CR 701.71a's "Jace planeswalker token". Jace is a planeswalker type (CR
 *  205.3j), so the filter pairs it with the card type, and `isToken` narrows to
 *  tokens — a Jace planeswalker CARD is not one. */
const JACE_TOKEN_FILTER = {
    type: "Planeswalker",
    subtype: "Jace",
    isToken: true,
} as const;

/** The battlefield count of Jace planeswalker tokens the controller controls
 *  (CR 701.71a). */
const JACE_TOKEN_YOU_CONTROL: EffectCountSpec = {
    zone: "battlefield",
    controller: "controller",
    filter: JACE_TOKEN_FILTER,
};

/** The token CR 701.71a creates: "a blue Jace planeswalker token with 0
 *  loyalty, '[−1]: Surveil 1,' and '[−3]: Draw a card.'"
 *
 *  Named "Jace" (CR 111.4: a token's name is its subtype, with the trailing
 *  "Token" elided as every spec in this catalogue does) — also the name of
 *  Scryfall's printed token every empower source links to. Its art is pinned:
 *  every Jace token in the game is the same object, whichever card made it.
 *
 *  Both abilities are loyalty abilities (CR 606.2 — the signed `cost.loyalty`
 *  is the whole marker), activated through the same CR 606.3 authority as a
 *  printed planeswalker's (`gre/loyalty.ts`). Surveil N is `scryReorder` with
 *  `destination: "graveyard"` (CR 701.25, the `surveil` registry row). */
export const JACE_PLANESWALKER_TOKEN: EffectTokenSpec = {
    name: "Jace",
    types: ["Planeswalker"],
    subtypes: ["Jace"],
    colors: ["U"],
    activatedAbilities: [
        {
            id: "jace-token-surveil",
            oracleText: "−1: Surveil 1.",
            cost: { loyalty: -1 },
            useStack: true,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 1,
                    destination: "graveyard",
                },
            ],
        },
        {
            id: "jace-token-draw",
            oracleText: "−3: Draw a card.",
            cost: { loyalty: -3 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
    // Printed Jace token art (tfra).
    imagePrintId: "8d1e424f-6407-4f8c-bed2-eaf148237c81",
};

/** The shared "put N loyalty counters on the chosen Jace" body (CR 701.71a
 *  last sentence), applied to the `forEach` loop variable `$each`. */
function empowerChosenJace(n: EffectValue): EffectOp[] {
    return [
        {
            op: "counters",
            action: "add",
            counter: "loyalty",
            target: { ref: "$each" },
            count: n,
        },
    ];
}

/** Builds the Effect Script for "Empower Jace N" (CR 701.71a). Splice the
 *  result into a card's `effects` array wherever the Oracle line says
 *  "empower Jace":
 *
 *      effects: [
 *          { op: "counter", target: { target: 0 } },
 *          ...empowerJaceOps(1),
 *      ]
 *
 *  `n` accepts any `EffectValue`, so a dynamic count ("empower Jace X")
 *  composes. */
export function empowerJaceOps(n: EffectValue): EffectOp[] {
    const empower = empowerChosenJace(n);
    return [
        // CR 701.71a — "If you don't control a Jace planeswalker token, create
        // a blue Jace planeswalker token with 0 loyalty, …"
        {
            op: "if",
            predicate: {
                left: { count: JACE_TOKEN_YOU_CONTROL },
                op: "lt",
                right: 1,
            },
            then: [
                {
                    op: "createToken",
                    token: JACE_PLANESWALKER_TOKEN,
                    controller: "controller",
                },
            ],
        },
        // CR 701.71a — "Choose a Jace planeswalker token you control." Counted
        // AFTER the token step, so the fresh token is in scope. `then` is the
        // forced (0 or 1 token) path, `else` the genuine choice.
        {
            op: "if",
            predicate: {
                left: { count: JACE_TOKEN_YOU_CONTROL },
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
                        filter: JACE_TOKEN_FILTER,
                    },
                    effects: empower,
                },
            ],
            else: [
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: JACE_TOKEN_FILTER,
                    count: 1,
                    prompt: "Choose a Jace planeswalker token to empower.",
                    bind: "$empoweredJace",
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: "$empoweredJace" },
                    effects: empower,
                },
            ],
        },
    ];
}
