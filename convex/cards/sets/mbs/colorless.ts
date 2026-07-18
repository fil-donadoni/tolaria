// MBS — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mbs from "./sets/mbs"` resolves through mbs/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    CardDefinition,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";

const BLIGHTSTEEL_COLOSSUS_ID = "7928bb14-7631-4830-a756-26d1ea832ba2";

// Blightsteel Colossus — {12} Artifact Creature — Phyrexian Golem, 11/11
// (issue #1201, split from #699 — Vintage Cube PRD #620). "Trample, infect,
// indestructible\nIf Blightsteel Colossus would be put into a graveyard from
// anywhere, reveal Blightsteel Colossus and shuffle it into its owner's
// library instead." (CR 702.19 trample, CR 702.90 infect, CR 702.12b
// indestructible, CR 701.24 shuffle a card into a library.)
//
// The graveyard-avoidance clause is implemented as a "from anywhere"
// self-trigger, the SAME established pattern as Worldspine Wurm
// (rtr/green.ts) for the identical effect shape ("When ~ is put into a
// graveyard from anywhere, shuffle it into its owner's library") rather than
// a true CR 614 replacement: the engine's `"graveyard-bound"` replacement
// hook (`gre/replacements.ts`) is permanent-BOUND (`collectReplacements`
// only scans cards currently ON a battlefield), which cannot express a
// self-referential "from anywhere" replacement that must also catch the
// card being milled straight from the library or discarded from hand —
// neither of which has the source on a battlefield to carry the effect. The
// broader `zone: "graveyard"` trigger scan (Nether Shadow's precedent) DOES
// reach a hand/library origin, so it is the only existing engine path that
// covers the full "from anywhere" text; Worldspine Wurm already established
// trigger-based modeling as the accepted simplification for this exact
// shape. Divergence: "would be put ... instead" (a true replacement, the
// card never touches the graveyard) is modeled as "is put ... then moves"
// (a real but instantaneous graveyard visit) — DIVERGENCE, out of scope: no
// card in the pool reacts to that momentary graveyard presence (a
// graveyard-hate exile-in-response effect), and the engine's graveyard zone
// is fully public to both players anyway (gameProjections.ts), so the
// visit's only theoretical externally-observable difference is unobservable
// here. The "reveal" clause is likewise DIVERGENCE, out of scope: the `reveal`
// Op (CR 701.20, mechanicsRegistry.ts) only covers a whole-hand reveal or a
// preceding search-library `choice`'s picks, not an arbitrary single
// already-known instance — and reveal has zero engine-observable effect
// regardless, since the graveyard zone (where this trigger fires from) is
// already public to both players before the shuffle.
function blightsteelColossusShuffleFromGraveyard(): TriggeredAbility {
    return {
        id: "blightsteel-colossus-shuffle",
        oracleText:
            "If Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
        event: ["CREATURE_DIED", "CARD_DISCARDED", "CARD_MILLED"],
        // CR 603.6e — functions from the graveyard: the graveyard trigger
        // scan (`collectTriggers`) matches every card CURRENTLY SITTING in a
        // graveyard against every event in the batch — the only path that
        // also catches a hand/library origin (no live battlefield permanent
        // to scan for those). Same shape as Worldspine Wurm's identical
        // clause (rtr/green.ts).
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
                bind: "$blightsteel",
            },
            {
                op: "libraryLook",
                action: "shuffle",
                player: { ref: "$blightsteel.owner" },
            },
        ],
    };
}

export const blightsteelColossus: CardDefinition = {
    id: BLIGHTSTEEL_COLOSSUS_ID,
    rarity: "mythic",
    name: "Blightsteel Colossus",
    oracleText:
        "Trample, infect, indestructible\nIf Blightsteel Colossus would be put into a graveyard from anywhere, reveal Blightsteel Colossus and shuffle it into its owner's library instead.",
    manaCost: { generic: 12 },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Golem"],
    power: 11,
    toughness: 11,
    staticAbilities: ["trample", "infect", "indestructible"],
    triggeredAbilities: [blightsteelColossusShuffleFromGraveyard()],
};
