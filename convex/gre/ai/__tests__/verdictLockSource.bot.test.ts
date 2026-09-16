// The Verdict Lock as the corpus's selector, and schema change as an upcast at
// read (issue #3578, PRD #3574, ADR 0128 §2 / §8).
//
// Every claim is a property the Weight Fit depends on, never the shape of a
// helper: what the lock does not name never arrives, what it names must arrive
// and must be what its name promises, a payload from the future stops the run
// by id, an upcaster sees the old payload and nothing else, and one lock is
// one corpus in one order. The last block drives a locked verdict through the
// real pair builder — a loader that selected perfectly and was wired to
// nothing would pass everything above it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    canonicalJson,
    evalPairsOf,
    lockedVerdictCorpus,
    parseVerdictLock,
    verdictIdOf,
    verdictsFromLock,
    LOCK_VERDICT_AUTHOR,
    LOCK_VERDICT_TIMESTAMP,
    VERDICT_BASE_SCHEMA_VERSION,
    VERDICT_LOCK_PATH,
    VERDICT_SCHEMA_VERSION,
    VERDICT_UPCASTERS,
    type StoredVerdictPayload,
    type VerdictJudgement,
    type VerdictLock,
    type VerdictSchema,
} from "../verdicts";
import { BLADE_SCENARIOS } from "../blade/registry";

/** A real position with a real candidate list from the Bot's own enumerator
 *  — the hand-authored verdict `data/verdicts/` carried until issue #3584. */
const LETHAL_BOLT: VerdictJudgement = {
    spec: {
        cards: [
            {
                name: "Mountain",
                owner: "me",
                zone: "battlefield",
            },
            {
                name: "Lightning Bolt",
                owner: "me",
                zone: "hand",
            },
            {
                name: "Grizzly Bears",
                owner: "opp",
                zone: "battlefield",
            },
        ],
        phase: "PRECOMBAT_MAIN",
        life: {
            me: 20,
            opp: 3,
        },
    },
    seat: "me",
    candidates: [
        {
            key: '{"kind":"pass"}',
            description: "pass",
        },
        {
            key: '{"kind":"cast-spell","cardInstanceId":"122","targets":[{"type":"permanent","id":"123"}],"confirmTargets":false,"tapPlan":[{"cardInstanceId":"121"}]}',
            description: "cast Lightning Bolt → Grizzly Bears",
        },
        {
            key: '{"kind":"cast-spell","cardInstanceId":"122","targets":[{"type":"player","id":"p1"}],"confirmTargets":false,"tapPlan":[{"cardInstanceId":"121"}]}',
            description: "cast Lightning Bolt → Blade P1",
        },
        {
            key: '{"kind":"cast-spell","cardInstanceId":"122","targets":[{"type":"player","id":"p2"}],"confirmTargets":false,"tapPlan":[{"cardInstanceId":"121"}]}',
            description: "cast Lightning Bolt → Blade P2",
        },
    ],
    answer: {
        kind: "right",
        rightIndexes: [3],
    },
};

const JUDGEMENT: VerdictJudgement = {
    spec: { cards: [], phase: "PRECOMBAT_MAIN" },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [2] },
};

/** Three distinct judgements about one position — three verdict ids. */
const judgementAnswering = (index: number): VerdictJudgement => ({
    ...JUDGEMENT,
    answer: { kind: "right", rightIndexes: [index] },
});

/** A payload as the store holds it: the canonical judgement, re-parsed. */
const stored = (
    judgement: Record<string, unknown>,
    verdictId = verdictIdOf(judgement as unknown as VerdictJudgement)
): StoredVerdictPayload => ({
    verdictId,
    payload: JSON.parse(canonicalJson(judgement)),
});

const lockOf = (verdictIds: string[]): VerdictLock => ({
    verdictIds,
    packHash: "ab".repeat(32),
});

const [A, B, C] = [0, 1, 2].map((i) => stored(judgementAnswering(i)));

