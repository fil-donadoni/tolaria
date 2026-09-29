// lrw — black cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Thoughtseize — {B} Sorcery (Vintage Cube FREE: edict/discard/hand
// disruption, issue #682). "Target player reveals their hand. You choose a
// nonland card from it. That player discards that card. You lose 2 life."
// (CR 701.20a reveal, CR 701.9 discard.) The canonical `reveal` + `choice`
// template (issue #920, #682): `reveal` stamps the target's hand `knownTo`
// the caster (so the wire projection shows the real cards), then `choice`'s
// `zoneOwnerId` lets the CONTROLLER choose from the TARGET's hand — the
// chooser (`player: "controller"`) and the zone owner (`zoneOwnerId: {
// target: 0 }`) differ, which is exactly what the `zoneOwnerId`
// generalization unblocks. "Nonland card" is the new `excludeType` filter
// field (issue #682, mirrors `TargetRequirement.excludeTypes`).
export const thoughtseize: CardDefinition = {
    id: "3df8c148-e87d-4043-9d8b-ec72bf8b6d5d",
    name: "Thoughtseize",
    rarity: "rare",
    oracleText:
        "Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zoneOwnerId: { target: 0 },
            zone: "hand",
            filter: { excludeType: "Land" },
            count: 1,
            prompt: "Choose a nonland card from that player's hand.",
            bind: "$picked",
        },
        {
            op: "discard",
            player: { target: 0 },
            cards: { ref: "$picked" },
        },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};
