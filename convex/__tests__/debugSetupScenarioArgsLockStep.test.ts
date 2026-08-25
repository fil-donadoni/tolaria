// `debugSetupScenario`'s own `args` validator (`convex/game.ts`) and
// `scenarioSpecValidator` (`convex/debugScenarioSpec.ts`) are declared as
// mirror shapes ("the shape mirrors `debugSetupScenario`'s `args` minus
// `gameId`; keep the two in lock-step" — `debugScenarioSpec.ts`'s own header
// comment) but NOTHING enforced that in code. Issue #2147's first pass added
// `life` to `scenarioSpecValidator` (the WRITE path, `saveDebugScenario` /
// `seedScenarioDirect`) and to the pure builder (`buildStateFromScenario`),
// but missed the mutation's OWN `args` validator — the sixth site, caught only
// on review. Both live load paths
// (`src/components/debug/debug-db-scenarios.tsx`,
// `src/hooks/useScenarioTestGame.ts`) spread a `normalizeScenarioSpec(...)`
// result straight into `debugSetupScenario`'s args, so a field present on
// `scenarioSpecValidator` and absent from the mutation's `args` throws
// `ArgumentValidationError` at the Convex function boundary BEFORE the
// handler runs — a scenario saved with `life` could never be loaded.
//
// The project has no convex-test harness (see `adminAuth.test.ts`), so a
// mutation can't literally be invoked through a deployment here. What this
// file does instead is the same idiom `limitedEventViewValidator.test.ts`
// uses for `returns` validators: walk the validator's OWN `.json`
// description — the exact thing Convex validates arguments against at the
// real boundary — via `mutationGeneric`'s `exportArgs()` (see
// `node_modules/convex/dist/esm/server/impl/registration_impl.js`), which is
// plain JS with no backend involved. A hand-copied list of expected fields
// would not catch this: it would just be the same mistake made twice.
import { describe, it, expect } from "vitest";
import { debugSetupScenario } from "../game";
import {
    normalizeScenarioSpec,
    scenarioSpecValidator,
} from "../debugScenarioSpec";
import {
    validatorJsonOf,
    validationErrors,
    type FieldJson,
} from "./fixtures/validatorWalk";

type ExportsArgs = { exportArgs: () => string };

/** The REAL args validator `debugSetupScenario` is registered with, in the
 *  same `.json` shape Convex's own argument-validation boundary reads. */
const argsJson = JSON.parse(
    (debugSetupScenario as unknown as ExportsArgs).exportArgs()
);
const argsFields = (argsJson as { value: Record<string, FieldJson> }).value;

const specJson = validatorJsonOf(scenarioSpecValidator);
const specFields = (specJson as { value: Record<string, FieldJson> }).value;

describe("debugSetupScenario args validator declares `life` (issue #2147, sixth site)", () => {
    it("declares `life` as an optional field — the one this review round adds", () => {
        expect(Object.keys(argsFields)).toContain("life");
    });

    it("accepts the exact args BOTH load paths build from a saved spec carrying life", () => {
        // Mirrors `debug-db-scenarios.tsx`'s `handleLoad` and
        // `useScenarioTestGame.ts`'s load effect: `{ gameId, ...normalizeScenarioSpec(spec) }`
        // handed straight to `debugSetupScenario`.
        const savedRow = {
            spec: {
                cards: [{ name: "Plains", owner: "me", zone: "battlefield" }],
                life: { me: 4, opp: 17 },
            },
        };
        const args = {
            gameId: "game-1",
            ...normalizeScenarioSpec(savedRow.spec),
        };
        // Sanity: the fixture really carries life through normalization —
        // otherwise this test would pass for the wrong reason.
        expect(args.life).toEqual({ me: 4, opp: 17 });

        expect(validationErrors(args, argsJson, "<args>")).toEqual([]);
    });

    it("would REJECT the load-path args if `life` were missing from the args validator", () => {
        // Proves the check above has teeth: simulates the actual bug by
        // walking against a validator description with `life` stripped out,
        // the exact shape `debugSetupScenario`'s args validator had before
        // this fix.
        const withoutLife = {
            ...argsJson,
            value: Object.fromEntries(
                Object.entries(argsFields).filter(([key]) => key !== "life")
            ),
        };
        const args = {
            gameId: "game-1",
            ...normalizeScenarioSpec({
                cards: [{ name: "Plains", owner: "me", zone: "battlefield" }],
                life: { me: 4, opp: 17 },
            }),
        };
        expect(validationErrors(args, withoutLife, "<args>")).toEqual([
            "<args>.life: EXTRA field, absent from the returns validator",
        ]);
    });

    // Guard B: mechanically keep the two validators in lock-step so the NEXT
    // field added to one and forgotten on the other reds here instead of
    // waiting for a reviewer to notice by hand (issue #2147 review, point 3).
    it("carries the same optional field names as scenarioSpecValidator, minus gameId (drift guard)", () => {
        const argsKeys = Object.keys(argsFields)
            .filter((key) => key !== "gameId")
            .sort();
        const specKeys = Object.keys(specFields).sort();
        expect(argsKeys).toEqual(specKeys);
    });
});
