// RTR — green cards, split by colour per ADR 0043. The registry's
// `import * as rtr from "./sets/rtr"` resolves through rtr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";

const WORLDSPINE_WURM_ID = "543d55cb-3a6b-4620-af25-10ae74ed32c4";

// Worldspine Wurm — {8}{G}{G}{G} Creature — Wurm, 15/15 (issue #1307 residue,
// Cube FREE big green). "Trample\nWhen this creature dies, create three 5/5
// green Wurm creature tokens with trample.\nWhen Worldspine Wurm is put into
// a graveyard from anywhere, shuffle it into its owner's library." (CR
// 702.19 trample, CR 603.2 dies-trigger, CR 111 tokens, CR 701.24 shuffle a
// card into a library.)
//
// Two independent triggers (both DSL-first, already interpreter-exercised
// Ops — per-Op regime, ADR 0046, no hand-written test required):
//
// 1. "Dies" (CR 603.2, battlefield → graveyard only) — the standard
//    self-referential dies-trigger shape (Haywire Mite bro/colorless.ts,
//    Riptide Crab bro/colorless.ts, Torsten dmc/multicolor.ts): a plain
//    `event: "CREATURE_DIED"` entry (no `zone` — the default battlefield
//    scan, matched via `self.id === event.creatureInstanceId`), body =
//    `createToken` ×3.
//
// 2. "Put into a graveyard from ANYWHERE" is broader than "dies" (CR 400.7 —
//    covers a card entering the graveyard from hand/library/exile/stack too,
//    not just the battlefield). The default battlefield trigger scan
//    (`collectTriggers`, gre/triggers.ts) only ever finds a source via
//    `player.battlefield` or a same-batch CREATURE_DIED/PERMANENT_LEFT id —
//    it never sees a card that moved straight from hand or library. The
//    engine's OTHER trigger-collection path — `zone: "graveyard"` — scans
//    every card CURRENTLY SITTING in a graveyard against every event in the
//    batch (Nether Shadow's precedent), which is exactly the right shape
//    for a "from anywhere" self-trigger: ONE ability entry listening on all
//    three zone-change events the engine emits (`event: "CREATURE_DIED"` +
//    `events: ["CARD_DISCARDED", "CARD_MILLED"]`, the multi-event field —
//    CR 603.2), `zone: "graveyard"` + matched on the specific instance id
//    per firing event. One Oracle line, shown once on the stack / inspector
//    instead of three near-duplicates. This covers battlefield, hand, and
//    library origins — CR 701.17 mill is implemented
//    (mechanicsRegistry.ts `mill` — status "implemented"), so CARD_MILLED is
//    included, unlike the older Moonshadow precedent (ecl/black.ts) which
//    predates mill shipping. NOT covered: a spell countered on the stack
//    going straight to the graveyard (stack → graveyard has no matching
//    event in the engine's vocabulary) — out of scope, a rare edge case for
//    a creature spell with no other stack-interaction hooks.
//
// The shuffle-into-library body composes two already-shipped Ops instead of
// the scoped-to-spell-resolution `shuffleSelfIntoLibrary` Op (which is
// explicitly documented as a no-op "for an ability" — mechanicsRegistry.ts —
// so it CANNOT be used from a triggered ability's effects): `moveZone`
// (graveyard-card → library, `bind`-snapshotting the OWNER — issue #1106,
// the Recoil precedent, inv/multicolor.ts, since the oracle text says
// "owner's" and NOT "your" library, and a creature that died under a
// non-owner's control per CR 400.7/108.4 still goes to its OWNER's pile) +
// `libraryLook`(shuffle) on that snapshotted owner — moving a card to a
// library then shuffling the whole library IS the CR-701.24 "shuffle a card
// into a library" idiom (no separate primitive needed).
function worldspineWurmDiesCreateTokens(): TriggeredAbility {
    return {
        id: "worldspine-wurm-dies-tokens",
        oracleText:
            "When this creature dies, create three 5/5 green Wurm creature tokens with trample.",
        event: "CREATURE_DIED",
        matches: (event: GameEvent, self: PermanentView): boolean =>
            event.type === "CREATURE_DIED" &&
            event.creatureInstanceId === self.id,
        effects: [
            {
                op: "createToken",
                token: {
                    name: "Wurm",
                    types: ["Creature"],
                    subtypes: ["Wurm"],
                    power: 5,
                    toughness: 5,
                    colors: ["G"],
                    staticAbilities: ["trample"],
                    // Token print associated with Worldspine Wurm's own
                    // printing (Scryfall all_parts reverse-link, tdsc — the
                    // Duskmourn Commander deck Worldspine Wurm ships in),
                    // per the token-art matching convention (prefer the
                    // card's own printing where present).
                    imagePrintId: "54d5e60d-559d-49e0-a65e-80db721b142a",
                },
                controller: "controller",
                count: 3,
            },
        ],
    };
}

function worldspineWurmShuffleFromGraveyard(): TriggeredAbility {
    return {
        id: "worldspine-wurm-shuffle",
        oracleText:
            "When Worldspine Wurm is put into a graveyard from anywhere, shuffle it into its owner's library.",
        // "From anywhere" = one Oracle line spanning three engine events
        // (battlefield death / discard / mill). ONE ability listening on all
        // three (`event` + `events[]`), so the line is shown once — not three
        // near-duplicate entries (CR 603.2).
        event: "CREATURE_DIED",
        events: ["CARD_DISCARDED", "CARD_MILLED"],
        // CR 603.6e — functions from the graveyard: scanned by
        // `collectTriggers`'s graveyard pass (every card currently sitting in
        // a graveyard, matched against every event in the batch), which is
        // the only path that also catches a hand/library origin (no live
        // battlefield permanent to scan for those).
        zone: "graveyard",
        matches: (event: GameEvent, self: PermanentView): boolean => {
            if (event.type === "CREATURE_DIED") {
                return event.creatureInstanceId === self.id;
            }
            if (
                event.type === "CARD_DISCARDED" ||
                event.type === "CARD_MILLED"
            ) {
                return event.cardInstanceId === self.id;
            }
            return false;
        },
        effects: [
            {
                op: "moveZone",
                target: { ref: "$source" },
                to: "library",
                bind: "$wurm",
            },
            {
                op: "libraryLook",
                action: "shuffle",
                player: { ref: "$wurm.owner" },
            },
        ],
    };
}

export const worldspineWurm: CardDefinition = {
    id: WORLDSPINE_WURM_ID,
    rarity: "mythic",
    name: "Worldspine Wurm",
    oracleText:
        "Trample\nWhen this creature dies, create three 5/5 green Wurm creature tokens with trample.\nWhen Worldspine Wurm is put into a graveyard from anywhere, shuffle it into its owner's library.",
    manaCost: { X: 8, G: 3 },
    types: ["Creature"],
    subtypes: ["Wurm"],
    power: 15,
    toughness: 15,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        worldspineWurmDiesCreateTokens(),
        worldspineWurmShuffleFromGraveyard(),
    ],
};
