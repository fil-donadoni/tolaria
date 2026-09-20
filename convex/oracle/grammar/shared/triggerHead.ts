/**
 * Shared sub-grammar: TRIGGER HEAD — the clause before the comma on a
 * triggered ability (CR 113.3c, CR 603.2).
 *
 * ── An exact table, not a pattern ──────────────────────────────────────────
 *
 * Every head below is an EXACT phrase looked up in a table (`atom`, the safest
 * leaf there is — the span must BE a key, so residue is impossible without a
 * regex being involved at all). That is a deliberate refusal of the obvious
 * design, which is to match `/^When(ever)? (.+) (enters|dies)$/` and read the
 * middle as a subject: the middle of a trigger head is where "another creature
 * you control", "a creature an opponent controls" and "equipped creature" all
 * live, three different scopes that a subject rule reading only the noun would
 * collapse into one. A collapsed scope is not a parse failure — it is a card
 * that triggers on the wrong events, which is the defect class ADR 0105 exists
 * to prevent.
 *
 * The table therefore grows one row per phrase the corpus actually prints, and
 * a phrase outside it is `unparsed` with the phrase as the fragment — which is
 * precisely the backlog signal that ranks the next row.
 *
 * ── Self phrases ───────────────────────────────────────────────────────────
 *
 * "When this creature enters" and "When {self} enters" are the same head:
 * modern templating writes the noun, older wordings name the card and
 * `normalize.ts` has already substituted `{self}` (CR 201.5). Both go through
 * `isSelfPhrase`, the same predicate the cost grammar uses, so the two
 * grammars cannot disagree about what "this" means.
 */

import type { SpellFilter } from "../../../cards/filters";
import type { Phase } from "../../../gre/types";
import { fail, ok, rule, type Rule, subGrammar } from "../../rule";
import { isSelfPhrase } from "./cost";
import { COLOR_WORDS } from "./targetFilter";

export const TRIGGER_HEAD = "trigger head";

/** CR 603.1 — the three words a trigger condition begins with. */
const TRIGGER_OPENER = /^(when|whenever|at) /i;

/**
 * Which permanents' events fire the ability, relative to the source
 * (CR 109.2). The names are the engine's `PermanentScope` vocabulary
 * deliberately: unlike a duration or a zone, a scope has exactly one meaning
 * on both sides and inventing a parallel spelling for it would buy nothing but
 * a mapping table to get wrong.
 */
export type TriggerSubjectScope =
    | "self"
    | "yours"
    | "opponents"
    | "any"
    | "another-yours"
    | "any-other"
    /** CR 303.4b — the Aura's host: "when ENCHANTED creature dies". */
    | "host";

