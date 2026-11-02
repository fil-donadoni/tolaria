// Mobilize N (CR 702.181) — a TRIGGERED-ability keyword expanded implicitly
// from the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the same ADR 0054 mechanism annihilator and
// firebending use. A card declares only `staticAbilities: ["mobilize 2"]`;
// `expandMobilize` injects the synthesized attack trigger, so the keyword's
// rules text lives in exactly one place — the string. A card can never print
// the keyword and enforce nothing (the shape Guard A exists to catch), nor
// carry the enforcing trigger without the board-visible keyword. Issue #2611.
//
// CR 702.181a "Mobilize is a triggered ability. 'Mobilize N' means 'Whenever
//             this creature attacks, create N 1/1 red Warrior creature
//             tokens. Those tokens enter tapped and attacking. Sacrifice them
//             at the beginning of the next end step.'"
//
// Fully declarative (DSL-first, ADR 0045) — three shipped pieces composed:
//
//  - "Whenever this creature attacks" is `attacksTrigger({ scope: "self" })`,
//    an `ATTACKERS_DECLARED` (CR 508.1m) ability. It fires on the DECLARATION,
//    so the tokens — which enter attacking without ever being declared
//    (CR 508.4) — never fire it or any other attackers-declared trigger
//    themselves (`joinCombatAttacking`, gre/combat.ts, deliberately skips
//    `recordAttackerDeclared`), and CR 508.4c keeps them out of every attack
//    requirement, restriction and cost.
//  - "create N … tokens. Those tokens enter tapped and attacking" is ONE
//    `createToken` Op with `count: N` and the `entersTapped`/`entersAttacking`
//    flags (CR 508.4, issue #1195). Which defender each token attacks is its
//    controller's CR 508.4 choice — the token entry site owes the as-enters
//    `attack-target` answer (the defending player or a planeswalker/battle
//    they control) exactly as for Adeline's Humans; absent any such
//    permanent, it attacks the defending player.
//  - "Sacrifice them at the beginning of the next end step" is a
//    `delayedTrigger` (CR 603.7a) with `timing: "next-end-step"`. The tokens
//    are named by `createToken`'s `bindAll` PICKS binding and frozen into the
//    delayed trigger by a `{ select: { set: "bound" } }` list capture — the
//    Suppress (`sets/apc/black.cards.ts`) shape — so ONE delayed trigger
//    sacrifices all N ("them"), not N triggers. "The next end step" is
//    whichever end step begins next: this turn's when the creature attacked
//    in a normal combat, a later turn's if that end step never began (an end
//    step skipped by an effect, CR 603.7a's "the next" — the instance waits
//    for the next END_STEP). A token that already left the battlefield is
//    skipped by the picks-form `sacrifice` (CR 608.2b / 701.21a).
//
// MULTIPLE INSTANCES: CR 702.181a says mobilize IS a triggered ability, so two
// instances are two abilities and the per-entry trigger scan fires both. The
// expansion counts EVERY matching string (annihilator's shape) and keys the
// injected id on N — see `mobilizeTriggerId`.

import { WARRIOR_TOKEN } from "../sharedTokens";
import type { CardDefinition, TriggeredAbility } from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";

/** Matches the parametrized keyword string, e.g. `"mobilize 2"` (CR 702.181a
 *  — N is always spelled as a numeral in the Oracle keyword line). */
const MOBILIZE_PATTERN = /^mobilize (\d+)$/i;

/** Matches an already-injected mobilize ability id — the idempotence guard. */
const MOBILIZE_TRIGGER_ID_PATTERN = /^mobilize-\d+$/;

/** Spelled-out counts for the printed reminder text ("create two tapped and
 *  attacking …"). Printed mobilize is N=1…3; higher values fall back to the
 *  bare numeral. */
const COUNT_WORDS: Record<number, string> = {
    2: "two",
    3: "three",
    4: "four",
    5: "five",
};

/** Stable ability id for a `mobilize N` instance, keyed on N for the same two
 *  reasons `annihilatorTriggerId` is: resolution reads the ability back off
 *  the definition BY ID (`StackItem.triggeredAbilityId`), and
 *  `triggerOrderKey` (`gre/triggers.ts`) is `${cardId}::${abilityId}`, so a
 *  shared key auto-orders two outcome-identical triggers (ADR 0003). */
export function mobilizeTriggerId(n: number): string {
    return `mobilize-${n}`;
}

/** CR 702.181a rules text for the injected trigger, in the printed reminder
 *  text's wording for N. */
export function mobilizeOracleText(n: number): string {
    if (n === 1) {
        return "Mobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it at the beginning of the next end step.)";
    }
    const word = COUNT_WORDS[n] ?? String(n);
    return `Mobilize ${n} (Whenever this creature attacks, create ${word} tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step.)`;
}

/** CR 702.181a — the synthesized attack trigger for one instance of
 *  `mobilize N`. */
export function mobilizeTrigger(n: number): TriggeredAbility {
    // One binding name, not one per instance: each stack object runs its own
    // script with its own `collectedChoices` store.
    const bind = "$mobilized";
    return attacksTrigger({
        id: mobilizeTriggerId(n),
        oracleText: mobilizeOracleText(n),
        scope: "self",
        effects: [
            {
                op: "createToken",
                token: {
                    ...WARRIOR_TOKEN,
                    entersTapped: true,
                    entersAttacking: true,
                },
                controller: "controller",
                count: n,
                bindAll: bind,
            },
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "Sacrifice them at the beginning of the next end step.",
                capture: { [bind]: { select: { set: "bound", ref: bind } } },
                effects: [{ op: "sacrifice", permanents: { ref: bind } }],
            },
        ],
    });
}

/** Reads every declared `mobilize N` keyword off `staticAbilities` in
 *  declaration order — one entry per matching string. */
function parseMobilize(
    staticAbilities: ReadonlyArray<string> | undefined
): number[] {
    if (!staticAbilities) return [];
    const out: number[] = [];
    for (const s of staticAbilities) {
        const m = MOBILIZE_PATTERN.exec(s.trim());
        if (!m) continue;
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
}

/** ADR 0054 keyword expansion — injects one CR 702.181a attack trigger per
 *  declared instance of `mobilize N`. A no-op for every other card, so it
 *  composes freely in `expandDefinition`'s chain (order irrelevant). */
export function expandMobilize(def: CardDefinition): CardDefinition {
    const instances = parseMobilize(def.staticAbilities);
    if (instances.length === 0) return def;
    // Idempotence guard: never inject twice.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => MOBILIZE_TRIGGER_ID_PATTERN.test(t.id))) {
        return def;
    }
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...instances.map((n) => mobilizeTrigger(n)),
        ],
    };
}
