// TMP — blue cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// Reprint-only entries: each CardPrint declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> the shared CardDefinition
// (ADR 0014).

import type { CardDefinition, CardPrint } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";

// Time Warp — {3}{U}{U} Sorcery. "Target player takes an extra turn after
// this one." (CR 500.7, Vintage Cube FREE tranche, issue #686.) DSL-first
// (ADR 0045): the `extraTurn` Op (mechanicsRegistry.ts) is a thin declarative
// skin over `SpellContext.takeExtraTurn` — the SAME primitive Time Walk's
// pre-DSL `resolve()` closure already calls (lea/blue.ts) — added as part of
// this card (no new engine capability, only the Op wrapper the primitive-reuse
// mandate calls for). `targetRequirement` is a single player (CR 601.2c);
// the announced slot feeds the Op's `player: { target: 0 }`.
export const timeWarp: CardDefinition = {
    id: "3447aeaf-3b26-442a-99d4-0a7ee76c8e76", // TMP 97
    rarity: "rare",
    name: "Time Warp",
    oracleText: "Target player takes an extra turn after this one.",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "extraTurn", player: { target: 0 } }],
};

// Counterspell — Premodern-legal reprint (Tempest, #980). Resolves to the LEA
// CardDefinition; the printId is the TMP per-print Scryfall UUID.
export const counterspellTmp: CardPrint = {
    printId: "dacdd380-71cf-4832-bd02-3697501325f3",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "tmp",
    rarity: "common",
};

// Shimmering Wings — {U} Enchantment — Aura, enchant creature. "Enchanted
// creature has flying. {U}: Return this Aura to its owner's hand." (CR 702.9
// continuous keyword grant via `keyword-grant` + `AURA_AFFECTS_HOST`, and the
// shipped self-bounce activated-ability template — ice/black.ts Leshrac's
// Sigil: "{cost}: Return this enchantment to its owner's hand".)
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/blue.ts`.
export const shimmeringWings: CardDefinition = {
    id: "a6a8dc46-04c7-479a-90c1-b55e6c67e0e3", // TMP 87
    name: "Shimmering Wings",
    rarity: "common",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nEnchanted creature has flying. (It can't be blocked except by creatures with flying or reach.)\n{U}: Return this Aura to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    activatedAbilities: [
        {
            id: "shimmering-wings-return",
            oracleText: "{U}: Return this Aura to its owner's hand.",
            cost: { mana: { U: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};

// Intuition — {2}{U} Instant. "Search your library for three cards and reveal
// them. Target opponent chooses one. Put that card into your hand and the rest
// into your graveyard. Then shuffle."
//
// The card the `choice` Op's two shipped capabilities could not be combined
// for until issue #3205: `candidates` (a set named ahead of the pick) was
// battlefield-only, because for every other zone "nothing in them can be named
// ahead of the pick". CR 400.2 is why that rule is right in general — a
// library is a hidden zone "even if all the cards in one such zone happen to be
// revealed" — and CR 701.20a is why THIS shape is the exception: the reveal
// shows the three cards to all players and they "remain revealed for as long as
// necessary to complete the parts of the effect that card is relevant to", so
// the opponent can only choose because the set is already public. The new
// `kind: "choose-library-card"` is that exception, and the validator refuses it
// unless a preceding `reveal { cards: { ref } }` in this same op list made the
// very binding it picks from public.
//
// Composition, all shipped parts:
//  1. `choice` (search-library) over the CONTROLLER's own library, count 3.
//     CR 701.23d — a QUANTITY search: "that player must find that many cards
//     (or as many as possible, if the zone doesn't contain enough cards)", which
//     is exactly the interpreter's `Math.min(op.count, available)` clamp. A
//     library of two yields a two-card pick, not a failed spell; an EMPTY
//     library still raises the search (the no-hit branch) so the look happens.
//  2. `reveal` of that binding — CR 701.20a, `markKnownToAll`, and knowledge in
//     this engine is monotonic (ADR 0026), so nothing has to un-reveal them.
//  3. `choice` (choose-library-card) raised to the TARGET OPPONENT
//     (`player: { target: 0 }`) over the CONTROLLER's library
//     (`zoneOwnerId: "controller"`) — the chooser/zone-owner split
//     `zoneOwnerId` already models (Leshrac's Sigil, Demonic Hordes), narrowed
//     to the revealed three. The projection exposes exactly those three cards
//     to that opponent through `libraryPeek`, never the rest of the library.
//  4. `moveZone` of the pick, library -> hand.
//  5. `moveZone` of the WHOLE `$found` binding, library -> graveyard. No
//     "bind the rest" construct is needed: step 4 already took the picked card
//     out of the library, and `moveCardById` no-ops on a card that is not in
//     the source zone, so this moves precisely "the rest".
//  6. `libraryLook` shuffle — CR 701.24.
//
// CR 608.2b — the single target is the opponent, so if that player is somehow
// gone at resolution the spell has no legal target left, does not resolve and
// is put into its owner's graveyard: no search, no reveal, no shuffle. Nothing
// is encoded for it here because that is the stack's job, not the script's.
//
// compiler-gap: "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle." (#2693)
// The ENGINE capability is what this issue built; teaching the grammar to read
// a four-clause search/reveal/foreign-choose/split-destination sentence is the
// Oracle-compiler PRD's own scope, not this one's.
export const intuition: CardDefinition = {
    id: "c99f6785-e5a1-4fdc-9fb5-e1a372e7e848",
    rarity: "rare",
    name: "Intuition",
    oracleText:
        "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.",
    manaCost: { U: 1, generic: 2 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    effects: [
        {
            op: "choice",
            kind: "search-library",
            player: "controller",
            zone: "library",
            count: 3,
            prompt: "Search your library for three cards.",
            bind: "$found",
        },
        { op: "reveal", player: "controller", cards: { ref: "$found" } },
        {
            op: "choice",
            kind: "choose-library-card",
            player: { target: 0 },
            zoneOwnerId: "controller",
            zone: "library",
            candidates: [{ ref: "$found" }],
            count: 1,
            prompt: "Choose one of the revealed cards. Its owner puts that card into their hand and the rest into their graveyard.",
            bind: "$kept",
        },
        {
            op: "moveZone",
            cards: { ref: "$kept" },
            player: "controller",
            from: "library",
            to: "hand",
        },
        {
            op: "moveZone",
            cards: { ref: "$found" },
            player: "controller",
            from: "library",
            to: "graveyard",
        },
        { op: "libraryLook", action: "shuffle", player: "controller" },
    ],
};