export type TriggerHeadIR =
    /** CR 603.6a — "when [this / a creature] enters the battlefield". */
    | {
          readonly kind: "enters";
          readonly scope: TriggerSubjectScope;
          /** CR 603.6a — narrows the entering permanent by card type. */
          readonly creaturesOnly: boolean;
      }
    /** CR 603.6 — "when [this / a creature] dies". */
    | { readonly kind: "dies"; readonly scope: TriggerSubjectScope }
    /**
     * CR 508.3a — "whenever [this creature / a creature you control] attacks".
     * The rule counts PER CREATURE: the ability triggers once for each
     * creature declared as an attacker that `scope` admits, and each firing
     * names its own ("…, IT gets +2/+2"). Under `self` that is one firing
     * either way, which is why the head shipped without a scope at all.
     */
    | { readonly kind: "attacks"; readonly scope: TriggerSubjectScope }
    /**
     * CR 508.3a + CR 509.3a — "whenever a creature attacks or blocks": ONE
     * Oracle line (CR 603.2) over two per-creature trigger conditions. Both
     * halves count per creature, so the head does too, and "it" names whichever
     * creature the firing was for.
     */
    | {
          readonly kind: "attacks-or-blocks";
          readonly scope: TriggerSubjectScope;
      }
    /** CR 510.1 — "whenever this creature deals combat damage to a player". */
    | { readonly kind: "combat-damage-to-player" }
    /**
     * CR 120.3 — "whenever [this / enchanted] creature deals damage
     * [to an opponent / to a creature]": damage of ANY kind (the words do not
     * say "combat"), to the recipient the words name. `source: "host"` is
     * CR 303.4b's Aura host.
     */
    | {
          readonly kind: "damage-dealt";
          readonly source: "self" | "host";
          readonly recipient: "any" | "opponent" | "creature";
      }
    /** CR 120.3 / 303.4b — "whenever enchanted creature is dealt damage". */
    | { readonly kind: "damage-taken"; readonly scope: "host" }
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
          readonly scope: "your" | "each";
          /**
           * CR 603.2b — the head NAMES the player whose step it is ("each
           * PLAYER'S upkeep"), which is what gives a later "that player" its
           * antecedent. "At the beginning of each upkeep" fires on exactly
           * the same events but names no one, so it binds nothing: the flag
           * is a fact about the WORDS, and lowering reads it, never the
           * event.
           */
          readonly namesPlayer?: true;
      }
    /**
     * CR 603.2 — "whenever [you / an opponent / a player] casts a spell", with
     * the colour narrowing of CR 105.2 when the words carry one ("a black
     * spell" / "a nonred spell"). Absent = every spell.
     */
    | {
          readonly kind: "spell-cast";
          readonly scope: "you" | "opponent" | "any";
          readonly filter?: SpellFilter;
      };

/**
 * CR 603.2 + 105.2 — "whenever <caster> casts a <colour> spell" and its
 * negative "a non<colour> spell": one row per (caster, colour word, polarity),
 * generated from the ONE colour vocabulary the target grammar already reads
 * (`COLOR_WORDS`, CR 105.1), so the two grammars cannot disagree about what
 * "blue" is. The row set is still an exact table — the span must BE a key — so
 * a neighbour the rows do not spell ("a multicolored spell", "a black spell
 * from your hand", "a blue spell or an Island you control enters") stays
 * `unparsed`. "Nonred" excludes the colour (CR 105.2): a colourless spell
 * (CR 105.2c) is a nonred spell, which is why the negative is `excludeColors`
 * and never "any of the other four".
 */
function colourSpellCastHeads(): [string, TriggerHeadIR][] {
    const casters = [
        ["you cast", "you"],
        ["an opponent casts", "opponent"],
        ["a player casts", "any"],
    ] as const;
    const rows: [string, TriggerHeadIR][] = [];
    for (const [phrase, scope] of casters)
        for (const [word, color] of COLOR_WORDS) {
            rows.push([
                `whenever ${phrase} a ${word} spell`,
                { kind: "spell-cast", scope, filter: { colors: [color] } },
            ]);
            rows.push([
                `whenever ${phrase} a non${word} spell`,
                {
                    kind: "spell-cast",
                    scope,
                    filter: { excludeColors: [color] },
                },
            ]);
        }
    return rows;
}

/**
 * Heads whose subject is NOT the source. Exact phrases, lowercase.
 *
 * "the end step" is deliberately absent while "your end step" and "each end
 * step" are present: CR 500.1 gives every turn an end step, so the unqualified
 * phrase means EACH player's — and reading it as the controller's would make a
 * symmetric ability one-sided, which is the shape of bug that survives a whole
 * playtest. It is spelled out as `each` below rather than left to a default.
 */
export const OTHER_HEADS: ReadonlyMap<string, TriggerHeadIR> = new Map<
    string,
    TriggerHeadIR
