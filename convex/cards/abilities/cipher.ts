// Cipher (CR 702.99) — a keyword on instants and sorceries, expanded from a bare
// `staticAbilities: ["cipher"]` string at the `getDefinition` seam (ADR 0054). It
// represents two abilities, and only the first is on the card's own script:
//
//   * "If this spell is represented by a card, you may exile this card encoded on
//     a creature you control" (CR 702.99a) is the last step of the spell's
//     resolution, so `expandCipher` appends it after the spell's own Ops. The
//     creature is chosen as the spell resolves and is not a target. A spell that
//     fizzles or is countered runs no script and so encodes nothing, and a copy
//     (CR 707.10) is asked nothing.
//
//   * "For as long as this card is encoded on that creature, that creature has
//     'Whenever this creature deals combat damage to a player, you may copy the
//     encoded card and you may cast the copy without paying its mana cost.'"
//     functions from exile, where no ability scan looks. `gre/cipher.ts` owns it:
//     the combat damage event names the encoded cards, and the trigger is built
//     per card from the link `exileSelf` stamped.
//
// Definition-level, so `isDefinitionLevelKeyword` quarantines a compiled grant of
// cipher: a grant writes the instance, and this reads the definition.

import type { CardDefinition, EffectOp } from "../types";

const CIPHER_KEYWORD = "cipher";

/** CR 702.99a — the spell ability, run after everything else the spell does. */
export const CIPHER_ENCODE_STEP: EffectOp = {
    op: "if",
    predicate: { spellRepresentedByCard: true },
    then: [
        {
            op: "choice",
            kind: "choose-permanents",
            player: "controller",
            zone: "battlefield",
            filter: { type: "Creature" },
            count: { min: 0, max: 1 },
            prompt: "You may exile this card encoded on a creature you control.",
            bind: "$cipherCreature",
        },
        { op: "exileSelf", encodedOn: { ref: "$cipherCreature" } },
    ],
};

/** ADR 0054 keyword expansion. A no-op for every other card, so it composes
 *  freely in `expandDefinition`'s chain. */
export function expandCipher(def: CardDefinition): CardDefinition {
    if (!def.staticAbilities?.includes(CIPHER_KEYWORD)) return def;
    const effects = def.effects ?? [];
    if (effects.includes(CIPHER_ENCODE_STEP)) return def;
    return { ...def, effects: [...effects, CIPHER_ENCODE_STEP] };
}
