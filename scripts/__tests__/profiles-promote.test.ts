// `profiles:promote` (PRD #8772, issue #8907): an export of a layer's
// effective rows round-trips into the seed byte-for-byte in content, and an
// invalid export is refused with the seed left untouched.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    getCardArchetypeFile,
    getCardCapabilityFile,
} from "../../convex/limited/cardProfilesCore";
import { CUBE_SOURCE_KEY } from "../../convex/limited/cubeSource";
import {
    buildArchetypeExportFile,
    buildCapabilityExportFile,
    serializeSeedFile,
} from "../../convex/limited/cardProfileSeedFiles";
import { promoteSeedFile } from "../lib/profiles-promote";

const REPO_ROOT = resolve(__dirname, "../..");
const CAPABILITIES = "data/card-profiles/capabilities.json";
const CUBE_ARCHETYPES = `data/card-profiles/archetypes/${CUBE_SOURCE_KEY}.json`;

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "profiles-promote-"));
    mkdirSync(join(root, "data/card-profiles/archetypes"), { recursive: true });
    for (const rel of [".prettierrc", CAPABILITIES, CUBE_ARCHETYPES]) {
        copyFileSync(join(REPO_ROOT, rel), join(root, rel));
    }
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const seedCapabilities = getCardCapabilityFile();
const seedArchetypes = getCardArchetypeFile(CUBE_SOURCE_KEY)!;
const [firstCapabilityCard] = Object.keys(seedCapabilities.capabilities);
const [firstArchetypeCard] = Object.keys(seedArchetypes.archetypes);
/** A real card the Capability seed has no row for — a DB-only override.
 *  Drawn from the LEA Pick Ratings, not the cube: since the first Profile
 *  Census (issue #8902) every cube card has a Capability row. */
const leaRatedCards = Object.keys(
    (
        JSON.parse(
            readFileSync(join(REPO_ROOT, "data/pick-ratings/lea.json"), "utf8")
        ) as { ratings: Record<string, number> }
    ).ratings
);
const capabilityNewcomer = leaRatedCards.find(
    (cardId) => !(cardId in seedCapabilities.capabilities)
)!;

describe("export -> profiles:promote round-trip (issue #8907)", () => {
    it("Capabilities: the promoted seed equals the exported effective rows (DB over seed)", async () => {
        const exported = buildCapabilityExportFile(seedCapabilities, [
            {
                cardId: firstCapabilityCard,
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
                rationale: "human review",
            },
            {
                cardId: capabilityNewcomer,
                provides: [],
                requires: ["self-mills"],
                comboEdges: [{ cardId: firstCapabilityCard, weight: 0.5 }],
                reviewed: true,
            },
        ]);
        expect(exported.capabilities[firstCapabilityCard]).toEqual({
            provides: ["reanimatable"],
            requires: [],
            reviewed: true,
            rationale: "human review",
        });
        expect(Object.keys(exported.capabilities)).toHaveLength(
            Object.keys(seedCapabilities.capabilities).length + 1
        );

        const result = await promoteSeedFile(
            serializeSeedFile({ layer: "capabilities", file: exported }),
            root
        );

        expect(result).toMatchObject({ ok: true, path: CAPABILITIES });
        expect(JSON.parse(read(CAPABILITIES))).toEqual(exported);
    });

    it("Archetypes: the promoted scope seed equals the exported effective rows", async () => {
        const exported = buildArchetypeExportFile(
            CUBE_SOURCE_KEY.toUpperCase(),
            seedArchetypes,
            [
                {
                    scope: CUBE_SOURCE_KEY,
                    cardId: firstArchetypeCard,
                    archetypes: ["control"],
                    reviewed: true,
                },
                {
                    // another scope's row never leaks into this file
                    scope: "lea",
                    cardId: capabilityNewcomer,
                    archetypes: ["ramp"],
                    reviewed: true,
                },
            ]
        );
        expect(exported.scope).toBe(CUBE_SOURCE_KEY);
        expect(exported.archetypes[firstArchetypeCard]).toEqual({
            archetypes: ["control"],
            reviewed: true,
        });

        const result = await promoteSeedFile(
            serializeSeedFile({ layer: "archetypes", file: exported }),
            root
        );

        expect(result).toMatchObject({ ok: true, path: CUBE_ARCHETYPES });
        expect(JSON.parse(read(CUBE_ARCHETYPES))).toEqual(exported);
    });

    it("an export with no override promotes to the checked-in seed, formatted bytes unchanged", async () => {
        const before = read(CAPABILITIES);
        const exported = buildCapabilityExportFile(seedCapabilities, []);

        await promoteSeedFile(
            serializeSeedFile({ layer: "capabilities", file: exported }),
            root
        );

        expect(read(CAPABILITIES)).toBe(before);
    });
});

describe("profiles:promote refuses an invalid export and writes nothing (issue #8907)", () => {
    const capabilityRow = (provides: string[]) => ({
        capabilities: {
            [firstCapabilityCard]: { provides, requires: [], reviewed: true },
        },
    });

    const cases: Array<[string, unknown, RegExp]> = [
        [
            "an unregistered Capability",
            capabilityRow(["not-a-capability"]),
            /unregistered Capability "not-a-capability"/,
        ],
        [
            "an unknown card",
            {
                capabilities: {
                    "no-such-card": {
                        provides: [],
                        requires: [],
                        reviewed: true,
                    },
                },
            },
            /"no-such-card" does not resolve to a card/,
        ],
        [
            "an Archetype outside the catalogue seed",
            {
                scope: CUBE_SOURCE_KEY,
                archetypes: {
                    [firstArchetypeCard]: {
                        archetypes: ["not-an-archetype"],
                        reviewed: true,
                    },
                },
            },
            /not a catalogue seed row/,
        ],
        [
            "the wrong layer: Archetype rows in a Capability file",
            {
                capabilities: {
                    [firstCapabilityCard]: {
                        archetypes: ["control"],
                        reviewed: true,
                    },
                },
            },
            /unknown field "archetypes"/,
        ],
        [
            "a shape of no layer",
            { scope: CUBE_SOURCE_KEY, capabilities: {} },
            /match no layer/,
        ],
        [
            "a scope with no checked-in seed file",
            { scope: "zzz", archetypes: {} },
            /ships no checked-in Archetype seed file/,
        ],
    ];

    it.each(cases)("%s", async (_name, file, reason) => {
        const before = [read(CAPABILITIES), read(CUBE_ARCHETYPES)];

        const result = await promoteSeedFile(JSON.stringify(file), root);

        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.errors.join("\n")).toMatch(reason);
        expect([read(CAPABILITIES), read(CUBE_ARCHETYPES)]).toEqual(before);
    });

    it("refuses text that is not JSON", async () => {
        const result = await promoteSeedFile("{ nope", root);
        expect(result.ok).toBe(false);
    });
});
