// The Profile Census seed validator (`scripts/lib/profile-census.ts`) and the
// residue schema (`convex/limited/cardProfilesCore.ts`) — the mechanical half
// of `.claude/skills/profile-census/`. Each refusal is pinned by a fixture
// that makes exactly that one mistake, so a rule that stops firing reds.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
    censusRationaleErrors,
    getCardArchetypeFile,
    getCardCapabilityFile,
    validateCensusResidue,
    type CardArchetypeFile,
    type CardCapabilityFile,
} from "../../convex/limited/cardProfilesCore";
import { CUBE_SOURCE_KEY } from "../../convex/limited/cubeSource";
import { censusWriteErrors } from "../lib/profile-census";

const REPO_ROOT = resolve(__dirname, "..", "..");
const FIXTURE = resolve(
    __dirname,
    "fixtures",
    "profile-census",
    "residue.fixture.json"
);
const RESIDUE_DIR = resolve(REPO_ROOT, "data", "card-profiles", "residue");

const ANIMATE_DEAD = "8fd7861d-925f-4b4c-a4ab-60be6f43d50b";
const ARID_MESA = "16c8d2fa-54a7-46e8-980c-905258497c90";
const BLOODSTAINED_MIRE = "68c72226-6f52-4322-8b14-18737293dfa0";
const BARROWGOYF = "f979fc86-2c7e-49b3-965e-607a203cbfb1";

const RATIONALE = "oracle: sacrifices itself to fetch, a land in the yard";

function capabilities(
    rows: CardCapabilityFile["capabilities"]
): CardCapabilityFile {
    return { capabilities: rows };
}

function archetypes(rows: CardArchetypeFile["archetypes"]): CardArchetypeFile {
    return { scope: "vintage-cube", archetypes: rows };
}

