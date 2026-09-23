import { validateEffectScript } from "../convex/gre/effects/validate";
const cases: [string, unknown][] = [
    [
        "no such binding",
        {
            effects: [
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { subtype: { ref: "$nope" } },
                },
            ],
        },
    ],
    [
        "reserved target-name ref in a subtype position",
        {
            effects: [
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { subtype: { ref: "$target0.name" } },
                },
            ],
        },
    ],
    [
        "binding declared AFTER the read",
        {
            effects: [
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { subtype: { ref: "$t" } },
                },
                {
                    op: "chooseCreatureType",
                    player: "controller",
                    prompt: "p",
                    bind: "$t",
                },
            ],
        },
    ],
    [
        "snapshot (non-picks) binding in a subtype position",
        {
            effects: [
                { op: "destroy", target: { target: 0 }, bind: "$d" },
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { subtype: { ref: "$d" } },
                },
            ],
        },
    ],
    [
        "missing bind on the Op",
        {
            effects: [
                { op: "chooseCreatureType", player: "controller", prompt: "p" },
            ],
        },
    ],
];
for (const [label, script] of cases) {
    const errs = validateEffectScript(script as never);
    console.log(`${errs.length > 0 ? "REJECT" : "ACCEPT"}  ${label}`);
    if (errs.length) console.log("        " + errs[0].slice(0, 150));
}