describe("parseVerdictLock (issue #3578)", () => {
    it("reads the committed ids in order, and the pack hash", () => {
        const lock = parseVerdictLock(
            JSON.stringify({
                verdictIds: [C.verdictId, A.verdictId],
                packHash: "ab".repeat(32),
            })
        );
        expect(lock).toEqual({
            verdictIds: [C.verdictId, A.verdictId],
            packHash: "ab".repeat(32),
        });
    });

    it("refuses a lock no fit may run over, naming the lock", () => {
        const rejects = (body: unknown, why: RegExp) =>
            expect(() => parseVerdictLock(JSON.stringify(body))).toThrow(why);
        const packHash = "ab".repeat(32);
        const lockPath = VERDICT_LOCK_PATH.replace(/\./g, "\\.");
        rejects(
            { verdictIds: ["registry:x"], packHash },
            new RegExp(`${lockPath}: .*not a verdict id`)
        );
        rejects(
            { verdictIds: [A.verdictId, A.verdictId], packHash },
            new RegExp(`${lockPath}: .*names ${A.verdictId} twice`)
        );
        rejects({ verdictIds: [A.verdictId] }, /"packHash" must be/);
        rejects({ packHash }, /"verdictIds" must be an array/);
        expect(() => parseVerdictLock("{")).toThrow(/not valid JSON/);
    });
});

describe("the lock selects (issue #3578)", () => {
    it("an unlisted payload is absent from the corpus, however present", () => {
        const corpus = verdictsFromLock(lockOf([A.verdictId, C.verdictId]), [
            A,
            B,
            C,
        ]);
        expect(corpus.map((v) => v.id)).toEqual([A.verdictId, C.verdictId]);
    });

    it("an unlisted payload is not even read — a broken one cannot stop the run", () => {
        const broken = { verdictId: "v1-" + "0".repeat(64), payload: "junk" };
        expect(() =>
            verdictsFromLock(lockOf([A.verdictId]), [broken, A])
        ).not.toThrow();
    });

    it("a listed payload nobody supplied is a loud failure, naming the id", () => {
        expect(() =>
            verdictsFromLock(lockOf([A.verdictId, B.verdictId]), [A])
        ).toThrow(
            new RegExp(`${B.verdictId}: .*names this verdict, but no payload`)
        );
    });

    it("the same id supplied twice is refused", () => {
        expect(() => verdictsFromLock(lockOf([A.verdictId]), [A, A])).toThrow(
            /supplied twice/
        );
    });

    it("reads the judgement whole, with the lock's provenance constants", () => {
        const full = stored({
            ...JUDGEMENT,
            setup: [{ kind: "pass" }],
            deckKnowledge: [{ seat: "opp", cards: ["Mountain"] }],
        });
        const [verdict] = verdictsFromLock(lockOf([full.verdictId]), [full]);
        expect(verdict).toEqual({
            id: full.verdictId,
            ...JUDGEMENT,
            setup: [{ kind: "pass" }],
            deckKnowledge: [{ seat: "opp", cards: ["Mountain"] }],
            author: LOCK_VERDICT_AUTHOR,
            createdAt: LOCK_VERDICT_TIMESTAMP,
            source: "store",
        });
    });
});

describe("the name is the content (issue #3578)", () => {
    it("rejects a payload whose content does not hash to the id the lock names", () => {
        // The answer is judgement: flipping it is exactly the tampering a
        // content address exists to catch.
        const tampered: StoredVerdictPayload = {
            verdictId: A.verdictId,
            payload: JSON.parse(canonicalJson(judgementAnswering(1))),
        };
        expect(() =>
            verdictsFromLock(lockOf([A.verdictId]), [tampered])
        ).toThrow(
            new RegExp(
                `${A.verdictId}: content hashes to ${B.verdictId}, not to the id the lock names`
            )
        );
    });

    it("rejects a payload that cannot be hashed at all, naming the id", () => {
        const id = A.verdictId;
        expect(() =>
            verdictsFromLock(lockOf([id]), [{ verdictId: id, payload: [] }])
        ).toThrow(new RegExp(`${id}: payload must be a JSON object`));
        expect(() =>
            verdictsFromLock(lockOf([id]), [
                { verdictId: id, payload: { ...JUDGEMENT, spec: { n: NaN } } },
            ])
        ).toThrow(new RegExp(`${id}: payload cannot be hashed`));
    });

    it("rejects a payload that hashes right but is not a judgement, naming the id", () => {
        const badIndex = stored({
            ...JUDGEMENT,
            answer: { kind: "right", rightIndexes: [9] },
        });
        expect(() =>
            verdictsFromLock(lockOf([badIndex.verdictId]), [badIndex])
        ).toThrow(
            new RegExp(`${badIndex.verdictId}: "answer.rightIndexes" holds 9`)
        );
    });
});

