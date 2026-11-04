// Changeling (CR 702.73) — "This object is every creature type", a
// characteristic-defining ability that works everywhere, even outside the game.
//
// Modelled as the object's BASE subtype line rather than a layer-4 continuous
// effect, because that is what makes every clause of the rule fall out of the
// readers the engine already has:
//   • CR 604.3 — a CDA functions in all zones. Every zone's reader starts from
//     `def.subtypes` (`gre/zoneCharacteristics.ts`), and deck statistics read
//     the same definition, so no zone needs to ask about the keyword.
//   • CR 613.3 — within layer 4, a CDA applies before every other effect. A base
//     value precedes the whole walk, so a later "becomes a Frog" still replaces
//     the creature types (CR 205.1a, `applyCreatureTypeReplacement`).
//   • CR 613.6 — once it has applied, removing the ability in layer 6 (Humility)
//     does not undo it. The base line is never re-derived from the live keyword.
//   • CR 707.2 — the ability is a copiable value, so a copy reads the copied
//     definition's line, and an "except it has changeling" copy goes through
//     `withChangelingSubtypes` (`gre/identitySwap.ts`).
//
// Printed subtypes stay first, so the line a card carries is still its printed
// one followed by the rest of the CR 205.3m table, and two reads of the same
// declaration build the same array (`gre/serialize.ts` compacts an instance whose
// line equals its definition's, and compares in order).
import { CREATURE_SUBTYPES } from "../../oracle/grammar/shared/subtypes";
import type { CardDefinition } from "../types";

const CHANGELING_KEYWORD = "changeling";

/** Whether a `staticAbilities[]` declares CR 702.73 Changeling. */
function hasChangeling(staticAbilities: readonly string[] | undefined) {
    return staticAbilities?.includes(CHANGELING_KEYWORD) ?? false;
}

/** The subtype line of an object declaring these abilities (CR 702.73a): its own
 *  subtypes, plus every CR 205.3m creature type when it has changeling. Returns
 *  `subtypes` itself otherwise, and for a line that is already complete, so
 *  reapplying it is a no-op. */
export function withChangelingSubtypes(
    subtypes: string[],
    staticAbilities: readonly string[] | undefined
): string[];
export function withChangelingSubtypes(
    subtypes: string[] | undefined,
    staticAbilities: readonly string[] | undefined
): string[] | undefined;
export function withChangelingSubtypes(
    subtypes: string[] | undefined,
    staticAbilities: readonly string[] | undefined
): string[] | undefined {
    if (!hasChangeling(staticAbilities)) return subtypes;
    const printed = subtypes ?? [];
    const missing = [...CREATURE_SUBTYPES].filter((s) => !printed.includes(s));
    return missing.length === 0 ? subtypes : [...printed, ...missing];
}

/** CR 702.73a — ADR 0054 expander: a definition (or its back face) declaring
 *  changeling carries every creature type on its subtype line. A no-op for
 *  every other card, so it composes freely in `expandDefinition`'s chain. */
export function expandChangeling(def: CardDefinition): CardDefinition {
    const subtypes = withChangelingSubtypes(def.subtypes, def.staticAbilities);
    const backSubtypes = def.backFace
        ? withChangelingSubtypes(
              def.backFace.subtypes,
              def.backFace.staticAbilities
          )
        : undefined;
    const frontChanged = subtypes !== def.subtypes;
    const backChanged = backSubtypes !== def.backFace?.subtypes;
    if (!frontChanged && !backChanged) return def;
    return {
        ...def,
        ...(frontChanged ? { subtypes } : {}),
        ...(backChanged && def.backFace
            ? {
                  backFace: {
                      ...def.backFace,
                      subtypes: backSubtypes,
                  },
              }
            : {}),
    };
}

/** How a subtype line reads to a player: every creature type collapses to one
 *  phrase instead of ~300 words, and the rest of the line stays (a Shapeshifter
 *  Equipment keeps "Equipment"). Reads the line, never the keyword, so an object
 *  an effect has since turned into a Frog reads "Frog". */
export function displaySubtypes(subtypes: readonly string[]): string[] {
    if (![...CREATURE_SUBTYPES].every((s) => subtypes.includes(s))) {
        return [...subtypes];
    }
    return [
        "Every creature type",
        ...subtypes.filter((s) => !CREATURE_SUBTYPES.has(s)),
    ];
}
