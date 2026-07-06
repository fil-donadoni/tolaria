// ody — blue cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).
import type { CardDefinition } from "../../types";

// Upheaval — {4}{U}{U} Sorcery. "Return all permanents to their owners'
// hands." (CR 400.7 zone change / CR 111.7 a bounced token ceases to exist,
// SBA-enforced.) A `forEach` sweep over EVERY permanent on EVERY battlefield
// (no `controller` scope — "all permanents", not "permanents you control";
// no `filter` — every type, not just creatures) + `moveZone` per member. This
// is the FIRST card to pair `forEach`'s `$each` with `moveZone`'s
// target-shape (`to: "hand"`) — a new construct combination earning its own
// interpreter test (`convex/gre/effects/__tests__/interpreter.test.ts`,
// "forEach + moveZone — mass bounce").
export const upheaval: CardDefinition = {
    id: "9e201229-34a6-48c8-a07c-d8aefcf5f8a7",
    name: "Upheaval",
    rarity: "rare",
    oracleText: "Return all permanents to their owners' hands.",
    manaCost: { X: 4, U: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};
