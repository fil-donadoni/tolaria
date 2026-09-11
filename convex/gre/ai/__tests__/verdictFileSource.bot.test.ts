// `data/verdicts/**` as a Verdict source (issue #3402, PRD #3397, ADR 0124 §1).
//
// Two jobs. The first is the PARSER: a file under `data/verdicts/` is repo
// state that went through review, so anything it cannot read as a Verdict has
// to stop the run by name rather than shrink the corpus quietly — the failure
// this suite mostly exists to prove is the silent one, a file that contributes
// nothing while the report says the corpus is fine.
//
// The second is the END-TO-END claim the ticket makes: a hand-authored file on
// disk reaches the pair builder. That is asserted against the REAL directory
// and the REAL `evalPairsOf`, not a fixture string — a corpus loader that
// parsed perfectly and was wired to nothing would pass every test above it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    evalPairsOf,
    parseVerdictFile,
    verdictCorpus,
    verdictsFromFiles,
    VERDICT_DIR,
    type VerdictFile,
} from "../verdicts";
import { BLADE_SCENARIOS } from "../blade/registry";

const CORPUS_DIR = join(process.cwd(), VERDICT_DIR);

/** Every file the shipped corpus holds, read the way a fit runner would. */
function corpusFiles(): VerdictFile[] {
    return readdirSync(CORPUS_DIR)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => ({
            path: `${VERDICT_DIR}/${name}`,
            contents: readFileSync(join(CORPUS_DIR, name), "utf8"),
        }));
}

const MINIMAL = {
    id: "authored:minimal",
    spec: { cards: [] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"other"}', description: "other" },
    ],
    answer: { kind: "right", rightIndexes: [0] },
    author: "tester",
    createdAt: "2026-09-11T00:00:00.000Z",
    source: "authored",
};

const file = (
    body: Record<string, unknown>,
    path = "data/verdicts/x.json"
) => ({
    path,
    contents: JSON.stringify(body),
});

describe("parseVerdictFile (issue #3402)", () => {
    it("reads a well-formed authored file", () => {
        const verdict = parseVerdictFile(file(MINIMAL));
        expect(verdict.id).toBe("authored:minimal");
        expect(verdict.source).toBe("authored");
        expect(verdict.answer).toEqual({ kind: "right", rightIndexes: [0] });
    });

    it("carries the optional fields through when present, and omits them when not", () => {
        const bare = parseVerdictFile(file(MINIMAL));
        expect(bare.setup).toBeUndefined();
        expect(bare.origin).toBeUndefined();
        expect(bare.botPickIndex).toBeUndefined();

        const full = parseVerdictFile(
            file({
                ...MINIMAL,
                setup: [{ kind: "resolve-top" }],
                botPickIndex: 1,
                origin: { gameId: "g1", seq: 12 },
                note: "why",
            })
        );
        expect(full.setup).toEqual([{ kind: "resolve-top" }]);
        expect(full.botPickIndex).toBe(1);
        expect(full.origin).toEqual({ gameId: "g1", seq: 12 });
        expect(full.note).toBe("why");
    });

    it("names the file in every rejection", () => {
        const reject = (body: Record<string, unknown>) => () =>
            parseVerdictFile(file(body, "data/verdicts/bad.json"));

        expect(reject({ ...MINIMAL, id: "" })).toThrow(/bad\.json.*"id"/);
        expect(reject({ ...MINIMAL, seat: "middle" })).toThrow(
            /bad\.json.*"seat"/
        );
        expect(reject({ ...MINIMAL, source: "guessed" })).toThrow(
            /bad\.json.*"source"/
        );
        expect(reject({ ...MINIMAL, candidates: [] })).toThrow(
            /bad\.json.*candidates/
        );
        expect(reject({ ...MINIMAL, spec: "a board" })).toThrow(
            /bad\.json.*"spec"/
        );
        expect(reject({ ...MINIMAL, setup: { kind: "resolve-top" } })).toThrow(
            /bad\.json.*"setup"/
        );
        expect(
            reject({ ...MINIMAL, answer: { kind: "maybe", rightIndexes: [0] } })
        ).toThrow(/bad\.json.*"answer\.kind"/);
        expect(() =>
            parseVerdictFile({
                path: "data/verdicts/bad.json",
                contents: "{ not json",
            })
        ).toThrow(/bad\.json.*not valid JSON/);
    });

    it("refuses an index outside the candidate list, in the answer and in the bot pick", () => {
        // The one malformation a downstream consumer would otherwise hit only
        // at fit time, far from whoever could still say what they meant.
        expect(() =>
            parseVerdictFile(
                file(
                    {
                        ...MINIMAL,
                        answer: { kind: "right", rightIndexes: [7] },
                    },
                    "data/verdicts/bad.json"
                )
            )
        ).toThrow(/outside the 2-candidate list/);
        expect(() =>
            parseVerdictFile(
                file({ ...MINIMAL, botPickIndex: 2 }, "data/verdicts/bad.json")
            )
        ).toThrow(/outside the 2-candidate list/);
        expect(() =>
            parseVerdictFile(
                file(
                    {
                        ...MINIMAL,
                        answer: { kind: "forbidden", forbiddenIndexes: [] },
                    },
                    "data/verdicts/bad.json"
                )
            )
        ).toThrow(/at least one candidate/);
    });
});

