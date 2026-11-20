// bng — green cards (ADR 0043 colour split).

import { defineCard } from "../../types";

import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Courser of Kruphix — {1}{G}{G} Enchantment Creature — Centaur, 2/4.
// "Play with the top card of your library revealed. You may play lands from the
// top of your library. Landfall — Whenever a land you control enters, you gain
// 1 life." Three independent structured declarations, no `resolve()`:
//   - `revealsLibraryTop: "controller"` (CR 401.5 / 604.2) — the same live,
//     never-stored derivation Goblin Spy uses (`inv/red.cards.ts`,
//     `computeLibraryTopRevealedPlayers`): the reveal belongs to the POSITION,
//     so a draw / shuffle / mill / put-on-top moves it with nothing to update
//     (CR 401.6 / 701.20d) and it simply stops when the Courser leaves play.
//   - `playsLandsFromTopOfLibrary: true` (CR 305.1-analog permission) — read
//     live off the battlefield by `canPlayLandsFromTopOfLibrary` /
//     `isPlayableLibraryTopLand` (`convex/gre/rules.ts`), position-strict at
//     index 0. The sibling of Icetill Explorer's `graveyardPlayPermission`
//     (#1190) for the other permitted alternate land-play zone, and
//     deliberately a SEPARATE field from the reveal above: the CR does not tie
//     the two (Vizier of the Menagerie plays off the top without revealing;
//     Goblin Spy reveals without any play permission), Courser just happens to
//     print both clauses.
//   - Landfall→gain 1 life: the shared `landfallTrigger` factory (a
//     `PERMANENT_ENTERED` trigger gated to lands you control, CR 603.6a /
//     109.2) with a pure DSL `gainLife` Op on the controller. Note this fires
//     for EVERY land you control entering, including one played off the top by
//     the permission above — the trigger keys on the entry, not on the source
//     zone (CR 603.6a).
export const courserOfKruphix = defineCard(() => ({
    id: "da5a807f-58e8-4d92-a61c-47bb9b28977f",
    name: "Courser of Kruphix",
    rarity: "rare",
    oracleText:
        "Play with the top card of your library revealed.\nYou may play lands from the top of your library.\nLandfall — Whenever a land you control enters, you gain 1 life.",
    manaCost: { X: 1, G: 2 },
    types: ["Enchantment", "Creature"],
    subtypes: ["Centaur"],
    power: 2,
    toughness: 4,
    revealsLibraryTop: "controller",
    playsLandsFromTopOfLibrary: true,
    triggeredAbilities: [
        landfallTrigger({
            id: "courser-of-kruphix-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, you gain 1 life.",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
}));
