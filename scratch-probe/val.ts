import { validateEffectScript } from "../convex/gre/effects/validate";
const script = {
    effects: [
        {
            op: "chooseCreatureType",
            player: "controller",
            prompt: "Choose a creature type",
            bind: "$type",
        },
        { op: "reveal", player: { target: 0 }, zone: "hand" },
        {
            op: "discard",
            player: { target: 0 },
            filter: { type: "Creature", subtype: { ref: "$type" } },
        },
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: { target: 0 },
                filter: { type: "Creature", subtype: { ref: "$type" } },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
} as never;
console.log(JSON.stringify(validateEffectScript(script), null, 1));
