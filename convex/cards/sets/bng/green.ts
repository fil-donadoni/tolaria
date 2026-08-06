// bng — green cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Satyr Wayfinder — {1}{G} Creature — Satyr, 1/1 (Vintage Cube residue,
// issue #1305, parent PRD #620). "When this creature enters, reveal the top
// four cards of your library. You may put a land card from among them into
// your hand. Put the rest into your graveyard." UNBLOCKED since the earlier
// #679 stub note (which predates the `digToHand` Op, issue #984/#1101):
// `digToHand` is a fixed top-N reveal window with a type filter and a
// graveyard destination for the non-kept cards — exactly this shape (`look:
// 4, take: 1, optional: true` — "you MAY put A land card", `filter: { type:
// "Land" }`, `destination: "graveyard"`). Both the reveal-window suspend and
// the graveyard-destination leg are already interpreter-exercised (Reviving
// Vapors, inv/multicolor.ts, issue #1101) — no hand-written per-card test
// required (per-Op test regime, gre-development.md).
export const satyrWayfinder: CardDefinition = {
    id: "13c5a1ce-932a-4b3d-8b86-ed920e646afc",
    name: "Satyr Wayfinder",
    rarity: "common",
    oracleText:
        "When this creature enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Satyr"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "satyr-wayfinder-etb",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.",
            scope: "self",
            effects: [
                {
                    op: "digToHand",
                    player: "controller",
                    look: 4,
                    take: 1,
                    optional: true,
                    filter: { type: "Land" },
                    // "REVEAL the top four cards" (CR 701.20a) — every player
                    // sees all four in the reveal dialog, even when no land is
                    // kept (the reveal fires regardless of the optional pick).
                    reveal: "window",
                    destination: "graveyard",
                },
            ],
        }),
    ],
};

// Courser of Kruphix — {1}{G}{G} Enchantment Creature — Centaur, 2/4.
// "Play with the top card of your library revealed. You may play lands from the
// top of your library. Landfall — Whenever a land you control enters, you gain
// 1 life." Three independent structured declarations, no `resolve()`:
//   - `revealsLibraryTop: "controller"` (CR 401.5 / 604.2) — the same live,
//     never-stored derivation Goblin Spy uses (`inv/red.ts`,
//     `computeLibraryTopRevealedPlayers`): the reveal belongs to the POSITION,
//     so a draw / shuffle / mill / put-on-top moves it with nothing to update
//     (CR 401.6 / 701.20d) and it simply stops when the Courser leaves play.
//   - `playsLandsFromTopOfLibrary: true` (CR 305.1-analog permission) — read
//     live off the battlefield by `canPlayLandsFromTopOfLibrary` /
//     `isPlayableLibraryTopLand` (`convex/gre/rules.ts`), position-strict at
//     index 0. The sibling of Icetill Explorer's `playsLandsFromGraveyard`
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
export const courserOfKruphix: CardDefinition = {
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
};
