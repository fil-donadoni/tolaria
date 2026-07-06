// plc — black cards (ADR 0043 colour split).
import type { CardDefinition, SpellContext } from "../../types";

// Damnation — {2}{B}{B} Sorcery. "Destroy all creatures. They can't be
// regenerated." (CR 701.8 destroy; CR 701.15c "can't be regenerated" is a
// rider on the destroy event, not a static replacement — the regeneration
// shield check itself is skipped entirely rather than being intercepted and
// undone.)
//
// NOT DSL-migratable (ADR 0045, issue #831 precedent — Wrath of God is the
// first occurrence of this exact shape): the `destroy` Op has no
// "can't be regenerated" option, so a `forEach`/`destroy` sweep would let a
// regeneration shield save a creature (unlike this card). This is the SECOND
// occurrence of the identical gap — the fix is the existing shared primitive
// `SpellContext.destroyAll`, not a new one (`convex/cards/types.ts` already
// names Damnation in `destroyAll`'s own doc comment as the second consumer).
// Blocked on: a `cantBeRegenerated` option on the `destroy` Op.
export const damnation: CardDefinition = {
    id: "26c68473-70ca-40ba-b5c6-71ec30f88a2c",
    name: "Damnation",
    rarity: "rare",
    oracleText: "Destroy all creatures. They can't be regenerated.",
    manaCost: { X: 2, B: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll("Creature", { cantBeRegenerated: true });
    },
};