>([
    // CR 603.6a — entering permanents, by controller relation.
    [
        "whenever another creature enters",
        { kind: "enters", scope: "any-other", creaturesOnly: true },
    ],
    [
        "whenever another creature you control enters",
        { kind: "enters", scope: "another-yours", creaturesOnly: true },
    ],
    [
        "whenever a creature enters",
        { kind: "enters", scope: "any", creaturesOnly: true },
    ],
    [
        "whenever a creature you control enters",
        { kind: "enters", scope: "yours", creaturesOnly: true },
    ],
    [
        "whenever a creature an opponent controls enters",
        { kind: "enters", scope: "opponents", creaturesOnly: true },
    ],
    // CR 603.6 — a creature dying. The event is `CREATURE_DIED`, so the type
    // narrowing is the EVENT's, not a filter's — a "creaturesOnly" flag here
    // would be a second, redundant authority on the same fact.
    // CR 508.3a — an attack declaration, read per attacking creature. Only the
    // two scopes the corpus prints: "a creature you control attacks" and the
    // symmetric "a creature attacks or blocks". Every neighbouring phrase
    // ("attacks a player", "attacks alone", "attacks or enters attacking",
    // "attacks this turn") narrows the condition further and stays refused
    // under its own gap key — a head that swallowed the narrowing would fire
    // on attacks the card does not mean.
    [
        "whenever a creature you control attacks",
        { kind: "attacks", scope: "yours" },
    ],
    // CR 509.3a — the blocking half is symmetric too ("a creature", not "a
    // creature you control"): Powerstone Minefield hits either player's.
    [
        "whenever a creature attacks or blocks",
        { kind: "attacks-or-blocks", scope: "any" },
    ],
    ["whenever a creature dies", { kind: "dies", scope: "any" }],
    ["whenever another creature dies", { kind: "dies", scope: "any-other" }],
    ["whenever a creature you control dies", { kind: "dies", scope: "yours" }],
    [
        "whenever another creature you control dies",
        { kind: "dies", scope: "another-yours" },
    ],
    [
        "whenever a creature an opponent controls dies",
        { kind: "dies", scope: "opponents" },
    ],
    // CR 303.4b / 603.10a — the Aura's host dying. A leaves-the-battlefield
    // trigger looks back in time, so the Aura (put into the graveyard by the
    // SBA only afterwards, CR 704.5m) still sees what it enchanted.
    ["when enchanted creature dies", { kind: "dies", scope: "host" }],
    // CR 120.3 / 303.4b — the Aura host dealing or being dealt damage. Only the
    // forms the corpus prints: "…deals damage to an opponent" on an Aura is a
    // different recipient scope and earns its own row when a card needs it.
    [
        "whenever enchanted creature deals damage",
        { kind: "damage-dealt", source: "host", recipient: "any" },
    ],
    [
        "whenever enchanted creature is dealt damage",
        { kind: "damage-taken", scope: "host" },
    ],
    // CR 603.6a — step boundaries (CR 500.1).
    [
        "at the beginning of your upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "your" },
    ],
    [
        "at the beginning of each upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "each" },
    ],
    [
        "at the beginning of each player's upkeep",
        { kind: "phase", phase: "UPKEEP", scope: "each", namesPlayer: true },
    ],
    [
        "at the beginning of your draw step",
        { kind: "phase", phase: "DRAW", scope: "your" },
    ],
    [
        "at the beginning of your end step",
        { kind: "phase", phase: "END_STEP", scope: "your" },
    ],
    [
        "at the beginning of each end step",
        { kind: "phase", phase: "END_STEP", scope: "each" },
    ],
    [
        "at the beginning of combat on your turn",
        { kind: "phase", phase: "BEGINNING_OF_COMBAT", scope: "your" },
    ],
    // CR 603.2 — casting.
    ["whenever you cast a spell", { kind: "spell-cast", scope: "you" }],
    [
        "whenever an opponent casts a spell",
        { kind: "spell-cast", scope: "opponent" },
    ],
    ["whenever a player casts a spell", { kind: "spell-cast", scope: "any" }],
    ...colourSpellCastHeads(),
]);

