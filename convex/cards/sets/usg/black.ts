// usg — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Exhume — {1}{B} Sorcery. "Each player puts a creature card from their
// graveyard onto the battlefield." (CR 400.7 reanimation, CR 101.4 APNAP
// order.) The Innocent Blood pattern (forEach players + a per-player choice,
// ADR 0045 issue #807): each player picks their OWN creature card via
// `choose-graveyard-card` (chooser = zone owner = `$each`), then the
// `moveZone` cards-shape's `from: "graveyard"` source (issue #680) puts it
// onto the battlefield under that SAME player's control (the default —
// "each player… onto the battlefield" needs no controller override). A
// player with no creature cards in their graveyard is skipped entirely (CR
// 608.2b — the choice clamps to zero candidates).
export const exhume: CardDefinition = {
    id: "a88b23ce-ce19-47da-b9f2-055a4d6bdc79",
    name: "Exhume",
    rarity: "common",
    oracleText:
        "Each player puts a creature card from their graveyard onto the battlefield.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: { ref: "$each" },
                    zone: "graveyard",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Exhume: put a creature card from your graveyard onto the battlefield.",
                    bind: "$exhumed",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$exhumed" },
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Duress — {B} Sorcery (Vintage Cube FREE: edict/discard/hand disruption,
// issue #682). "Target opponent reveals their hand. You choose a
// noncreature, nonland card from it. That player discards that card." (CR
// 701.20a reveal, CR 701.9 discard.) Same `reveal` + `choice(zoneOwnerId)`
// template as Thoughtseize (`convex/cards/sets/lrw/black.ts`), with
// `targetRequirement.controller: "opponent"` (CR 115 — a real spell-level
// target, unlike a `TriggeredAbility`'s `"opponent"` ref shortcut) and a
// two-member `excludeType` array ("noncreature, nonland" — issue #682).
export const duress: CardDefinition = {
    id: "ca367f49-0f4a-4b7f-8104-851893fbcd8a",
    name: "Duress",
    rarity: "common",
    oracleText:
        "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    effects: [
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "hand",
            filter: { excludeType: ["Land", "Creature"] },
            count: 1,
            prompt: "Choose a noncreature, nonland card from that player's hand.",
            bind: "$picked",
        },
        {
            op: "discard",
            player: { target: 0 },
            cards: { ref: "$picked" },
        },
    ],
};

// STOP-AND-ISSUE (tracked-by: #1149) — Yawgmoth's Will: "Until end of turn,
// you may play lands and cast spells from your graveyard. If a card would be
// put into your graveyard from anywhere this turn, exile that card instead."
// Two distinct capabilities were needed (never ship partial); #1145 has
// SHIPPED capability (2): the `"graveyard-bound"` `ReplacementEventKind` +
// apply-loop hook (`gre/replacements.ts::applyGraveyardBoundReplacements`),
// including the TURN-SCOPED shape this exact clause needs
// (`SpellContext.armGraveyardRedirectThisTurn` +
// `state.graveyardBoundRedirectThisTurn`, cleared at CLEANUP — see
// `gre/__tests__/graveyardBoundReplacement.test.ts`). Still missing:
// capability (1), a BROAD, turn-scoped graveyard-cast/land-play permission
// over the caster's own graveyard — no primitive/Op exists (flashback's
// `grantedFlashback` is per-instance, spells-only; tracked-by #1149). Once
// #1149 ships, this card composes the two: `armGraveyardRedirectThisTurn`
// (already available) + #1149's cast/land-play grant. Vintage Cube FREE
// tranche, issue #686.
// export const yawgmothsWill: CardDefinition = {
//     id: "6d3e3c3a-d351-4d91-8884-312d4b6f540d", // USG 171
//     name: "Yawgmoth's Will",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1 },
//     types: ["Sorcery"],
// };
