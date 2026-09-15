// Verdict identity — the verdict id and the position key (issue #3575,
// PRD #3574, ADR 0128 §3 / §6).
//
// Every claim here is a property of the NAME, never the shape of a helper:
// equal judgements get one name however they were spelled, provenance moves
// no name, the answer moves the id and not the position key, and anything
// else about the judgement moves both. The golden pin at the bottom is the
// other half of `v1-`: a canonicalisation that drifts renames every object in
// the store, so it must go red here rather than at the first fetch.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
    canonicalJson,
    positionKeyOf,
    verdictIdOf,
    VERDICT_HASH_PATTERN,
    type Verdict,
} from "../verdicts";
import { sha256Hex } from "../verdicts/sha256";

const BASE: Verdict = {
    id: "in-play:k17abc",
    spec: {
        cards: [],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
        life: { me: 20, opp: 7 },
    },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [2] },
    botPickIndex: 0,
    author: "dev:user123",
    createdAt: "2026-09-15T10:00:00.000Z",
    source: "in-play",
    origin: { gameId: "g42", seq: 17 },
    note: "burn face for lethal",
};

const SETUP = [{ kind: "pass" }] as unknown as Verdict["setup"];
/** Same length as `SETUP`, different step — the content is hashed, not a count. */
const SETUP_OTHER = [{ kind: "attack" }] as unknown as Verdict["setup"];

const ids = (v: Verdict) => ({
    id: verdictIdOf(v),
    position: positionKeyOf(v),
});

/** A deep copy with every object's keys in REVERSED insertion order. */
function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .reverse()
                .map(([k, v]) => [k, reverseKeys(v)])
        );
    }
    return value;
}

