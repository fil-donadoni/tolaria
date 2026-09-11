// jud — black cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Cabal Therapy — {B} Sorcery. "Choose a nonland card name. Target player
// reveals their hand and discards all cards with that name." plus
// "Flashback—Sacrifice a creature." (CR 601.2c the announced player;
// CR 201.3 the name choice; CR 701.20a the reveal; CR 701.9 the discard;
// CR 702.34a flashback.)
//
// Three Ops in printed order. `nameCard` SUSPENDS for the open choice and
// records the name as a binding; its `nameRestriction: "no-land"` is the
// printed "NONLAND card name" checked at submit time — the stronger of the
// two CR 201.3 strengths, where Desperate Research (`inv/black.ts`) uses
// `"no-basic-land"`. `reveal` shows the whole targeted hand to every player.
// The discard then reads the name back through the filter's bare
// `{ ref }` form, exactly as `digMatchingToHand` does: it is the `discard`
// Op's filter shape (issue #2713), NOT a `moveZone` hand→graveyard sweep,
// because only `discardCard` emits CR 701.9's event — madness, Library of
// Leng and every "whenever you discard" watcher hang off it.
//
// The flashback cost is purely non-mana (`{ sacrifice: … }` with no `mana`
// key), the Lava Dart shape (`ons/red.ts`): any creature, the caster's
// explicit pick through the unified sacrifice-choice layer.
//
// compiler-gap: Choose a nonland card name. Target player reveals their hand and discards all cards with that name. (#2693)
export const cabalTherapy: CardDefinition = {
    id: "0a5df970-c6ba-4824-b8ba-67244aec2b82", // JUD 62
    rarity: "uncommon",
    name: "Cabal Therapy",
    oracleText:
        "Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback\u2014Sacrifice a creature. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    flashback: { sacrifice: { types: "Creature" } },
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "nameCard",
            player: "controller",
            prompt: "Choose a nonland card name.",
            bind: "$named",
            nameRestriction: "no-land",
        },
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "discard",
            player: { target: 0 },
            filter: { name: { ref: "$named" } },
        },
    ],
};