function fixture(): Record<string, unknown> {
    return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

function withCandidate(patch: Record<string, unknown>) {
    const residue = fixture();
    const [candidate] = residue.candidates as Record<string, unknown>[];
    residue.candidates = [{ ...candidate, ...patch }];
    return residue;
}

describe("census rationale names its source kind", () => {
    it("accepts one kind and a +-joined list", () => {
        expect(censusRationaleErrors(RATIONALE)).toEqual([]);
        expect(
            censusRationaleErrors("set-review+popular-pick: first-pick removal")
        ).toEqual([]);
    });

    it("refuses a missing rationale, an unknown kind, two lines, no reason", () => {
        expect(censusRationaleErrors(undefined)).toHaveLength(1);
        expect(censusRationaleErrors("vibes: it is good")[0]).toMatch(
            /source kind "vibes"/
        );
        expect(censusRationaleErrors("oracle: one\ntwo")[0]).toMatch(
            /more than one line/
        );
        expect(censusRationaleErrors("oracle:  ")[0]).toMatch(/no reason/);
        expect(censusRationaleErrors("it is good")[0]).toMatch(/does not open/);
    });
});

describe("census residue schema", () => {
    it("the fixture residue validates", () => {
        expect(validateCensusResidue(fixture())).toEqual({
            valid: true,
            errors: [],
        });
    });

    it("every checked-in residue file validates", () => {
        const files = existsSync(RESIDUE_DIR)
            ? readdirSync(RESIDUE_DIR).filter((f) => f.endsWith(".json"))
            : [];
        const errors = files.flatMap((f) =>
            validateCensusResidue(
                JSON.parse(readFileSync(resolve(RESIDUE_DIR, f), "utf8"))
            ).errors.map((e) => `${f}: ${e}`)
        );
        expect(errors).toEqual([]);
    });

    it("refuses a candidate that is already a registered Capability", () => {
        expect(
            validateCensusResidue(withCandidate({ name: "self-mills" })).errors
        ).toEqual([expect.stringMatching(/already a registered Capability/)]);
    });

    it("refuses a candidate that is an Archetype Catalogue row", () => {
        expect(
            validateCensusResidue(withCandidate({ name: "control" })).errors
        ).toEqual([expect.stringMatching(/Archetype Catalogue row/)]);
    });

    it("refuses a one-sided candidate and an unresolved card", () => {
        expect(
            validateCensusResidue(withCandidate({ requirers: [] })).errors
        ).toEqual([expect.stringMatching(/lists no requirers/)]);
        expect(
            validateCensusResidue(
                withCandidate({ providers: [ARID_MESA, "not-a-card"] })
            ).errors
        ).toEqual([expect.stringMatching(/"not-a-card" does not resolve/)]);
    });

    it("refuses a non-kebab name, a two-line why, an unknown key", () => {
        expect(
            validateCensusResidue(withCandidate({ name: "Graveyard Types" }))
                .errors
        ).toEqual([expect.stringMatching(/not kebab-case/)]);
        expect(
            validateCensusResidue(withCandidate({ why: "a\nb" })).errors
        ).toEqual([expect.stringMatching(/more than one line/)]);
        expect(
            validateCensusResidue(withCandidate({ weight: 2 })).errors
        ).toEqual([expect.stringMatching(/unknown key "weight"/)]);
    });

    it("ties pass, scope and rows together", () => {
        expect(
            validateCensusResidue({ ...fixture(), pass: "capability" }).errors
        ).toEqual([expect.stringMatching(/only it names scope "catalogue"/)]);
        expect(
            validateCensusResidue({ ...fixture(), pass: "delta" }).errors
        ).toEqual([expect.stringMatching(/names its rows/)]);
        expect(
            validateCensusResidue({ ...fixture(), rows: ["x"] }).errors
        ).toEqual([expect.stringMatching(/carries no rows/)]);
    });
});

describe("census write: the checked-in seeds", () => {
    it("an untouched seed is a legal (empty) census write", () => {
        const caps = getCardCapabilityFile();
        const cube = getCardArchetypeFile(CUBE_SOURCE_KEY)!;
        expect(
            censusWriteErrors({
                layer: "capabilities",
                before: caps,
                after: caps,
            })
        ).toEqual([]);
        expect(
            censusWriteErrors({
                layer: "archetypes",
                before: cube,
                after: cube,
            })
        ).toEqual([]);
    });
});

describe("census write never touches a reviewed row", () => {
    const reviewed = capabilities({
        [ARID_MESA]: { provides: ["self-mills"], requires: [], reviewed: true },
    });

    it("refuses a write onto a reviewed row", () => {
        const after = capabilities({
            [ARID_MESA]: {
                provides: ["self-mills", "discard-outlet"],
                requires: [],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({
                layer: "capabilities",
                before: reviewed,
                after,
            })
        ).toEqual([expect.stringMatching(/wrote onto a reviewed row/)]);
    });

    it("refuses deleting a reviewed row", () => {
        expect(
            censusWriteErrors({
                layer: "capabilities",
                before: reviewed,
                after: capabilities({}),
            })
        ).toEqual([expect.stringMatching(/deleted a reviewed row/)]);
    });

    it("refuses writing reviewed: true", () => {
        const after = capabilities({
            [BLOODSTAINED_MIRE]: {
                provides: ["self-mills"],
                requires: [],
                reviewed: true,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({ layer: "capabilities", before: null, after })
        ).toEqual([expect.stringMatching(/only a human reviews/)]);
    });
});

describe("census write refuses unregistered ids and bare rows", () => {
    it("refuses an unregistered Capability", () => {
        const after = capabilities({
            [ARID_MESA]: {
                provides: ["graveyard-card-types"],
                requires: [],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({ layer: "capabilities", before: null, after })
        ).toEqual([expect.stringMatching(/unregistered Capability/)]);
    });

    it("refuses an unregistered Archetype and an unresolved card", () => {
        const after = archetypes({
            [ARID_MESA]: {
                archetypes: ["landfall"],
                reviewed: false,
                rationale: RATIONALE,
            },
            "not-a-card": {
                archetypes: ["control"],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({ layer: "archetypes", before: null, after })
        ).toEqual([
            expect.stringMatching(/not a catalogue seed row/),
            expect.stringMatching(/"not-a-card" does not resolve/),
        ]);
    });

    it("refuses a written row with no rationale", () => {
        const after = capabilities({
            [ARID_MESA]: {
                provides: ["self-mills"],
                requires: [],
                reviewed: false,
            },
        });
        expect(
            censusWriteErrors({ layer: "capabilities", before: null, after })
        ).toEqual([expect.stringMatching(/rationale is missing/)]);
    });

    it("refuses a Combo Edge", () => {
        const after = capabilities({
            [ANIMATE_DEAD]: {
                provides: [],
                requires: ["reanimatable"],
                comboEdges: [{ cardId: BARROWGOYF, weight: 1 }],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({ layer: "capabilities", before: null, after })
        ).toEqual([expect.stringMatching(/Combo Edge/)]);
    });

    it("accepts a legal unreviewed row with its rationale", () => {
        const after = capabilities({
            [ARID_MESA]: {
                provides: ["self-mills"],
                requires: [],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({ layer: "capabilities", before: null, after })
        ).toEqual([]);
    });
});

describe("a delta census changes only its rows", () => {
    const before = archetypes({
        [ARID_MESA]: { archetypes: ["ramp"], reviewed: false },
    });

    it("accepts adding the delta's row and keeps the other tags", () => {
        const after = archetypes({
            [ARID_MESA]: {
                archetypes: ["ramp", "control"],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({
                layer: "archetypes",
                before,
                after,
                rows: ["control"],
            })
        ).toEqual([]);
    });

    it("refuses a tag change outside the delta's rows", () => {
        const after = archetypes({
            [ARID_MESA]: {
                archetypes: ["control"],
                reviewed: false,
                rationale: RATIONALE,
            },
        });
        expect(
            censusWriteErrors({
                layer: "archetypes",
                before,
                after,
                rows: ["control"],
            })
        ).toEqual([expect.stringMatching(/changed archetypes:ramp, outside/)]);
    });
});
