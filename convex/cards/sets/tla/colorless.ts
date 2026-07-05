// TLA — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type {
    ActivatedAbilityContext,
    CardDefinition,
} from "../../../../convex/cards/types";
import { ATTACK_RESTRICTION_CTX } from "../../attackRestrictions";

// Abandoned Air Temple — Land (issue #681, Cube FREE +1/+1 counters). "This
// land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W},
// {T}: Put a +1/+1 counter on each creature you control." (CR 614.1c
// self-conditional tapped-entry via `entersTappedUnless`, reusing the shared
// frontend-safe `ATTACK_RESTRICTION_CTX.hasSupertype` predicate — same
// embedded-then-`tryGetDefinition`-fallback shape the fast-land cycle uses;
// CR 605.1a mana ability; CR 122 mass counter placement via `forEach`.)
export const abandonedAirTemple: CardDefinition = {
    id: "9c0433f9-8f1e-4a19-a83f-a41925f1b1a9",
    name: "Abandoned Air Temple",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1 counter on each creature you control.",
    types: ["Land"],
    entersTappedUnless: (view, controllerId) => {
        const own = view.players.find((p) => p.id === controllerId);
        return (own?.battlefield ?? []).some((p) =>
            ATTACK_RESTRICTION_CTX.hasSupertype(p, "Basic")
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
