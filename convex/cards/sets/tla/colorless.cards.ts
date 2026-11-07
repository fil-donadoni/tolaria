// TLA — colorless cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import {
    defineCard,
    type ActivatedAbilityContext,
} from "../../../../convex/cards/types";

// Abandoned Air Temple — Land (issue #681, Cube FREE +1/+1 counters). "This
// land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W},
// {T}: Put a +1/+1 counter on each creature you control." (CR 614.1d
// self-conditional tapped-entry via `entersTappedUnlessControls`, "basic" being
// the supertype and never a basic land type, CR 205.4c; CR 605.1a mana ability;
// CR 122 mass counter placement via `forEach`.)
export const abandonedAirTemple = defineCard(() => ({
    id: "9c0433f9-8f1e-4a19-a83f-a41925f1b1a9",
    name: "Abandoned Air Temple",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless you control a basic land.\n{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1 counter on each creature you control.",
    types: ["Land"],
    entersTappedUnlessControls: {
        kind: "controls",
        filter: { types: ["Land"], supertypes: ["Basic"] },
        atLeast: 1,
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
            // `sets/atq/colorless.cards.ts`) — the auto-tap payment system
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
}));

// Ba Sing Se — Land. "This land enters tapped unless you control a basic land.
// {T}: Add {G}. {2}{G}, {T}: Earthbend 2. Activate only as a sorcery." The entry
// clause is the compiled form (CR 614.1d, "basic" the supertype, CR 205.4c).
// Earthbend 2 (CR 701.66a) is the three-Op body Badgermole Cub and Aang ship,
// here on an activated ability with sorcery timing (CR 602.5d); no card in the
// catalogue triggers off earthbending, so CR 701.66b has nothing to wire.
// hand-tail: {2}{G}, {T}: Earthbend 2. Activate only as a sorcery. (#8655)
export const baSingSe = defineCard(() => ({
    id: "bdf3b2be-d0cd-4a3c-a10e-82d32c12d3bd",
    name: "Ba Sing Se",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless you control a basic land.\n{T}: Add {G}.\n{2}{G}, {T}: Earthbend 2. Activate only as a sorcery. (Target land you control becomes a 0/0 creature with haste that's still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)",
    types: ["Land"],
    entersTappedUnlessControls: {
        kind: "controls",
        filter: { types: ["Land"], supertypes: ["Basic"] },
        atLeast: 1,
    },
    activatedAbilities: [
        {
            id: "ba-sing-se-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
        },
        {
            id: "ba-sing-se-earthbend",
            oracleText:
                "{2}{G}, {T}: Earthbend 2. Activate only as a sorcery. (Target land you control becomes a 0/0 creature with haste that's still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)",
            cost: { mana: { X: 2, G: 1 }, tap: true },
            useStack: true,
            sorcerySpeedOnly: true,
            targetRequirement: { type: "Land", count: 1, controller: "you" },
            effects: [
                {
                    op: "animate",
                    target: { target: 0 },
                    power: 0,
                    toughness: 0,
                    grantedAbilities: ["haste"],
                },
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: 2,
                    target: { target: 0 },
                },
                {
                    op: "delayedTrigger",
                    timing: "leaves-battlefield-indefinite",
                    oracleText:
                        "When it dies or is exiled, return it to the battlefield tapped.",
                    watch: { target: 0 },
                    capture: { $land: { target: 0 } },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$land" },
                            from: "graveyard",
                            to: "battlefield",
                            tapped: true,
                            controller: "controller",
                        },
                        {
                            op: "moveZone",
                            target: { ref: "$land" },
                            from: "exile",
                            to: "battlefield",
                            tapped: true,
                            controller: "controller",
                        },
                    ],
                },
            ],
        },
    ],
}));
