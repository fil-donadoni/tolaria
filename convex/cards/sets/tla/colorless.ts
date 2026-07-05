// TLA — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    ActivatedAbilityContext,
    CardDefinition,
} from "../../../../convex/cards/types";
// `hasSupertypeLive` (CR 205.4a) reads the Basic SUPERTYPE, not a basic land
// SUBTYPE — the two diverge for nonbasic lands that carry a basic land type
// without the supertype (the ABUR duals built by `makeDualLand`,
// `sets/lea/colorless.ts`: Tundra has subtype "Plains" but is NOT Basic).
// "You control a basic land" (CR 305.6) means the Basic supertype, so a
// subtype check falsely returns true for a lone Tundra. `snowReads.ts`
// imports ONLY the cycle-free `supertypeLookup` accessor (a type import plus
// a registry-injected function, no runtime edge back into `index.ts`), so
// it's safe for a set module to value-import — unlike `attackRestrictions.ts`'s
// `hasSupertype` (which imports `tryGetDefinition` from `.` and would close a
// cycle THROUGH the registry itself, since index.ts eagerly imports every set
// module including this one).
import { hasSupertypeLive } from "../../snowReads";

// Abandoned Air Temple — Land (issue #681, Cube FREE +1/+1 counters). "This
// land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W},
// {T}: Put a +1/+1 counter on each creature you control." (CR 614.1c
// self-conditional tapped-entry via `entersTappedUnless`; CR 605.1a mana
// ability; CR 122 mass counter placement via `forEach`.)
export const abandonedAirTemple: CardDefinition = {
    id: "9c0433f9-8f1e-4a19-a83f-a41925f1b1a9",
    name: "Abandoned Air Temple",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1 counter on each creature you control.",
    types: ["Land"],
    entersTappedUnless: (view, controllerId) => {
        const own = view.players.find((p) => p.id === controllerId);
        return (own?.battlefield ?? []).some(
            (p) => p.types.includes("Land") && hasSupertypeLive(p, "Basic")
        );
    },
    activatedAbilities: [
        {
            id: "abandoned-air-temple-mana",
            oracleText: "{T}: Add {W}.",
            cost: { tap: true },
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 1 });
            },
            useStack: false,
            // Fixed single-colour output (mirrors Strip Mine's `{ C: 1 }`,
            // `sets/atq/colorless.ts`) — the auto-tap payment system
            // (`getFixedManaAmount`, `commitLandsForCost`) reads this
            // metadata to know the land covers a {W} cost; without it the
            // land would be invisible to auto-tap despite `effect` correctly
            // adding the mana on manual activation.
            manaProduced: { W: 1 },
        },
        {
            id: "abandoned-air-temple-counters",
            oracleText:
                "{3}{W}, {T}: Put a +1/+1 counter on each creature you control.",
            cost: { mana: { X: 3, W: 1 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$each" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
};