describe("verdictsFromFiles (issue #3402)", () => {
    it("orders by verdict id, not by the order the directory was read in", () => {
        const files = [
            file({ ...MINIMAL, id: "authored:c" }, "data/verdicts/3.json"),
            file({ ...MINIMAL, id: "authored:a" }, "data/verdicts/1.json"),
            file({ ...MINIMAL, id: "authored:b" }, "data/verdicts/2.json"),
        ];
        expect(verdictsFromFiles(files).map((v) => v.id)).toEqual([
            "authored:a",
            "authored:b",
            "authored:c",
        ]);
        // Reproducible: directory iteration order is a property of a
        // filesystem, not of the corpus (ADR 0124 §3).
        expect(
            verdictsFromFiles([...files].reverse()).map((v) => v.id)
        ).toEqual(["authored:a", "authored:b", "authored:c"]);
    });

    it("refuses two files naming the same verdict", () => {
        // Silent double-weighting of one constraint is what this prevents —
        // and a botched hand-edit of an exported file is how it happens.
        expect(() =>
            verdictsFromFiles([
                file(MINIMAL, "data/verdicts/1.json"),
                file(MINIMAL, "data/verdicts/2.json"),
            ])
        ).toThrow(/already used by data\/verdicts\/1\.json/);
    });
});

describe("verdictCorpus (issue #3402)", () => {
    const scenarios = BLADE_SCENARIOS.slice(0, 8);

    it("puts the registry verdicts first and the file verdicts after them", () => {
        const corpus = verdictCorpus(
            [file({ ...MINIMAL, id: "authored:z" })],
            scenarios
        );
        const registryCount = corpus.verdicts.filter((v) =>
            v.id.startsWith("registry:")
        ).length;
        expect(registryCount).toBeGreaterThan(0);
        expect(corpus.verdicts[corpus.verdicts.length - 1].id).toBe(
            "authored:z"
        );
        expect(
            corpus.verdicts
                .slice(0, registryCount)
                .every((v) => v.id.startsWith("registry:"))
        ).toBe(true);
    });

    it("carries the registry's gaps through, so one report answers what was left out", () => {
        expect(verdictCorpus([], scenarios).gaps).toEqual(
            verdictCorpus([file(MINIMAL)], scenarios).gaps
        );
    });

    it("refuses a file that collides with a registry-derived id", () => {
        const derived = verdictCorpus([], scenarios).verdicts[0];
        expect(() =>
            verdictCorpus([file({ ...MINIMAL, id: derived.id })], scenarios)
        ).toThrow(/collides with a registry-derived verdict/);
    });
});

describe("the shipped corpus reaches the pair builder (issue #3402)", () => {
    it("every file in data/verdicts/ parses", () => {
        // Not a tautology: this is the check that a hand-edited or
        // hand-authored file cannot sit in the corpus contributing nothing.
        const files = corpusFiles();
        expect(files.length).toBeGreaterThan(0);
        expect(() => verdictsFromFiles(files)).not.toThrow();
    });

    it("the authored lethal-Bolt verdict rebuilds and yields one pair per rejected line", () => {
        const verdict = verdictsFromFiles(corpusFiles()).find(
            (v) => v.id === "authored:lethal-bolt-to-the-face"
        );
        expect(verdict).toBeDefined();

        const out = evalPairsOf(verdict!);
        expect(out.error).toBeUndefined();
        // Four candidates, one of them right: three constraints.
        expect(out.pairs).toHaveLength(3);
        expect(out.pairs.every((p) => p.rightIndex === 3)).toBe(true);
        expect(out.pairs.map((p) => p.otherIndex).sort()).toEqual([0, 1, 2]);
    });
});
