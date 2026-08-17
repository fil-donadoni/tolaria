// one — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Sheoldred's Edict — {1}{B} Instant (Vintage Cube FREE: edict/discard/hand
// disruption, issue #682). "Choose one — • Each opponent sacrifices a
// nontoken creature of their choice. • Each opponent sacrifices a creature
// token of their choice. • Each opponent sacrifices a planeswalker of their
// choice." (CR 700.2 modal, CR 701.21 sacrifice.)
//
// Modes are locked at CAST, not at resolution (CR 601.2b–c / 700.2c, issue
// #1274): the card rides the cast-time `modes` framework, so the mode is
// announced BEFORE the spell goes on the stack and the opponent responds with
// full information. (It previously used the resolution-time `optionChoice` Op
// — legal-looking but a hidden-mode spell on the stack, the Vision Charm bug.)
// No mode takes a target (CR 700.2d): each is the `choice(sacrifice-permanents)`
// + `sacrifice` Innocent Blood pattern, the sacrificing player choosing at
// resolution (CR 608.2 — "of their choice" is not a target). "Each opponent"
// resolves directly to `"opponent"` (2-player-only scope, no `forEach` needed —
// Syphon Soul precedent, `convex/cards/sets/leg/black.ts`). The nontoken/token
// split is the `isToken` filter field (issue #920).
export const sheoldredsEdict: CardDefinition = {
    id: "a9225cc3-90f0-448f-a8d9-7c6c2796d077",
    name: "Sheoldred's Edict",
    rarity: "uncommon",
    oracleText:
        "Choose one —\n• Each opponent sacrifices a nontoken creature of their choice.\n• Each opponent sacrifices a creature token of their choice.\n• Each opponent sacrifices a planeswalker of their choice.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "nontoken-creature",
            label: "Each opponent sacrifices a nontoken creature",
            oracleText:
                "Each opponent sacrifices a nontoken creature of their choice.",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: { type: "Creature", isToken: false },
                    count: 1,
                    prompt: "Sacrifice a nontoken creature of your choice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
        {
            id: "creature-token",
            label: "Each opponent sacrifices a creature token",
            oracleText:
                "Each opponent sacrifices a creature token of their choice.",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: { type: "Creature", isToken: true },
                    count: 1,
                    prompt: "Sacrifice a creature token of your choice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
        {
            id: "planeswalker",
            label: "Each opponent sacrifices a planeswalker",
            oracleText:
                "Each opponent sacrifices a planeswalker of their choice.",
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: "opponent",
                    zone: "battlefield",
                    filter: { type: "Planeswalker" },
                    count: 1,
                    prompt: "Sacrifice a planeswalker of your choice.",
                    bind: "$sac",
                },
                { op: "sacrifice", permanents: { ref: "$sac" } },
            ],
        },
    ],
};