/** Self-subject heads: `<opener> <self phrase> <tail>` (CR 109.2). */
export const SELF_HEADS: readonly {
    readonly opener: string;
    readonly tail: string;
    readonly ir: TriggerHeadIR;
}[] = [
    {
        opener: "when ",
        tail: " enters",
        ir: { kind: "enters", scope: "self", creaturesOnly: false },
    },
    { opener: "when ", tail: " dies", ir: { kind: "dies", scope: "self" } },
    {
        opener: "whenever ",
        tail: " attacks",
        ir: { kind: "attacks", scope: "self" },
    },
    {
        opener: "whenever ",
        tail: " deals combat damage to a player",
        ir: { kind: "combat-damage-to-player" },
    },
    // CR 120.3 — damage of any kind, to the recipient the tail names.
    {
        opener: "whenever ",
        tail: " deals damage",
        ir: { kind: "damage-dealt", source: "self", recipient: "any" },
    },
    {
        opener: "whenever ",
        tail: " deals damage to an opponent",
        ir: { kind: "damage-dealt", source: "self", recipient: "opponent" },
    },
    {
        opener: "whenever ",
        tail: " deals damage to a creature",
        ir: { kind: "damage-dealt", source: "self", recipient: "creature" },
    },
];

/**
 * The SELF-subject branch, on its own, so the disjointness claim below is
 * testable rather than asserted in prose (review of PR #3024).
 *
 * Returns the head when the span is `<opener><self phrase><tail>`, else null.
 */
export function matchSelfHead(span: string): TriggerHeadIR | null {
    const probe = span.toLowerCase();
    for (const head of SELF_HEADS) {
        if (!probe.startsWith(head.opener)) continue;
        if (!probe.endsWith(head.tail)) continue;
        const subject = span.slice(
            head.opener.length,
            span.length - head.tail.length
        );
        if (!isSelfPhrase(subject)) continue;
        return head.ir;
    }
    return null;
}

/**
 * CR 608.2h — what a sentence-leading "it" names behind this head, or null
 * when the head names no object at all and the pronoun must stay unread.
 *
 * ONE authority for a fact two layers need: the GRAMMAR asks only whether the
 * pronoun has a referent (a head that names none refuses the line rather than
 * pointing it at a guess), and the LOWERING turns the answer into the selector
 * the Effect Script carries. Splitting them would let the two disagree — a
 * line the grammar accepts and the lowering then binds to the wrong object is
 * exactly the silent misread this compiler exists to prevent.
 *
 *  - `"source"` — the head's subject IS the object the ability is printed on
 *    ("Whenever {self} attacks, IT gets …", CR 109.2).
 *  - `"combatant"` — the head fires per attacking or blocking CREATURE and
 *    names that creature (CR 508.3a / 509.3a), which is not the source.
 */
export function headPronounReferent(
    head: TriggerHeadIR
): "source" | "combatant" | null {
    switch (head.kind) {
        case "enters":
        case "dies":
            return head.scope === "self" ? "source" : null;
        case "attacks":
            return head.scope === "self" ? "source" : "combatant";
        case "attacks-or-blocks":
            return "combatant";
        case "combat-damage-to-player":
            return "source";
        // CR 303.4b — "enchanted creature" names the Aura's host, not the Aura.
        case "damage-dealt":
            return head.source === "self" ? "source" : null;
        case "damage-taken":
        case "phase":
        case "spell-cast":
            return null;
    }
}

/**
 * The head of a triggered ability, consumed whole.
 *
 * The self branch is tried first and returns immediately, but that is NOT a
 * priority ladder: the two tables are disjoint by construction — every
 * `OTHER_HEADS` key names a subject `isSelfPhrase` rejects ("a creature",
 * "another creature you control"), and every `SELF_HEADS` match requires a
 * subject it accepts. `__tests__/triggered.test.ts` sweeps BOTH tables against
 * the other branch and asserts no phrase is read by both, so an overlap
 * introduced later reds the suite instead of silently making the reading order
 * load-bearing.
 */
export const triggerHeadRule: Rule<TriggerHeadIR> = subGrammar(
    TRIGGER_HEAD,
    rule(TRIGGER_HEAD, (span) => {
        const self = matchSelfHead(span);
        if (self !== null) return ok(self);
        const other = OTHER_HEADS.get(span.toLowerCase());
        if (other !== undefined) return ok(other);
        return fail("not a trigger head this grammar knows", span);
    }),
    // CR 603.1 — a triggered ability opens with "when", "whenever" or "at".
    (span) => TRIGGER_OPENER.test(span)
);
