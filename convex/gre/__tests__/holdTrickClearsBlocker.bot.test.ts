// `hold-trick` and the blocker a sorcery-speed activation clears (issue #9910).
//
// CR 508.1a — the active player declares attackers after its precombat main;
// CR 509.1a — only an untapped creature the defending player controls blocks.
// A sacrifice-cost activation whose resolution removes a creature able to
// block the mover's own attack buys THIS turn's combat, so holding it for a
// later window is not the same act: the root rule must not defer it. With no
// creature able to attack, the same sweep keeps its later window.
import { describe, expect, it } from "vitest";
import { findBladeScenario } from "../ai/blade/registry";
import { runBladeScenario } from "../ai/blade/runner";

const CLEARS =
    "sweep: Engineered Explosives clears three blockers before the Craw Wurm attacks";
const WAITS = "sweep: Engineered Explosives waits when no attacker is ready";

function run(label: string) {
    const scenario = findBladeScenario(label);
    if (!scenario) throw new Error(`missing blade entry: ${label}`);
    return runBladeScenario(scenario);
}

describe("hold-trick never defers a blocker cleared before the mover's attack (CR 508.1a / 509.1a)", () => {
    it("a Craw Wurm able to attack: Engineered Explosives sweeps the three blockers now", () => {
        const result = run(CLEARS);
        expect(result.failureMessage).toBe("");
        expect(result.seeds.map((s) => s.mechanism)).not.toContain(
            "hold-trick"
        );
    });

    it("no creature able to attack: the sweep is still held on hold-trick", () => {
        const result = run(WAITS);
        expect(result.failureMessage).toBe("");
        expect(result.seeds.every((s) => s.mechanism === "hold-trick")).toBe(
            true
        );
    });
});
