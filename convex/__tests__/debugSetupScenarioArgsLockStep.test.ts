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
    type ScenarioSpec,
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

    // Guard C (issue #3513 review): the SEVENTH site. `normalizeScenarioSpec`
    // is the tolerant READ path — `debugScenarios.spec` is stored `v.any()` on
    // purpose — and it copies known fields only, building a fresh object. A
    // field added to the validator and forgotten here is accepted at WRITE and
    // silently STRIPPED on every read: the admin form reopens the row without
    // it and saves it back over the golden row, and the two live loaders hand
    // the mutation a spec the field never reached. Nothing else would fail.
    //
    // `Required<ScenarioSpec>` is what makes a newly added field a COMPILE
    // error here, the same mechanism `scenario-spec-preservation.test.tsx`
    // uses on the form side.
    it("carries every spec field through the tolerant read path (drift guard)", () => {
        const EVERY_FIELD: Required<ScenarioSpec> = {
            cards: [{ name: "Plains", owner: "me", zone: "battlefield" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
            libraryCount: 2,
            hiddenHand: { me: 1 },
            turn: 3,
            markLastDrawn: true,
            rngSeed: 7,
            poison: { me: 1 },
            life: { me: 4, opp: 17 },
            experience: { me: 1 },
            landsPlayed: { me: 1 },
            spellsCastThisTurn: { me: 1 },
            spellsCastThisGame: { me: 1 },
            stormCount: 1,
            damageDealtToPlayerThisTurn: { me: 1 },
            artifactDamageToPlayerThisTurn: { me: 1 },
            lifeGainedThisTurn: { me: 1 },
            deathsThisTurn: 1,
            creatureAttackedThisTurn: true,
            qualifyingActionThisTurn: { me: true },
            qualifyingActionLastTurn: { me: true },
            turnsTaken: { me: 2 },
            revolt: { me: true },
            activePlayer: "me",
            priority: "me",
            passCount: 1,
            combat: { attackers: ["Plains"], confirmed: true },
            manaPool: { me: { R: 1 } },
            restrictedMana: { me: [{ amount: 1, color: "R" }] },
            continuousEffects: [
                {
                    layer: 7,
                    sublayer: "7c",
                    affected: { me: ["Plains"] },
                    controller: "me",
                    payload: { kind: "pt-modify", power: 1, toughness: 1 },
                },
            ],
            stack: [
                {
                    kind: "spell",
                    name: "Lightning Bolt",
                    controller: "opp",
                    targets: [
                        { kind: "permanent", name: "Plains", seat: "me" },
                    ],
                    castOffSorceryTiming: true,
                },
            ],
            companion: { name: "Lurrus of the Dream-Den", owner: "me" },
        };
        const normalized = normalizeScenarioSpec(
            JSON.parse(JSON.stringify(EVERY_FIELD))
        );
        for (const key of Object.keys(specFields)) {
            expect({
                key,
                present: normalized[key as keyof ScenarioSpec],
            }).toHaveProperty("present");
            expect(
                normalized[key as keyof ScenarioSpec],
                `normalizeScenarioSpec dropped "${key}"`
            ).not.toBeUndefined();
        }
        // And the declared stack specifically, in full: a shallow presence
        // check would pass on a branch that kept `kind` and lost the targets.
        expect(normalized.stack).toEqual(EVERY_FIELD.stack);
    });
});
