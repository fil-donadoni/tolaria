// Annihilator N (CR 702.86) — a TRIGGERED-ability keyword expanded implicitly
// from the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the same ADR 0054 mechanism fading/vanishing,
// exalted/prowess and hideaway use. A card declares only
// `staticAbilities: ["annihilator 6"]`; `expandAnnihilator` injects the
// synthesized attack trigger, so the keyword's rules text lives in exactly one
// place — the string. A card can therefore never print the keyword and enforce
// nothing (the deathtouch / hexproof shape Guard A exists to catch), and it can
// never carry the enforcing trigger without the board-visible keyword either:
// the string is the ONLY input the expansion reads. Issue #2295.
//
// 702.86a "Annihilator is a triggered ability. 'Annihilator N' means 'Whenever
//         this creature attacks, defending player sacrifices N permanents of
//         their choice.'"
// 702.86b "If a creature has multiple instances of annihilator, each triggers
//         separately."
//
// 702.86b is why the expansion counts EVERY matching `staticAbilities` entry
// rather than the first: two instances inject two independent entries in
// `triggeredAbilities[]`, and the trigger scan in `gre/triggers.ts` iterates
// that array with no dedup, so each pushes its own stack object and each
// sacrifices its own N. That is deliberately the OPPOSITE of the one-Oracle-
// line dedup standard (`convex/cards/__tests__/triggerDedup.test.ts`): those
// are two DISTINCT keyword instances, not one Oracle line rendered twice, so
// they must not be collapsed into an array-`event` ability. (The dedup guard
// only flags same-`oracleText` triggers listening on DISTINCT scalar events, so
// duplicate annihilator instances are outside its net by construction — the
// test file pins that.)
//
// DEFENDING PLAYER (CR 506.2 / 508.1): this project is 2-player only
// (CLAUDE.md § Out of Scope — no 3+ player multiplayer), so "defending player"
// is exactly the attacking creature's controller's single opponent. The
// trigger's controller IS that attacking creature's controller, hence the bare
// `player: "opponent"` player ref — no multiplayer defending-player resolver is
// built, and none is needed.
//
// Fully declarative (DSL-first, ADR 0045): the injected trigger's body is the
// shipped Portal to Phyrexia composition — a `choice` Op of kind
// `sacrifice-permanents` (no `filter`, so EVERY permanent type the defending
// player controls is eligible, CR 702.86a "N permanents of their choice") whose
// picks the `sacrifice` Op then consumes. Both Ops are interpreter-suite
// exercised; no new Op, no new primitive, no `resolve()` closure.
//
// CR 608.2b is handled by the `choice` Op itself: `count` clamps to however
// many permanents the defending player actually controls, and a defending
// player with ZERO permanents raises no choice at all — the binding stays
// uncaptured, so `sacrifice` skips and the trigger resolves as a clean no-op
// (nothing left suspended).

import type { CardDefinition, TriggeredAbility } from "../types";

/** Matches the parametrized keyword string, e.g. `"annihilator 6"` (CR 702.86a
 *  — N is always spelled as a numeral in the Oracle keyword line). */
const ANNIHILATOR_PATTERN = /^annihilator (\d+)$/i;

/** Matches an already-injected annihilator ability id — the idempotence guard
 *  below, which must recognise ANY instance, not a fixed one. */
const ANNIHILATOR_TRIGGER_ID_PATTERN = /^annihilator-\d+$/;

/** Spelled-out counts for the printed reminder text ("sacrifices six
 *  permanents"). Printed annihilator is N=1…6; higher values fall back to the
 *  bare numeral. */
const COUNT_WORDS: Record<number, string> = {
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
};

/** Stable ability id for an `annihilator N` instance. Keyed on N, NOT on the
 *  instance's position, and that is load-bearing in two directions:
 *
 *   - Resolution reads the ability back off the definition BY ID
 *     (`StackItem.triggeredAbilityId`), so two instances with different N must
 *     carry different ids or the second would resolve with the first's count.
 *   - `triggerOrderKey` (`gre/triggers.ts`) is `${cardId}::${abilityId}`, and
 *     a slice whose members all share one key AUTO-ORDERS (ADR 0003 — two
 *     copies of the same printed ability are outcome-interchangeable, so
 *     CR 603.3b's ordering right is not worth a prompt). Two instances of the
 *     SAME N are exactly that case, so they share an id and the controller is
 *     never asked to order two identical triggers. Two instances of DIFFERENT
 *     N do get the real CR 603.3b ordering prompt. */
