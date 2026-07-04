// exo (Exodus) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext } from "../../types";

// City of Traitors — "When you play another land, sacrifice this land.
// {T}: Add {C}{C}." (CR 603.2 triggered ability, CR 701.16 sacrifice.) The
// trigger's `resolve()` calls `ctx.sacrifice(ctx.sourceInstanceId)` directly:
// the `sacrifice` Op's `permanents` field only accepts a `choice`-bound picks
// LIST (the shape a `{op:"choice", ...}` step produces), not the `$source`
// snapshot binding (a `[power, toughness, controller, id]` tuple shaped for
// property-style refs like `$source.power`, not a picks array) — so there is
// no Op-vocabulary path to "sacrifice this permanent" without a prior choice.
// `resolve()` calling the primitive directly mirrors how every manland's
// animate ability already does the same for `animateAsCreature` (not yet
// Op-wrapped either). Vintage Cube free tranche (issue #675, ADR 0041).
export const cityOfTraitors: CardDefinition = {
    id: "a7a8b6b8-b95f-4014-b17a-a6d44d965995",
    rarity: "rare",
    name: "City of Traitors",
    oracleText:
        "When you play another land, sacrifice this land.\n{T}: Add {C}{C}.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "city-of-traitors-mana",
            oracleText: "{T}: Add {C}{C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 2 }),
            manaProduced: { C: 2 },
        },
    ],
    triggeredAbilities: [
        {
            id: "city-of-traitors-sac",
            oracleText: "When you play another land, sacrifice this land.",
            event: "PERMANENT_ENTERED",
            matches: (event, self) => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                return (
                    event.controllerId === self.controllerId &&
                    event.types.includes("Land") &&
                    event.instanceId !== self.id
                );
            },
            resolve: (ctx: SpellContext) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        },
    ],
};