describe("schemaVersion (issue #3578)", () => {
    it("reads a payload with no schemaVersion as the base version, and one that states it the same", () => {
        const stated = stored({
            ...JUDGEMENT,
            schemaVersion: VERDICT_BASE_SCHEMA_VERSION,
        });
        // The field is outside the id's projection: stating it renames nothing.
        const bare = stored({ ...JUDGEMENT });
        expect(stated.verdictId).toBe(bare.verdictId);
        expect(verdictsFromLock(lockOf([bare.verdictId]), [stated])).toEqual(
            verdictsFromLock(lockOf([bare.verdictId]), [bare])
        );
    });

    it("an unknown schemaVersion throws, naming the id", () => {
        const future = stored({
            ...JUDGEMENT,
            schemaVersion: VERDICT_SCHEMA_VERSION + 1,
        });
        expect(() =>
            verdictsFromLock(lockOf([future.verdictId]), [future])
        ).toThrow(
            new RegExp(
                `${future.verdictId}: unknown "schemaVersion" ${VERDICT_SCHEMA_VERSION + 1}`
            )
        );
    });

    it("a schemaVersion that is not a version throws, naming the id", () => {
        for (const schemaVersion of [0, 1.5, "1"]) {
            const odd = stored({ ...JUDGEMENT, schemaVersion });
            expect(() =>
                verdictsFromLock(lockOf([odd.verdictId]), [odd])
            ).toThrow(
                new RegExp(`${odd.verdictId}: "schemaVersion" .* is not`)
            );
        }
    });
});

describe("the upcaster chain (issue #3578)", () => {
    // A three-version history, injected: version 1 called a candidate's
    // sentence `label`, version 2 renamed it `description`, version 3
    // reworded it. Neither change touches what the verdict id covers — an
    // upcast never renames. The reader understands only version 3.
    type Candidate = { key: string; label?: string; description?: string };
    const THREE: VerdictSchema = {
        current: 3,
        upcasters: {
            1: (older) => ({
                ...older,
                candidates: (older.candidates as Candidate[]).map(
                    ({ label, ...rest }) => ({ ...rest, description: label })
                ),
            }),
            2: (older) => ({
                ...older,
                candidates: (older.candidates as Candidate[]).map((c) => ({
                    ...c,
                    description: `${c.description} (v3)`,
                })),
            }),
        },
    };
    const v1 = stored({
        ...JUDGEMENT,
        candidates: JUDGEMENT.candidates.map(({ key, description }) => ({
            key,
            label: description,
        })),
        schemaVersion: 1,
    });
    // A different answer, so a different verdict: v1 and v2 are two ids.
    const v2 = stored({ ...judgementAnswering(1), schemaVersion: 2 });

    it("lifts each payload from its own version to the current one, in order", () => {
        const [fromV1, fromV2] = verdictsFromLock(
            lockOf([v1.verdictId, v2.verdictId]),
            [v1, v2],
            THREE
        );
        expect(fromV1.candidates[2].description).toBe("cast Shock (v3)");
        // Version 2 skipped the first link: run on a payload with no `label`
        // it would have left every description undefined, and been refused.
        expect(fromV2.candidates[2].description).toBe("cast Shock (v3)");
        expect(fromV2.answer).toEqual({ kind: "right", rightIndexes: [1] });
    });

    it("keeps the id the payload was stored under — the lifted judgement still hashes to it", () => {
        const [fromV1] = verdictsFromLock(lockOf([v1.verdictId]), [v1], THREE);
        expect(fromV1.id).toBe(v1.verdictId);
        expect(verdictIdOf(fromV1)).toBe(v1.verdictId);
    });

    it("refuses an upcaster that changes the judgement, naming the id", () => {
        // An old spelling the id's projection cannot see (`rightIndex`) hashes
        // as no answer at all; lifting it into `rightIndexes` changes what the
        // id covers, which is a new judgement, not a new format.
        const legacy = stored({
            ...JUDGEMENT,
            answer: { kind: "right", rightIndex: 2 },
            schemaVersion: 1,
        });
        const meaningful: VerdictSchema = {
            current: 2,
            upcasters: {
                1: (older) => ({
                    ...older,
                    answer: {
                        kind: "right",
                        rightIndexes: [
                            (older.answer as { rightIndex: number }).rightIndex,
                        ],
                    },
                }),
            },
        };
        expect(() =>
            verdictsFromLock(lockOf([legacy.verdictId]), [legacy], meaningful)
        ).toThrow(
            new RegExp(
                `${legacy.verdictId}: content hashes to v1-[0-9a-f]{64} after the upcast from "schemaVersion" 1, not to the id the lock names`
            )
        );
    });

    it("a missing link in the chain throws, naming the id and the version", () => {
        const gap: VerdictSchema = {
            current: 3,
            upcasters: { 1: THREE.upcasters[1] },
        };
        expect(() =>
            verdictsFromLock(lockOf([v1.verdictId]), [v1], gap)
        ).toThrow(
            new RegExp(
                `${v1.verdictId}: no upcaster lifts "schemaVersion" 2 to 3`
            )
        );
    });

    it("an upcaster cannot mutate the payload it is handed", () => {
        const mutating: VerdictSchema = {
            current: 2,
            upcasters: {
                1: (older) => {
                    (older.candidates as unknown[]).pop();
                    return { ...older };
                },
            },
        };
        const payload = stored({ ...JUDGEMENT });
        expect(() =>
            verdictsFromLock(lockOf([payload.verdictId]), [payload], mutating)
        ).toThrow(
            new RegExp(
                `${payload.verdictId}: the upcaster from "schemaVersion" 1 threw`
            )
        );
        expect(
            (payload.payload as { candidates: unknown[] }).candidates
        ).toHaveLength(3);
    });

    it("the shipped chain has a link for every version below the current one", () => {
        for (
            let version = VERDICT_BASE_SCHEMA_VERSION;
            version < VERDICT_SCHEMA_VERSION;
            version++
        ) {
            expect(typeof VERDICT_UPCASTERS[version]).toBe("function");
        }
    });

    it("the shipped upcaster module holds only type imports and reads no clock, randomness or global", () => {
        const source = readFileSync(
            join(process.cwd(), "convex/gre/ai/verdicts/upcasters.ts"),
            "utf8"
        )
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
        const imports = source.match(/^\s*import\b.*$/gm) ?? [];
        expect(
            imports.filter((line) => !/^\s*import type\b/.test(line))
        ).toEqual([]);
        expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
        expect(source).not.toMatch(
            /\b(Date|Math\.random|performance|crypto|process|globalThis|fetch|setTimeout|setInterval)\b/
        );
    });
});

