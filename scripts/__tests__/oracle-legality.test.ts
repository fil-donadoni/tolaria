// `data/oracle-legality.json` generation (issue #2695): the per-card
// Premodern legality `oracle-compile.ts` computes and discards (folded into
// aggregate counts only). These tests exercise the pure builder against
// synthetic corpus fixtures — no network, no gitignored corpus cache needed —
// mirroring `oracle-compile.test.ts`'s offline-half-of-the-guard shape.

import { describe, expect, it } from "vitest";
import {
    buildLegalityFile,
    buildPremodernLegalNames,
    LEGALITY_GENERATOR,
    serializeLegalityFile,
    type OracleLegalityFile,
} from "../oracle-legality";
import type { CorpusCard, CorpusPin } from "../oracle-corpus";

function corpusCard(overrides: Partial<CorpusCard> = {}): CorpusCard {
    return {
        oracleId: "00000000-0000-0000-0000-000000000001",
        name: "Test Bear",
        manaCost: "{1}{G}",
        typeLine: "Creature — Bear",
        oracleText: "",
        power: "2",
        toughness: "2",
        layout: "normal",
        legalIn: ["premodern", "legacy"],
        ...overrides,
    };
}

const PIN: CorpusPin = {
    source: "https://api.scryfall.com/bulk-data/oracle-cards",
    downloadUri: "https://data.scryfall.io/test.jsonl.gz",
    updatedAt: "2026-08-25T00:00:00.000Z",
    cardCount: 0,
    sha256: "deadbeef",
};

describe("buildPremodernLegalNames — corpus -> name set (issue #2695)", () => {
    it("includes a name whose legalIn contains premodern", () => {
        const names = buildPremodernLegalNames([
            corpusCard({ name: "Test Bear", legalIn: ["premodern"] }),
        ]);
        expect(names).toEqual(["Test Bear"]);
    });

    it("excludes a name whose legalIn does NOT contain premodern", () => {
        const names = buildPremodernLegalNames([
            corpusCard({ name: "Test Faerie", legalIn: ["legacy", "vintage"] }),
        ]);
        expect(names).toEqual([]);
    });

    it("excludes a name with an EMPTY legalIn (banned/unsupported everywhere)", () => {
        const names = buildPremodernLegalNames([
            corpusCard({ name: "Test Bomb", legalIn: [] }),
        ]);
        expect(names).toEqual([]);
    });

    it("UNION by name: two oracle ids sharing a name are legal if EITHER is (never last-write-wins)", () => {
        // A joke/Un-set duplicate ("Test Bolt", not premodern-legal) sharing a
        // name with the real tournament card (premodern-legal). Order in the
        // corpus array must not matter — try both orders.
        const real = corpusCard({
            oracleId: "00000000-0000-0000-0000-0000000000a1",
            name: "Test Bolt",
            legalIn: ["premodern"],
        });
        const joke = corpusCard({
            oracleId: "00000000-0000-0000-0000-0000000000a2",
            name: "Test Bolt",
            legalIn: [],
        });
        expect(buildPremodernLegalNames([real, joke])).toEqual(["Test Bolt"]);
        expect(buildPremodernLegalNames([joke, real])).toEqual(["Test Bolt"]);
    });

    it("dedupes case-insensitively but keeps the first-seen casing", () => {
        const names = buildPremodernLegalNames([
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000b1",
                name: "Test Bear",
                legalIn: ["premodern"],
            }),
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000b2",
                name: "TEST BEAR",
                legalIn: ["premodern"],
            }),
        ]);
        expect(names).toEqual(["Test Bear"]);
    });

    it("sorts with a plain byte comparator, not localeCompare", () => {
        const names = buildPremodernLegalNames([
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000c1",
                name: "Zoo Card",
                legalIn: ["premodern"],
            }),
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000c2",
                name: "Aardvark Card",
                legalIn: ["premodern"],
            }),
        ]);
        expect(names).toEqual(["Aardvark Card", "Zoo Card"]);
    });

    it("is deterministic across repeated calls on the same input", () => {
        const corpus = [
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000d1",
                name: "Test Bear",
                legalIn: ["premodern"],
            }),
            corpusCard({
                oracleId: "00000000-0000-0000-0000-0000000000d2",
                name: "Test Faerie",
                legalIn: ["premodern"],
            }),
        ];
        expect(buildPremodernLegalNames(corpus)).toEqual(
            buildPremodernLegalNames(corpus)
        );
    });
});

describe("buildLegalityFile / serializeLegalityFile — shape + byte determinism", () => {
    const corpus = [
        corpusCard({ name: "Test Bear", legalIn: ["premodern"] }),
        corpusCard({
            oracleId: "00000000-0000-0000-0000-000000000002",
            name: "Test Faerie",
            legalIn: ["legacy"],
        }),
    ];

    it("builds the documented shape: generator, corpus pin, premodern[]", () => {
        const file = buildLegalityFile(corpus, PIN);
        expect(file).toEqual<OracleLegalityFile>({
            generator: LEGALITY_GENERATOR,
            corpus: PIN,
            premodern: ["Test Bear"],
        });
    });

    it("serializes byte-identically across two runs on the same input", () => {
        const a = serializeLegalityFile(buildLegalityFile(corpus, PIN));
        const b = serializeLegalityFile(buildLegalityFile(corpus, PIN));
        expect(a).toBe(b);
    });

    it("serializes as pretty JSON with a trailing newline (matches serializeLockfile's convention)", () => {
        const text = serializeLegalityFile(buildLegalityFile(corpus, PIN));
        expect(text.endsWith("\n")).toBe(true);
        expect(JSON.parse(text)).toEqual({
            generator: LEGALITY_GENERATOR,
            corpus: PIN,
            premodern: ["Test Bear"],
        });
    });
});
