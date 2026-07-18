// DST — colorless cards, split by colour per ADR 0043. The registry's
// `import * as dst from "./sets/dst"` resolves through dst/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Skullclamp — "Equipped creature gets +1/-1.\nWhenever equipped creature
// dies, draw two cards.\nEquip {1}." (issue #1306, parent PRD #620.) New
// home set (DST, Darksteel — the true first paper printing) — first stub
// registered here. The static +1/-1 (layer 7c, `AURA_AFFECTS_HOST`) and the
// plain Equip {1} ability (the generic `attach` Op, ADR 0065 — see Lion
// Sash, `neo/white.ts`, for the identical `{ op: "attach", target: {
// target: 0 } }` shell) are BOTH cleanly expressible with the Equipment
// attach machinery that shipped via #1311. STOP-AND-ISSUE on the THIRD
// clause: "whenever equipped creature dies, draw two cards" needs
// last-known information from the EQUIPMENT's perspective — which
// permanents were attached to the creature that just died — and that
// snapshot field does not exist yet. `LeavingPermanent` (`convex/cards/
// abilities/triggers/leftTrigger.ts`) only carries `attachedToBeforeLeave`
// (the LEAVING object's own host — the reverse direction, used by Animate
// Dead), never the set of things that WERE attached TO it. ADR 0065
// documents the missing field by name (`attachmentsBeforeLeave:
// string[]`) and scopes it to #1350 ([engine] #776b Equipped-creature-dies
// last-known + Skullclamp), which explicitly ships Skullclamp as its own
// tracer once the field lands. Never ship a silent partial (CLAUDE.md) —
// shipping only the static+Equip third would misrepresent the card's
// headline effect. Stop-and-issue per gre-development.md; tracked-by: #1350
// export const skullclamp: CardDefinition = {
//     id: "55318397-de3c-47ea-a088-72a24df5c8fa",
//     name: "Skullclamp",
//     rarity: "rare",
//     manaCost: { X: 1 },
//     types: ["Artifact"],
//     subtypes: ["Equipment"],
// };

export {};
