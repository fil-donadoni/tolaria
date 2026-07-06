// rav — blue cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Remand — {1}{U} Instant. "Counter target spell. If that spell is countered
// this way, put it into its owner's hand instead of into that player's
// graveyard. Draw a card." (CR 701.5a counter, the new `destination`
// parameter on `SpellContext.counter` — issue #683's "put it into its
// owner's hand" redirect clause, followed by an unconditional draw.) An
// unconditional counter + draw — no mayPay/if — so the effect is two Ops in
// sequence.
export const remand: CardDefinition = {
    id: "a5048047-abff-4a1f-8d72-6b758a03542c",
    rarity: "uncommon",
    name: "Remand",
    oracleText:
        "Counter target spell. If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard.\nDraw a card.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "counter",
            target: { target: 0 },
            destination: "hand",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
