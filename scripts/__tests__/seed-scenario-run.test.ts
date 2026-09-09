// `seedScenarioArgv` — the flags the preset-scenario seed runs with
// (issue #3253).
//
// WHY THIS IS A TEST AND NOT A COMMENT. `debugScenarios:seedScenarioDirect`
// resolves every `spec.cards[].name` SERVER-SIDE, against the bundle currently
// deployed. Without `--push`, `npx convex run` reads whatever `convex dev` last
// pushed — so the seed silently depends on a watcher process that may be
// stopped, or still bundling the fast-forward `land` performed a second
// earlier. Measured over the 80 merged PRs before 2026-09-09: 14 carried a
// loadable spec and 10 had never reached the deployment; every one of them
// seeded fine when re-run by hand. Nothing else in the suite can see the flag
// go missing — the seed is non-gating by contract, so its failure prints and
// exits 0 from `land`'s point of view.

import { describe, expect, it } from "vitest";
import { seedScenarioArgv } from "../lib/seed-scenario-run";

const PAYLOAD = '{"label":"x","spec":{"cards":[]}}';

describe("seedScenarioArgv (issue #3253)", () => {
    it("pushes the checkout's code before running the mutation", () => {
        expect(seedScenarioArgv(PAYLOAD)).toContain("--push");
    });

    it("runs the seed mutation with the payload last", () => {
        const argv = seedScenarioArgv(PAYLOAD);
        expect(argv.slice(0, 2)).toEqual(["convex", "run"]);
        expect(argv.at(-2)).toBe("debugScenarios:seedScenarioDirect");
        expect(argv.at(-1)).toBe(PAYLOAD);
    });

    it("skips the typecheck and the codegen the push would otherwise run", () => {
        // Cost control, not behaviour: `land` has just gated this exact tree,
        // and `convex/_generated` is committed — regenerating it would dirty
        // the primary checkout the seed is standing in.
        const argv = seedScenarioArgv(PAYLOAD);
        expect(argv[argv.indexOf("--typecheck") + 1]).toBe("disable");
        expect(argv[argv.indexOf("--codegen") + 1]).toBe("disable");
    });

    it("passes the payload as ONE argv entry, never shell-joined", () => {
        // A spec label carries spaces and em dashes; joining the argv into a
        // shell string is how that becomes an unparseable JSON argument.
        const spaced = '{"label":"a b — c","spec":{"cards":[]}}';
        expect(
            seedScenarioArgv(spaced).filter((a) => a === spaced)
        ).toHaveLength(1);
    });
});
