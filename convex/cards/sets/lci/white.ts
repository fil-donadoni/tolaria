// LCI — white cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { BAT_TOKEN } from "../../sharedTokens";

// TODO(issue #676 stub — the Explore blocker is GONE: CR 701.44 shipped as
// the `explore` Effect Op and the Map token as `MAP_TOKEN_SPEC`
// (abilities/tokens/mapToken.ts) in issue #2376, which deliberately scoped
// itself to Sentinel of the Nameless City. What is left is the CARD, not the
// mechanic: verify the printed cost against Scryfall (the line below is an
// unverified stub) and author "Destroy target creature, planeswalker, or
// battle. Its controller creates two Map tokens." as `destroy` +
// `createMapTokenOp({ controllerOf: { target: 0 } }, 2)`. Tracked stub.
// export const getLost: CardDefinition = {
//     id: "522aa72b-2b8c-484c-872b-f082101cee35",
//     name: "Get Lost",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Instant"],
// };

// Sanguine Evangelist — {2}{W} Creature — Vampire Cleric 2/1 (LCI, issue
// #3222, parent PRD #1525). "Battle cry. When this creature enters or dies,
// create a 1/1 black Bat creature token with flying."
//
// The card that earned Battle cry (CR 702.91) its implementation. Both lines
// are declarative:
//
// 1. `staticAbilities: ["battle cry"]` is the WHOLE keyword. The CR 702.91a
//    triggered ability is injected at the `getDefinition` seam by
//    `expandKeywordTriggers` (`abilities/keywordTriggers.ts`, the exalted /
//    prowess mechanism, ADR 0054), so the printed keyword and the enforcing
//    trigger can never come apart. The card names it once and says nothing
//    else about it.
// 2. ONE Oracle line spanning two engine events (CR 603.2) => ONE
//    `TriggeredAbility` with an array `event` and a discriminating `matches`,
//    the Sentinel of the Nameless City shape (`lci/green.ts`). Two abilities
//    would put two triggers on the stack off one printed line. The dies half
//    reads the death event's own `creatureInstanceId` rather than rescanning
//    the battlefield for the source, which by then has left it (CR 603.10 /
//    113.7a last-known information); the body creates a token and never
//    inspects the dead object, which is what keeps the array-`event` shape
//    (no `$event` reachable from a script) usable here.
//
// The Bat is the shared `BAT_TOKEN` spec (`sharedTokens.ts`), so every Bat in
// the game is one synthesized token definition with one art and one client
// rehydration path.
//
// The Oracle compiler's grammar v0 has no rule for a two-event trigger head
// nor for token creation, so Guard C is satisfied by declaring the fragment
// rather than by a round trip (PRD #2693).
// compiler-gap: "When this creature enters or dies, create a 1/1 black Bat creature token with flying." (#2693)
export const sanguineEvangelist: CardDefinition = {
    id: "269ddd84-fdc4-4c94-b183-32ecec56967c",
    name: "Sanguine Evangelist",
    rarity: "uncommon",
    oracleText:
        "Battle cry (Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.)\nWhen this creature enters or dies, create a 1/1 black Bat creature token with flying.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Vampire", "Cleric"],
    power: 2,
    toughness: 1,
    staticAbilities: ["battle cry"],
    triggeredAbilities: [
        {
            id: "sanguine-evangelist-bat",
            oracleText:
                "When this creature enters or dies, create a 1/1 black Bat creature token with flying.",
            event: ["PERMANENT_ENTERED", "CREATURE_DIED"],
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "CREATURE_DIED" &&
                    event.creatureInstanceId === self.id),
            effects: [
                {
                    op: "createToken",
                    token: BAT_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        },
    ],
};
