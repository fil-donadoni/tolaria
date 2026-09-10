// Cascade (CR 702.85) — a triggered-ability keyword expanded IMPLICITLY from a
// bare `staticAbilities: ["cascade"]` string at the `getDefinition` seam
// (`expandCascade`, chained in `convex/cards/registry.ts` alongside
// `expandHideaway` / `expandAnnihilator` / `expandKeywordTriggers`, ADR 0054).
// A card declares ONLY the string; this seam injects the CR 702.85a cast
// trigger, so the keyword's rules text lives in exactly one place, the keyword
// can never be printed with nothing enforcing it (the deathtouch/hexproof shape
// Guard A catches), and the trigger can never be declared without the keyword
// (the string is the expansion's only input). Issue #3216.
//
// The injected ability is a `spellCastTrigger({ scope: "self" })`, which is
// what "functions only while the spell with cascade is on the stack"
// (CR 702.85a) means mechanically: `scope: "self"` stamps `functionsFromStack`,
// so `collectSelfCastTriggers` (CR 603.6e, `gre/state.ts`) collects it at the
// cast choke point — the only sweep that can see a trigger whose source is the
// spell being announced — and pushes it ABOVE that spell. That ordering is the
// keyword's whole point: the cascade trigger resolves FIRST, so the free spell
// it finds resolves before the spell that cascaded (CR 603.3b).
//
// The body is the single `cascade` Op (fully declarative, ADR 0045 — no
// `resolve()`); the rules derivation for the walk, the free cast and the
// random-order bottom lives on that Op's `EFFECT_OP_REGISTRY` row.

import type { CardDefinition, TriggeredAbility } from "../types";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const CASCADE_KEYWORD = "cascade";

/** Stack-item marker id for the synthesized cascade trigger. The FIRST
 *  instance keeps the bare keyword id (matching the Mechanics Registry row id,
 *  CR 702.85); a second and later instance are suffixed, because CR 702.85c
 *  makes them separate triggers and two abilities sharing an id would collapse
 *  into one stack object. */
export function cascadeTriggerId(instance: number): string {
    return instance === 0
        ? CASCADE_KEYWORD
        : `${CASCADE_KEYWORD}-${instance + 1}`;
}

const CASCADE_TRIGGER_ID_PATTERN = /^cascade(-\d+)?$/;

/** CR 702.85a's reminder text, verbatim — the ability's own Oracle wording, not
 *  the shorter parenthetical the printed cards carry. */
const CASCADE_ORACLE_TEXT =
    "When you cast this spell, exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. You may cast that card without paying its mana cost if the resulting spell's mana value is less than this spell's mana value. Then put all cards exiled this way that weren't cast on the bottom of your library in a random order.";

/** CR 702.85a — the synthesized "when you cast this spell" trigger for one
 *  instance of cascade. */
export function cascadeTrigger(instance = 0): TriggeredAbility {
    return spellCastTrigger({
        id: cascadeTriggerId(instance),
        oracleText: CASCADE_ORACLE_TEXT,
        // "this spell" — the trigger watches its OWN cast and nothing else,
        // which is also what earns it `functionsFromStack` (see the header).
        scope: "self",
        effects: [{ op: "cascade", player: "controller" }],
    });
}

/** Counts every declared `cascade` keyword on `staticAbilities`. CR 702.85c —
 *  multiple instances each trigger separately, so this counts literal
 *  duplicates rather than deduplicating them, exactly like `parseAnnihilator`.
 *  Case-insensitive and whitespace-tolerant, matching every other keyword
 *  parser at this seam. */
function countCascade(
    staticAbilities: ReadonlyArray<string> | undefined
): number {
    if (!staticAbilities) return 0;
    let n = 0;
    for (const s of staticAbilities) {
        if (s.trim().toLowerCase() === CASCADE_KEYWORD) n += 1;
    }
    return n;
}

/** ADR 0054 keyword expansion — injects one CR 702.85a cast trigger per
 *  declared instance of `cascade`. A no-op for every other card, so it composes
 *  freely in `expandDefinition`'s chain (order irrelevant). */
export function expandCascade(def: CardDefinition): CardDefinition {
    const instances = countCascade(def.staticAbilities);
    if (instances === 0) return def;
    // Idempotence guard: never inject twice (the seam memoizes per base
    // definition, but a definition that already carries a synthesized ability
    // must not end up with duplicates — that would over-count CR 702.85c).
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => CASCADE_TRIGGER_ID_PATTERN.test(t.id))) return def;
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...Array.from({ length: instances }, (_, i) => cascadeTrigger(i)),
        ],
    };
}
