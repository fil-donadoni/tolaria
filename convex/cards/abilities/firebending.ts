// Firebending N (CR 702.189) — a TRIGGERED-ability keyword expanded implicitly
// from the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the same ADR 0054 mechanism annihilator,
// fading/vanishing, exalted/prowess and hideaway use. A card declares only
// `staticAbilities: ["firebending 4"]`; `expandFirebending` injects the
// synthesized attack trigger, so the keyword's rules text lives in exactly one
// place — the string. A card can therefore never print the keyword and enforce
// nothing (the deathtouch / hexproof shape Guard A exists to catch), and it can
// never carry the enforcing trigger without the board-visible keyword either:
// the string is the ONLY input the expansion reads. Issue #3235.
//
// 702.189a "Firebending is a triggered ability. 'Firebending N' means
//          'Whenever this creature attacks, add N {R}. Until end of combat,
//          you don't lose this mana as steps and phases end.'"
// 702.189b "An ability that triggers whenever a player firebends triggers
//          whenever a firebending ability they control resolves."
//
// 702.189b is N/A: no card in the catalogue triggers off "whenever a player
// firebends", so there is nothing to wire up — the same disposition earthbend's
// own CR 701.66b clause carries (`mechanicsRegistry.ts`).
//
// MULTIPLE INSTANCES: this keyword's section carries no "each triggers
// separately" subrule the way CR 702.86b does for annihilator.
// It does not need one: CR 702.189a says firebending IS a triggered
// ability, so two instances are two abilities
// and the engine's per-entry trigger scan fires both by construction. The
// expansion therefore counts EVERY matching string (annihilator's shape), not
// the first, and keys the injected id on N so two instances of DIFFERENT N
// resolve with their own count while two of the SAME N share a key and
// auto-order (ADR 0003 — outcome-interchangeable triggers are not worth a
// CR 603.3b ordering prompt).
//
// Fully declarative (DSL-first, ADR 0045): the injected trigger's body is ONE
// shipped Op — `addMana` (CR 106.1, issue #850) carrying the `persistsUntil:
// "end-of-combat"` lifetime this keyword is the first producer of. No
// firebending-specific Op, no new primitive, no `resolve()` closure. The
// lifetime is honoured by `emptyManaPools` (gre/phases.ts), which spares a unit
// whose `persistsUntil` outlives the boundary being crossed — see
// `manaPersistenceSurvives` (gre/state.ts), the single authority on which
// boundary that is.
//
// WHOSE POOL: CR 106.4 — the mana goes to the controller of the ability that
// produced it, which `addMana` already defaults to (`player: "controller"`),
// so the Op carries no `player` field at all.

import type { CardDefinition, TriggeredAbility } from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";

/** Matches the parametrized keyword string, e.g. `"firebending 4"` (CR 702.189a
 *  — N is always spelled as a numeral in the Oracle keyword line). */
const FIREBENDING_PATTERN = /^firebending (\d+)$/i;

/** Matches an already-injected firebending ability id — the idempotence guard
 *  below, which must recognise ANY instance, not a fixed one. */
const FIREBENDING_TRIGGER_ID_PATTERN = /^firebending-\d+$/;

/** Stable ability id for a `firebending N` instance, keyed on N for the same
 *  two reasons `annihilatorTriggerId` is: resolution reads the ability back off
 *  the definition BY ID (`StackItem.triggeredAbilityId`), and `triggerOrderKey`
 *  (`gre/triggers.ts`) is `${cardId}::${abilityId}`, so a shared key
 *  auto-orders two outcome-identical triggers. */
export function firebendingTriggerId(n: number): string {
    return `firebending-${n}`;
}

/** CR 702.189a rules text for the injected trigger, with the printed reminder
 *  text spelled out for N — the same `{R}` repetition the card face carries
 *  ("Firebending 4 (Whenever this creature attacks, add {R}{R}{R}{R}. This mana
 *  lasts until end of combat.)"). */
export function firebendingOracleText(n: number): string {
    return `Firebending ${n} (Whenever this creature attacks, add ${"{R}".repeat(n)}. This mana lasts until end of combat.)`;
}

/** CR 702.189a — the synthesized attack trigger for one instance of
 *  `firebending N`. `scope: "self"` is the rule's own "whenever THIS creature
 *  attacks"; the body adds N red mana carrying the `"end-of-combat"` lifetime.
 *
 *  The `addMana` Op's `mana` map is JSON-pure, so N red pips are `{ R: n }` —
 *  one unit of N, not N units of one. That is CR 106.4-correct (mana of the
 *  same kind is fungible) and is what the pool's own per-colour count map
 *  models anyway. */
export function firebendingTrigger(n: number): TriggeredAbility {
    return attacksTrigger({
        id: firebendingTriggerId(n),
        oracleText: firebendingOracleText(n),
        scope: "self",
        effects: [
            {
                op: "addMana",
                mana: { R: n },
                persistsUntil: "end-of-combat",
            },
        ],
    });
}

/** Reads every declared `firebending N` keyword off `staticAbilities` in
 *  declaration order — one entry per matching string (including literal
 *  duplicates), see the file header on multiple instances. */
function parseFirebending(
    staticAbilities: ReadonlyArray<string> | undefined
): number[] {
    if (!staticAbilities) return [];
    const out: number[] = [];
    for (const s of staticAbilities) {
        const m = FIREBENDING_PATTERN.exec(s.trim());
        if (!m) continue;
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
}

/** ADR 0054 keyword expansion — injects one CR 702.189a attack trigger per
 *  declared instance of `firebending N`. A no-op for every other card, so it
 *  composes freely in `expandDefinition`'s chain (order irrelevant). */
export function expandFirebending(def: CardDefinition): CardDefinition {
    const instances = parseFirebending(def.staticAbilities);
    if (instances.length === 0) return def;
    // Idempotence guard: never inject twice (the seam memoizes per base
    // definition, but a definition that already carries the synthesized
    // abilities must not end up with duplicates — that would double the mana).
    // Matches ANY already-injected instance, since which N is present varies
    // per card.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => FIREBENDING_TRIGGER_ID_PATTERN.test(t.id))) {
        return def;
    }
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...instances.map((n) => firebendingTrigger(n)),
        ],
    };
}
