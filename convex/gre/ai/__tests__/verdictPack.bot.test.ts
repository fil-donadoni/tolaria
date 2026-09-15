// The Verdict pack's format (issue #3581, PRD #3574, ADR 0128 §9).
//
// A pack is unbelieved: the claims here are what a reader refuses, not what a
// writer produces. A pack carries EXACTLY the ids its lock names — an extra
// line, a missing one, a line twice are each a disagreement between the pack
// and the lock and each stops the read — and a line whose payload does not
// re-hash to the id it travels under never reaches the fit. The fetch, the
// hash over the whole pack and the machine cache are
// `scripts/__tests__/verdict-pack-cache.bot.test.ts`.
import { describe, expect, it } from "vitest";
import {
    canonicalJson,
    encodeVerdictPack,
    parseVerdictPack,
    verdictIdOf,
    verdictPackObjectName,
    verdictsFromLock,
    type StoredVerdictPayload,
    type VerdictJudgement,
    type VerdictLock,
} from "../verdicts";

const PACK_HASH = "cd".repeat(32);

const judgementAnswering = (index: number): VerdictJudgement => ({
    spec: { cards: [], phase: "PRECOMBAT_MAIN" },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"play-land"}', description: "play Mountain" },
        { key: '{"kind":"cast-spell"}', description: "cast Shock" },
    ],
    answer: { kind: "right", rightIndexes: [index] },
});

const stored = (judgement: VerdictJudgement): StoredVerdictPayload => ({
    verdictId: verdictIdOf(judgement),
    payload: JSON.parse(canonicalJson(judgement)),
});

const [A, B, C] = [0, 1, 2].map((i) => stored(judgementAnswering(i)));

const lockOf = (entries: StoredVerdictPayload[]): VerdictLock => ({
    verdictIds: entries.map((e) => e.verdictId),
    packHash: PACK_HASH,
});

describe("verdictPackObjectName (issue #3581)", () => {
    it("names a pack by its content hash, and by nothing else", () => {
        expect(verdictPackObjectName(PACK_HASH)).toBe(
            `packs/${PACK_HASH}.jsonl.gz`
        );
        for (const notAHash of [A.verdictId, "../x", PACK_HASH.toUpperCase()]) {
            expect(() => verdictPackObjectName(notAHash)).toThrow(
                /Not a pack hash/
            );
        }
    });
});

describe("encodeVerdictPack / parseVerdictPack (issue #3581)", () => {
    it("round-trips the lock's verdicts, and the corpus comes out in lock order", () => {
        const text = encodeVerdictPack([A, B, C]);
        const lock = lockOf([C, A, B]);
        const entries = parseVerdictPack(lock, text);
        expect(entries).toEqual([A, B, C]);
        expect(verdictsFromLock(lock, entries).map((v) => v.id)).toEqual(
            lock.verdictIds
        );
    });

    it("encodes one corpus as one text, whatever key order the payloads carry", () => {
        const reordered = {
            verdictId: A.verdictId,
            payload: Object.fromEntries(
                Object.entries(A.payload as object).reverse()
            ),
        };
        expect(encodeVerdictPack([reordered])).toBe(encodeVerdictPack([A]));
    });

    it("refuses a pack carrying a verdict the lock does not name", () => {
        expect(() =>
            parseVerdictPack(lockOf([A, B]), encodeVerdictPack([A, B, C]))
        ).toThrow(
            new RegExp(`carries ${C.verdictId}, which the lock does not name`)
        );
    });

    it("refuses a pack lacking a verdict the lock names", () => {
        expect(() =>
            parseVerdictPack(lockOf([A, B]), encodeVerdictPack([A]))
        ).toThrow(new RegExp(`lacks ${B.verdictId}, which the lock names`));
    });

    it("refuses a pack carrying one verdict twice", () => {
        expect(() =>
            parseVerdictPack(lockOf([A]), encodeVerdictPack([A, A]))
        ).toThrow(new RegExp(`carries ${A.verdictId} twice`));
    });

    it("refuses a line that is not an entry, naming the pack and the line", () => {
        const lock = lockOf([A]);
        const line = encodeVerdictPack([A]);
        const rejects = (text: string, why: RegExp) =>
            expect(() => parseVerdictPack(lock, text)).toThrow(why);
        rejects(
            `${line}{`,
            /packs\/(cd)+\.jsonl\.gz: line 2 is not valid JSON/
        );
        rejects(`\n${line}`, /line 1 is not valid JSON/);
        rejects(
            `{"payload":{},"verdictId":"registry:x"}\n`,
            /line 1 is not a \{verdictId, payload\} entry/
        );
        rejects(
            `{"verdictId":"${A.verdictId}"}\n`,
            /line 1 is not a \{verdictId, payload\} entry/
        );
    });

    it("carries a payload that does not re-hash to its id only as far as the loader, which refuses it", () => {
        const tampered = {
            verdictId: A.verdictId,
            payload: B.payload,
        };
        const lock = lockOf([A]);
        const entries = parseVerdictPack(lock, encodeVerdictPack([tampered]));
        expect(() => verdictsFromLock(lock, entries)).toThrow(
            new RegExp(`content hashes to ${B.verdictId}`)
        );
    });
});