describe("sha256Hex (FIPS 180-4)", () => {
    it("matches the published test vectors", () => {
        expect(sha256Hex("")).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        expect(sha256Hex("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    });

    it("agrees with node:crypto across block boundaries and non-ASCII text", () => {
        const inputs = [
            "a".repeat(55),
            "a".repeat(56),
            "a".repeat(63),
            "a".repeat(64),
            "a".repeat(65),
            "x".repeat(1000),
            "Jötun Grunt — Æther Vial",
            "日本語のカード",
            "🜂 dragon 🐉",
            "lone \ud800 high and \udc00 low surrogate",
            JSON.stringify(BASE),
        ];
        for (const input of inputs) {
            expect(sha256Hex(input), input.slice(0, 20)).toBe(
                createHash("sha256").update(input, "utf8").digest("hex")
            );
        }
    });
});

describe("verdict id and position key (issue #3575)", () => {
    it("carry the v1- canonicalisation prefix and a 64-hex sha256", () => {
        const { id, position } = ids(BASE);
        expect(id).toMatch(VERDICT_HASH_PATTERN);
        expect(position).toMatch(VERDICT_HASH_PATTERN);
        expect(id.startsWith("v1-")).toBe(true);
        expect(id).not.toBe(position);
    });

    it("do not move with key order, whitespace or number spelling", () => {
        const base = ids(BASE);
        expect(ids(reverseKeys(BASE) as Verdict)).toEqual(base);

        // The same judgement as a JSON text with incidental whitespace and
        // three spellings of numbers a parser reads as the same value.
        const respelled = JSON.parse(`{
            "seat" : "me",
            "answer": { "rightIndexes": [ 2.0 ], "kind": "right" },
            "candidates": [
                { "description": "pass", "key": "{\\"kind\\":\\"pass\\"}" },
                { "description": "play Mountain", "key": "{\\"kind\\":\\"play-land\\"}" },
                { "description": "cast Shock", "key": "{\\"kind\\":\\"cast-spell\\"}" }
            ],
            "spec": { "life": { "opp": 7e0, "me": 2.0E1 }, "turn": 30e-1,
                      "phase": "PRECOMBAT_MAIN", "cards": [] }
        }`) as Verdict;
        expect(ids(respelled)).toEqual(base);

        // -0 is the one number JSON.stringify and a naive encoder disagree on.
        const zero = { ...BASE, spec: { ...BASE.spec, turn: 0 } };
        const negativeZero = { ...BASE, spec: { ...BASE.spec, turn: -0 } };
        expect(ids(negativeZero)).toEqual(ids(zero));

        // An `undefined` member is an absent one, as in any JSON rendering.
        expect(
            ids({ ...BASE, spec: { ...BASE.spec, landCount: undefined } })
        ).toEqual(base);
    });

    it("do not move with author, note, createdAt, gameId, botPickIndex — or any other provenance", () => {
        const base = ids(BASE);
        const variants: Verdict[] = [
            { ...BASE, author: "prod:someone-else" },
            { ...BASE, note: "a different note" },
            { ...BASE, note: undefined },
            { ...BASE, createdAt: "2030-01-01T00:00:00.000Z" },
            { ...BASE, origin: { gameId: "g99", seq: 17 } },
            { ...BASE, botPickIndex: 1 },
            { ...BASE, botPickIndex: undefined },
            { ...BASE, id: "authored:whatever" },
            { ...BASE, source: "authored" },
            { ...BASE, origin: { gameId: "g42", seq: 99 } },
            { ...BASE, origin: undefined },
            // The describer's sentence is a rendering, not the judgement: a
            // reworded `describeMove` on another build must not rename it.
            {
                ...BASE,
                candidates: BASE.candidates.map((c) => ({
                    ...c,
                    description: `${c.description} (reworded)`,
                })),
            },
        ];
        for (const variant of variants) {
            expect(ids(variant)).toEqual(base);
        }
    });

    it("moves the verdict id but NOT the position key when the answer changes", () => {
        const base = ids(BASE);
        const answers: Verdict["answer"][] = [
            { kind: "right", rightIndexes: [1] },
            { kind: "right", rightIndexes: [1, 2] },
            { kind: "forbidden", forbiddenIndexes: [2] },
        ];
        for (const answer of answers) {
            const moved = ids({ ...BASE, answer });
            expect(moved.id).not.toBe(base.id);
            expect(moved.position).toBe(base.position);
        }
    });

    it("moves BOTH hashes when anything else about the judgement changes", () => {
        const base = ids(BASE);
        const [pass, land, shock] = BASE.candidates;
        const variants: [string, Verdict][] = [
            [
                "spec",
                { ...BASE, spec: { ...BASE.spec, life: { me: 20, opp: 8 } } },
            ],
            [
                "spec key added",
                { ...BASE, spec: { ...BASE.spec, landCount: 4 } },
            ],
            ["setup", { ...BASE, setup: SETUP }],
            ["seat", { ...BASE, seat: "opp" }],
            [
                "deckKnowledge",
                { ...BASE, deckKnowledge: [{ seat: "opp", cards: ["Shock"] }] },
            ],
            [
                "candidate key",
                {
                    ...BASE,
                    candidates: [pass, land, { ...shock, key: '{"kind":"x"}' }],
                },
            ],
            ["setup content", { ...BASE, setup: SETUP_OTHER }],
            [
                "deckKnowledge content",
                { ...BASE, deckKnowledge: [{ seat: "opp", cards: ["Bolt"] }] },
            ],
            ["candidate order", { ...BASE, candidates: [land, pass, shock] }],
            ["candidate removed", { ...BASE, candidates: [pass, land] }],
        ];
        for (const [what, variant] of variants) {
            const moved = ids(variant);
            expect(moved.id, what).not.toBe(base.id);
            expect(moved.position, what).not.toBe(base.position);
        }
    });

    it("treats what the consumers treat as equal as one judgement", () => {
        const base = ids(BASE);
        // `applyBladeSetupSteps` iterates `setup ?? []`; `bladeDeckKnowledge`
        // tests `?.length` — empty and absent build the same position.
        expect(ids({ ...BASE, setup: [] })).toEqual(base);
        expect(ids({ ...BASE, deckKnowledge: [] })).toEqual(base);
        // `evalPairsOf` reads an answer's indexes through `new Set`.
        const multi = ids({
            ...BASE,
            answer: { kind: "right", rightIndexes: [1, 2] },
        });
        expect(
            ids({ ...BASE, answer: { kind: "right", rightIndexes: [2, 1, 2] } })
        ).toEqual(multi);
    });

    it("pins the v1 canonicalisation to the bit", () => {
        // A change here renames every object in the Verdict Store. If it is
        // deliberate it is a NEW canonicalisation version, never an edit of v1.
        expect(
            canonicalJson({ b: [1, -0, "é"], a: { d: null, c: true } })
        ).toBe('{"a":{"c":true,"d":null},"b":[1,0,"é"]}');
        expect(ids(BASE)).toEqual({
            id: "v1-fa12142b11902d58b7e26c8860c09734f834ce4307711d5191252a2f2e380df6",
            position:
                "v1-bfff810e67689f0b54c2ca42c49e2eba99173fc83987d07c77e21b53acc9b0ff",
        });
    });

    it("refuses values JSON cannot say exactly once", () => {
        for (const bad of [
            NaN,
            Infinity,
            1n,
            () => 0,
            new Date(0),
            [1, undefined],
        ]) {
            expect(() => canonicalJson({ x: bad })).toThrow(
                /canonical encoding/
            );
        }
        const unknownKind = {
            ...BASE,
            answer: { kind: "maybe" },
        } as unknown as Verdict;
        expect(() => verdictIdOf(unknownKind)).toThrow(/canonical encoding/);
    });
});

describe("dependency boundary (issue #3575)", () => {
    // The id is computed in the Convex bundle, the browser engine and the
    // scripts; a node builtin or a package import would make it computable in
    // only some of them.
    const verdictsDir = resolve(__dirname, "../verdicts");
    const convexDir = resolve(__dirname, "../../..");

    function specifiers(file: string): string[] {
        const source = readFileSync(join(verdictsDir, file), "utf8");
        const found: string[] = [];
        for (const match of source.matchAll(
            /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g
        )) {
            found.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
        }
        return found;
    }

    it("imports nothing outside the engine — no node builtins, no packages", () => {
        for (const file of ["identity.ts", "sha256.ts"]) {
            for (const spec of specifiers(file)) {
                expect(spec, `${file} imports ${spec}`).toMatch(/^\.\.?\//);
                const target = resolve(dirname(join(verdictsDir, file)), spec);
                expect(
                    relative(convexDir, target).startsWith(".."),
                    `${file} imports ${spec}, outside convex/`
                ).toBe(false);
            }
        }
        expect(specifiers("sha256.ts")).toEqual([]);
        expect(specifiers("identity.ts")).toEqual(["./sha256", "./types"]);
        // `./types` reaches the blade harness and the scenario builder; only a
        // TYPE import of it is erased from every bundle.
        expect(readFileSync(join(verdictsDir, "identity.ts"), "utf8")).toMatch(
            /\nimport type \{[^}]*\} from "\.\/types";/
        );
    });
});
