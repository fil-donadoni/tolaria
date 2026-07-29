// Sagas (CR 714) — `chapterAbilities` desugaring at the `getDefinition` seam
// (ADR 0078). The card-side half of the framework: a Saga declares its chapter
// lines as data and this module expands them, exactly the way
// `fadingVanishing.ts` expands `fading N` / `vanishing N` (ADR 0054).
//
// What the expander injects, per CR 714:
//
//   - 714.3a — "this Saga enters with a lore counter on it": one `entersWith`
//     lore counter. Suppressed under a layer-6 ability-loss like every other
//     CR 614.1c entry-counter clause (issue #1882): a Saga entering while
//     Humility / Blood Moon is already out gets ZERO lore counters — 714.3a is
//     an ability, and the gate lives at the shared `applyEntersWithCounters`
//     choke point, so no Saga-specific code is involved.
//   - 714.2b — "{rN} — [Effect]" means "When one or more lore counters are put
//     onto this Saga, if the number of lore counters on it was less than N and
//     became at least N, [effect]". Built on the shipped `counterAddedTrigger`
//     factory, whose event payload (`added`/`total`) is exactly the before/after
//     pair the chapter condition needs.
//
// The chapter condition is a TRIGGER condition, not an intervening-if: it is
// evaluated once, at trigger time, off the event payload. Re-checking it
// against live counters at resolution would make removing lore counters in
// response to a chapter ability fizzle it, which is wrong (ADR 0078 §6).
//
// Every synthesized ability carries `chapterNumbers`, the tag the GRE reads
// back for BOTH `finalChapter` (CR 714.2d) and the CR 714.4 sacrifice SBA's
// "is a chapter ability of this Saga on the stack" test. See `gre/sagas.ts`.

import type {
    CardDefinition,
    ChapterAbilityDefinition,
    TriggeredAbility,
} from "../types";
import { counterAddedTrigger } from "./triggers/counterAddedTrigger";

/** CR 714.3 — the counter type a Saga tracks its progress with. */
export const LORE_COUNTER = "lore";

/** CR 205.3h — the enchantment subtype that makes a permanent a Saga. NOT
 *  "has chapter abilities": CR 714.2d explicitly contemplates a Saga with
 *  none (ADR 0078 §4). */
export const SAGA_SUBTYPE = "Saga";

/** Deterministic ability id for a chapter line, derived from its chapter
 *  numbers so it is stable across expansions and unique within the card. */
export const chapterAbilityId = (chapters: readonly number[]): string =>
    `saga-chapter-${[...chapters].sort((a, b) => a - b).join("-")}`;

/** CR 714.2b/714.2c — did this placement cross chapter N? "was less than N and
 *  became at least N", read off the event payload. */
const crosses = (total: number, added: number, chapter: number): boolean =>
    total - added < chapter && total >= chapter;

function buildChapterTrigger(
    entry: ChapterAbilityDefinition
): TriggeredAbility {
    const chapters = [...entry.chapters].sort((a, b) => a - b);
    const ability = counterAddedTrigger({
        id: chapterAbilityId(chapters),
        oracleText: entry.oracleText,
        // CR 714.2b — "onto THIS Saga". A lore counter landing on another
        // permanent never fires it.
        scope: "self",
        counterType: LORE_COUNTER,
        condition: (event) =>
            chapters.some((n) => crosses(event.total, event.added, n)),
        effects: entry.effects,
    });
    ability.chapterNumbers = chapters;
    return ability;
}

/** ADR 0078 §1 — expand `chapterAbilities[]` into synthesized triggers plus the
 *  CR 714.3a entry lore counter. A no-op for every non-Saga card, so it chains
 *  freely with the other `getDefinition` expanders. Pure: never mutates `def`.
 *  Re-expansion is idempotent (guarded on the synthesized ability ids), which
 *  matters because token copies re-enter the same seam. */
export function expandChapterAbilities(def: CardDefinition): CardDefinition {
    const chapters = def.chapterAbilities;
    if (!chapters || chapters.length === 0) return def;

    const existing = def.triggeredAbilities ?? [];
    const injected = chapters.map(buildChapterTrigger);
    if (existing.some((t) => injected.some((n) => n.id === t.id))) return def;

    const existingCounters = def.entersWith?.counters ?? [];
    const alreadyEntersWithLore = existingCounters.some(
        (c) => c.type === LORE_COUNTER
    );

    return {
        ...def,
        entersWith: {
            ...def.entersWith,
            counters: alreadyEntersWithLore
                ? existingCounters
                : [...existingCounters, { type: LORE_COUNTER, count: 1 }],
        },
        triggeredAbilities: [...existing, ...injected],
    };
}
