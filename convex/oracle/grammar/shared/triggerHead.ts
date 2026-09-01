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

import type { Phase } from "../../../gre/types";
import { fail, ok, rule, type Rule } from "../../rule";
import { isSelfPhrase } from "./cost";

export const TRIGGER_HEAD = "trigger head";

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
    | "any-other";

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
    /** CR 508.1 — "whenever this creature attacks". */
    | { readonly kind: "attacks" }
    /** CR 510.1 — "whenever this creature deals combat damage to a player". */
    | { readonly kind: "combat-damage-to-player" }
    /** CR 603.6a — "at the beginning of [your/each] <step>". */
    | {
          readonly kind: "phase";
          readonly phase: Phase;
          readonly scope: "your" | "each";
      }
    /** CR 603.2 — "whenever [you / an opponent / a player] casts a spell". */
    | {
          readonly kind: "spell-cast";
          readonly scope: "you" | "opponent" | "any";
      };

/**
 * Heads whose subject is NOT the source. Exact phrases, lowercase.
 *
 * "the end step" is deliberately absent while "your end step" and "each end
 * step" are present: CR 500.1 gives every turn an end step, so the unqualified
 * phrase means EACH player's — and reading it as the controller's would make a
 * symmetric ability one-sided, which is the shape of bug that survives a whole
 * playtest. It is spelled out as `each` below rather than left to a default.
 */
const OTHER_HEADS: ReadonlyMap<string, TriggerHeadIR> = new Map<
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
]);

/** Self-subject heads: `<opener> <self phrase> <tail>` (CR 109.2). */
const SELF_HEADS: readonly {
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
    { opener: "whenever ", tail: " attacks", ir: { kind: "attacks" } },
    {
        opener: "whenever ",
        tail: " deals combat damage to a player",
        ir: { kind: "combat-damage-to-player" },
    },
];

/**
 * The head of a triggered ability, consumed whole.
 *
 * The self branch is tried first and returns immediately, but that is NOT a
 * priority ladder: the two tables are disjoint by construction — every
 * `OTHER_HEADS` key names a subject `isSelfPhrase` rejects ("a creature",
 * "another creature you control"), and every `SELF_HEADS` match requires a
 * subject it accepts. `grammar.test.ts` asserts the disjointness rather than
 * leaving it to the reading order.
 */
export const triggerHeadRule: Rule<TriggerHeadIR> = rule(
    TRIGGER_HEAD,
    (span) => {
        const probe = span.toLowerCase();
        for (const head of SELF_HEADS) {
            if (!probe.startsWith(head.opener)) continue;
            if (!probe.endsWith(head.tail)) continue;
            const subject = span.slice(
                head.opener.length,
                span.length - head.tail.length
            );
            if (!isSelfPhrase(subject)) continue;
            return ok(head.ir);
        }
        const other = OTHER_HEADS.get(probe);
        if (other !== undefined) return ok(other);
        return fail("not a trigger head this grammar knows", span);
    }
);
