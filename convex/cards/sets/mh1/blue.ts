// mh1 — blue cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Echo of Eons — {4}{U}{U} Sorcery. "Each player shuffles their hand and
// graveyard into their library, then draws seven cards." with Flashback {2}{U}
// (CR 702.34 — cast from the graveyard for the flashback cost, then exile it).
// This is Timetwister (CR 103.4 whole-table hand/graveyard reset) with a
// flashback back-half, and the marquee flashback play: pitch it, then flash it
// back for a two-mana Timetwister. Echo of Eons is on the stack while it
// resolves, so the graveyard shuffle doesn't sweep it; after resolution the
// flashback rider exiles it (exileOnResolve).
//
// Migrated resolve()→effects[] (ADR 0045, issue #1279): the `moveZone` Op's
// THIRD (whole-zone bulk) shape now moves a player's ENTIRE hand/graveyard to
// their library with no selection, a thin skin over `ctx.moveZone`. Identical
// body to lea/2ed Timetwister's migrated `effects[]` (same composed Ops, no
// new primitive) — `flashback` is an orthogonal cost-shape field, unaffected
// by the resolve()→effects[] migration.
export const echoOfEons: CardDefinition = {
    id: "ff590af2-2d6c-4f16-a9b8-1a6dab6e9ad5",
    rarity: "mythic",
    name: "Echo of Eons",
    oracleText:
        "Each player shuffles their hand and graveyard into their library, then draws seven cards.\nFlashback {2}{U}",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    flashback: { X: 2, U: 1 },
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "hand",
                    to: "library",
                },
                {
                    op: "moveZone",
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "library",
                },
                {
                    op: "libraryLook",
                    action: "shuffle",
                    player: { ref: "$each" },
                },
                { op: "draw", player: { ref: "$each" }, count: 7 },
            ],
        },
    ],
};

// Force of Negation — {1}{U}{U} Instant. "If it's not your turn, you may exile a
// blue card from your hand rather than pay this spell's mana cost. Counter
// target noncreature spell. If that spell is countered this way, exile it
// instead of putting it into its owner's graveyard." (CR 118.9 alternative pitch
// cost — exile a blue card from hand, gated on not-your-turn; CR 701.5a counter;
// CR 114.1 noncreature spell target; CR 701.5a counter-to-exile.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `handCost.action: "exile"` leg with `condition: not-your-turn`. The
// "noncreature spell" restriction rides `spellExcludeTypeFilter: "Creature"` on
// the spell target (the Spell Pierce shape); the "exile it instead" rider is the
// already-censused `counter` Op's `destination: "exile"` (No More Lies /
// Memory Lapse family) — no new Op or TargetRequirement type (ADR 0045).
export const forceOfNegation: CardDefinition = {
    id: "e9be371c-c688-44ad-ab71-bd4c9f242d58", // MH1 52
    rarity: "rare",
    name: "Force of Negation",
    oracleText:
        "If it's not your turn, you may exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    manaCost: { X: 1, U: 2 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellExcludeTypeFilter: "Creature",
    },
    alternativeCosts: [
        {
            id: "pitch-exile-blue",
            description: "Exile a blue card from your hand",
            condition: { kind: "not-your-turn" },
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "U" }, count: 1 }],
            },
        },
    ],
    effects: [{ op: "counter", target: { target: 0 }, destination: "exile" }],
};