describe("one lock, one corpus (issue #3578)", () => {
    it("the corpus is in lock order, whatever order the payloads arrive in", () => {
        const lock = lockOf([C.verdictId, A.verdictId, B.verdictId]);
        const forward = verdictsFromLock(lock, [A, B, C]);
        const backward = verdictsFromLock(lock, [C, B, A]);
        expect(forward.map((v) => v.id)).toEqual(lock.verdictIds);
        expect(backward).toEqual(forward);
    });

    it("puts the registry verdicts first and the locked verdicts after them, with the registry's gaps", () => {
        const scenarios = BLADE_SCENARIOS.slice(0, 8);
        const corpus = lockedVerdictCorpus(
            lockOf([B.verdictId]),
            [A, B],
            scenarios
        );
        const registry = lockedVerdictCorpus(lockOf([]), [], scenarios);
        expect(registry.verdicts.length).toBeGreaterThan(0);
        expect(corpus.verdicts.map((v) => v.id)).toEqual([
            ...registry.verdicts.map((v) => v.id),
            B.verdictId,
        ]);
        expect(corpus.gaps).toEqual(registry.gaps);
    });

    it("a locked verdict reaches the pair builder", () => {
        // The lethal-Bolt position (CR 104.3b: the opponent is at 3 and the
        // Bolt deals 3), stored the way the Verdict Store holds it: its
        // judgement only, canonical, named by its hash. Inlined since issue
        // #3584 retired `data/verdicts/`, where it was the authored example.
        const bolt = stored(LETHAL_BOLT);

        const verdict = lockedVerdictCorpus(
            lockOf([bolt.verdictId]),
            [bolt],
            []
        ).verdicts[0];
        const out = evalPairsOf(verdict);
        expect(out.error).toBeUndefined();
        // Four candidates, one of them right: three constraints.
        expect(out.pairs).toHaveLength(3);
        expect(out.pairs.every((p) => p.rightIndex === 3)).toBe(true);
    });
});
