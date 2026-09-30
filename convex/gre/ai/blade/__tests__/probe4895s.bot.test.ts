import { it } from "vitest";
import { runBladeScenario } from "../runner";
import { BLADE_SCENARIOS } from "../registry";
it("scan", () => {
    for (const label of [
        "storm: Grapeshot is lethal because the search counts the spell cast before it",
        "granted flashback: casts Stingcaster Mage to flash back Lightning Bolt for lethal",
    ]) {
        const s = BLADE_SCENARIOS.find((x) => x.label === label)!;
        const r = runBladeScenario({
            ...s,
            seeds: Array.from({ length: 20 }, (_, i) => i),
        });
        console.log(
            `SCAN ${label.slice(0, 30)} own=${JSON.stringify(s.seeds)} fail=${JSON.stringify(r.seeds.filter((x) => !x.ok).map((x) => x.seed))} mech=${[...new Set(r.seeds.map((x) => x.mechanism))].join(",")} sample=${r.seeds.find((x) => !x.ok)?.moveDescription ?? "-"}`
        );
    }
}, 900000);