export function annihilatorTriggerId(n: number): string {
    return `annihilator-${n}`;
}

/** CR 702.86a rules text for the injected trigger, spelled out for N. */
export function annihilatorOracleText(n: number): string {
    const word = COUNT_WORDS[n] ?? String(n);
    const noun = n === 1 ? "permanent" : "permanents";
    return `Annihilator ${n} (Whenever this creature attacks, defending player sacrifices ${word} ${noun}.)`;
}

/** CR 702.86a — the synthesized attack trigger for one instance of
 *  `annihilator N`. Two instances of the same N produce two IDENTICAL ability
 *  objects (same id, same script); the trigger scan still pushes one stack
 *  object per array entry, which is what CR 702.86b asks for. */
export function annihilatorTrigger(n: number): TriggeredAbility {
    // One binding name, not one per instance: each stack object runs its own
    // script with its own `collectedChoices` store keyed by stack item + step,
    // so two simultaneous annihilator triggers never share a binding.
    const bind = "$annihilated";
    return {
        id: annihilatorTriggerId(n),
        oracleText: annihilatorOracleText(n),
        // CR 508.1 — fires on the attack DECLARATION (one ATTACKERS_DECLARED
        // event carries every attacker), so the ability is put on the stack
        // during the declare-attackers step and resolves BEFORE blockers are
        // declared (CR 509.1). It is independent of its source thereafter: the
        // attacker being blocked, removed or otherwise changed does not affect
        // the already-triggered ability (CR 603.2 / 608.2b applies only to the
        // effect's own referents).
        event: "ATTACKERS_DECLARED",
        matches: (event, self) =>
            event.type === "ATTACKERS_DECLARED" &&
            event.attackerIds.includes(self.id),
        effects: [
            {
                op: "choice",
                kind: "sacrifice-permanents",
                // 2-player only — the defending player is the trigger
                // controller's one opponent (see the file header).
                player: "opponent",
                zone: "battlefield",
                // NO `filter`: CR 702.86a says "N permanents", any type, the
                // defending player's choice. A filter-less battlefield choice
                // offers every permanent that player controls, and the submit
                // validator (`pendingChoiceSubmit.ts`) still gates every pick
                // on membership in that player's battlefield.
                count: n,
                prompt: `Annihilator ${n}: choose ${COUNT_WORDS[n] ?? String(n)} ${n === 1 ? "permanent" : "permanents"} to sacrifice.`,
                bind,
            },
            { op: "sacrifice", permanents: { ref: bind } },
        ],
    };
}

/** Reads every declared `annihilator N` keyword off `staticAbilities` in
 *  declaration order. CR 702.86b — multiple instances each trigger separately,
 *  so this returns ONE entry per matching string (including literal duplicates)
 *  rather than the first match or a deduplicated set. */
function parseAnnihilator(
    staticAbilities: ReadonlyArray<string> | undefined
): number[] {
    if (!staticAbilities) return [];
    const out: number[] = [];
    for (const s of staticAbilities) {
        const m = ANNIHILATOR_PATTERN.exec(s.trim());
        if (!m) continue;
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
}

/** ADR 0054 keyword expansion — injects one CR 702.86a attack trigger per
 *  declared instance of `annihilator N`. A no-op for every other card, so it
 *  composes freely in `expandDefinition`'s chain (order irrelevant). */
export function expandAnnihilator(def: CardDefinition): CardDefinition {
    const instances = parseAnnihilator(def.staticAbilities);
    if (instances.length === 0) return def;
    // Idempotence guard: never inject twice (the seam memoizes per base
    // definition, but a definition that already carries the synthesized
    // abilities must not end up with duplicates — that would over-count
    // CR 702.86b). Matches ANY already-injected instance, since which N is
    // present varies per card.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => ANNIHILATOR_TRIGGER_ID_PATTERN.test(t.id))) {
        return def;
    }
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...instances.map((n) => annihilatorTrigger(n)),
        ],
    };
}
