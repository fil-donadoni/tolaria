import { describe, it, expect } from "vitest";
import {
    areaOf,
    dryRun,
    purgeFile,
    purgeSources,
} from "../purge-identity-tests";
import {
    classifyTestBlocks,
    type CardFacts,
} from "../lib/identity-test-classifier";
import {
    IDENTITY_ALLOWLIST,
    isAllowListed,
    staleEntries,
    testName,
} from "../lib/identity-test-allowlist";

/**
 * Regression test for the #2363 codemod (`scripts/purge-identity-tests.ts`).
 *
 * The codemod's contract is narrow and easy to overshoot: it removes identity
 * `it()` blocks, then the `describe` wrappers those blocks emptied — and
 * NOTHING else. The failure mode is silent by construction: a wrapper removed
 * one block too eagerly takes real engine tests with it, and the result is a
 * green suite that no longer tests anything.
 *
 * That is not hypothetical. The first #2363 run deleted 9 behavioural blocks
 * this way. `describe.each(table)(name, fn)` parses as a call whose CALLEE is
 * itself a call — `CallExpression{ expression: CallExpression{ describe.each,
 * [table] } }` — and the inner head, holding nothing but the table, trivially
 * "contains no test". Treating it as a suite in its own right deleted its
 * enclosing statement, which is the whole `describe.each` wrapper, behavioural
 * siblings included. The `.each` cases below are the guard against that shape.
 */

const HEADER = `import { describe, it, expect } from "vitest";\n`;

const IDENTITY_BLOCK = `    it("is a 2/2 Bear", () => {
        expect(def.power).toBe(2);
        expect(def.toughness).toBe(2);
    });`;

const BEHAVIOUR_BLOCK = `    it("deals its damage through the engine", () => {
        const state = makeState();
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });`;

/** Titles of the blocks a purge left behind, in file order. */
function survivingTitles(source: string): (string | null)[] {
    const result = purgeFile("t/__tests__/x.test.ts", source, new Set());
    return classifyTestBlocks("t/__tests__/x.test.ts", result.text).map(
        (b) => b.title
    );
}

describe("purge-identity-tests codemod", () => {
    it("classifies the fixture blocks the way the cases below assume", () => {
        // Guards the guard: if the classifier ever stopped calling the
        // behaviour block behavioural, every case here would pass vacuously.
        const verdicts = classifyTestBlocks(
            "t/__tests__/x.test.ts",
            `${HEADER}describe("d", () => {\n${IDENTITY_BLOCK}\n\n${BEHAVIOUR_BLOCK}\n});\n`
        ).map((b) => b.verdict);
        expect(verdicts).toEqual(["identity", "behavioural"]);
    });

    describe("plain describe", () => {
        it("removes the identity block and keeps its behavioural sibling", () => {
            const titles = survivingTitles(
                `${HEADER}describe("Grizzly Bears", () => {\n${IDENTITY_BLOCK}\n\n${BEHAVIOUR_BLOCK}\n});\n`
            );
            expect(titles).toEqual(["deals its damage through the engine"]);
        });

        it("removes the whole wrapper only when every block inside was identity", () => {
            const result = purgeFile(
                "t/__tests__/x.test.ts",
                `${HEADER}describe("Grizzly Bears", () => {\n${IDENTITY_BLOCK}\n});\n`,
                new Set()
            );
            expect(result.text).not.toContain("describe(");
            expect(
                classifyTestBlocks("t/__tests__/x.test.ts", result.text)
            ).toHaveLength(0);
        });
    });

    describe("describe.each (the shape that regressed)", () => {
        const each = (body: string) =>
            `${HEADER}describe.each([{ def: bears }, { def: wolves }])(
    "$def.name",
    ({ def }) => {
${body}
    }
);\n`;

        it("keeps the behavioural siblings when only one block inside is identity", () => {
            const titles = survivingTitles(
                each(`${IDENTITY_BLOCK}\n\n${BEHAVIOUR_BLOCK}`)
            );
            expect(titles).toEqual(["deals its damage through the engine"]);
        });

        it("still removes the wrapper when every block inside was identity", () => {
            const result = purgeFile(
                "t/__tests__/x.test.ts",
                each(IDENTITY_BLOCK),
                new Set()
            );
            expect(result.text).not.toContain("describe.each");
        });

        it("leaves a wrapper holding no identity block completely untouched", () => {
            const source = each(BEHAVIOUR_BLOCK);
            expect(
                purgeFile("t/__tests__/x.test.ts", source, new Set()).text
            ).toBe(source);
        });
    });

    it("is idempotent — a second pass over purged output changes nothing", () => {
        const source = `${HEADER}describe("Grizzly Bears", () => {\n${IDENTITY_BLOCK}\n\n${BEHAVIOUR_BLOCK}\n});\n`;
        const once = purgeFile("t/__tests__/x.test.ts", source, new Set()).text;
        const twice = purgeFile("t/__tests__/x.test.ts", once, new Set()).text;
        expect(twice).toBe(once);
    });
});

describe("the named allow-list (issue #4489)", () => {
    // A real entry, so the case below exercises the shipped list, not a fixture.
    const entry = IDENTITY_ALLOWLIST[0];
    const [title, ...chainReversed] = entry.test.split(" > ").reverse();
    const chain = chainReversed.reverse();
    /** A census block whose name is exactly the entry's, in the entry's file. */
    const censusSource =
        HEADER +
        chain.map((d) => `describe(${JSON.stringify(d)}, () => {\n`).join("") +
        `it(${JSON.stringify(title)}, () => {\n    expect(new Set(IDS).size).toBe(IDS.length);\n});\n` +
        chain.map(() => "});\n").join("");

    it("builds the census fixture the cases below assume", () => {
        const [b] = classifyTestBlocks(entry.file, censusSource);
        expect(b.verdict).toBe("identity");
        expect(testName(b)).toBe(entry.test);
    });

    it("clears an allow-listed census block, by name", () => {
        const [b] = classifyTestBlocks(entry.file, censusSource);
        expect(isAllowListed(b)).toBe(true);
        // Same block in another file is NOT covered — the key is file + name.
        expect(isAllowListed({ ...b, file: "elsewhere.test.ts" })).toBe(false);
    });

    it("the dry run counts it as allow-listed, not flagged", () => {
        const noCards: CardFacts = {
            byId: () => undefined,
            byName: () => undefined,
        };
        const r = dryRun([{ file: entry.file, source: censusSource }], noCards);
        expect(r.identity).toEqual({ flagged: 0, allowListed: 1 });
    });

    it("the rewrite spares it", () => {
        const result = purgeFile(entry.file, censusSource, new Set());
        expect(result.removed).toBe(0);
        expect(result.text).toBe(censusSource);
    });

    it("every entry carries a reason and a unique name, and none sits in the card sets", () => {
        const keys = IDENTITY_ALLOWLIST.map((e) => `${e.file}::${e.test}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const e of IDENTITY_ALLOWLIST) {
            expect(e.reason.trim().length, e.test).toBeGreaterThan(0);
            expect(e.file.startsWith("convex/cards/sets/"), e.file).toBe(false);
        }
    });

    it("reports an entry that no longer exempts anything as stale", () => {
        const [b] = classifyTestBlocks(entry.file, censusSource);
        const gone = { ...entry, test: "gone > block" };
        expect(staleEntries([b], [entry, gone]).stale).toEqual([gone]);
        // The block gained a call: it exists, but the entry exempts nothing.
        const behavioural = { ...b, verdict: "behavioural" as const };
        expect(staleEntries([behavioural], [entry]).stale).toEqual([entry]);
    });

    it("reports an entry whose name matches several blocks as ambiguous", () => {
        const [b] = classifyTestBlocks(entry.file, censusSource);
        expect(staleEntries([b, b], [entry]).ambiguous).toEqual([entry]);
        expect(staleEntries([b], [entry]).ambiguous).toEqual([]);
    });
});

describe("the repo-wide dry run (issue #4489)", () => {
    const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const cards: CardFacts = {
        byId: (id) =>
            id === BOLT
                ? { id, name: "Lightning Bolt", ownsCode: null, smokeRun: true }
                : undefined,
        byName: () => undefined,
    };
    const SET_FILE = "convex/cards/sets/lea/__tests__/red.test.ts";
    const SET_SOURCE = `${HEADER}const bolt = getDefinition("${BOLT}");
describe("Lightning Bolt", () => {
    it("deals 3 to a player", () => {
        const state = makeState();
        pushSpell(state, bolt.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(bolt.manaCost).toEqual({ R: 1 });
        expect(state.players[1].life).toBe(17);
    });
});
`;
    const GRE_FILE = "convex/gre/__tests__/x.test.ts";

    it("counts each class per area", () => {
        const r = dryRun(
            [
                { file: SET_FILE, source: SET_SOURCE },
                {
                    file: GRE_FILE,
                    source: `${HEADER}${IDENTITY_BLOCK}\n`,
                },
            ],
            cards
        );
        expect(r.identity.flagged).toBe(1);
        expect(r.definitionReads).toEqual({ lines: 1, blocks: 1 });
        expect(r.opOnly).toMatchObject({ blocks: 0, onPureDslCards: 1 });
        expect(r.byArea.get("set:lea")).toEqual([0, 1, 0]);
        expect(r.byArea.get("convex/gre")).toEqual([1, 0, 0]);
        expect(r.rows.map((row) => row.split("\t")[0]).sort()).toEqual([
            "definition-read",
            "identity",
        ]);
    });

    it("reports the Op-only block once its definition read is gone", () => {
        const source = SET_SOURCE.replace(
            "        expect(bolt.manaCost).toEqual({ R: 1 });\n",
            ""
        );
        const r = dryRun([{ file: SET_FILE, source }], cards);
        expect(r.opOnly).toEqual({ blocks: 1, cards: 1, onPureDslCards: 1 });
        expect(r.byArea.get("set:lea")).toEqual([0, 0, 1]);
    });

    it("evaluates the Op-only class in the card-set suites only", () => {
        const source = SET_SOURCE.replace(
            "        expect(bolt.manaCost).toEqual({ R: 1 });\n",
            ""
        );
        const r = dryRun([{ file: GRE_FILE, source }], cards);
        expect(r.opOnly).toEqual({ blocks: 0, cards: 0, onPureDslCards: 0 });
    });

    it("names an area by set code inside the card sets, by directory elsewhere", () => {
        expect(areaOf(SET_FILE)).toBe("set:lea");
        expect(areaOf("src/lib/__tests__/x.test.ts")).toBe("src/lib");
    });
});

describe("the purge — both classes, repo-wide (issue #4490)", () => {
    const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
    const cards: CardFacts = {
        byId: (id) =>
            id === BOLT
                ? { id, name: "Lightning Bolt", ownsCode: null, smokeRun: true }
                : undefined,
        byName: () => undefined,
    };
    const SET_FILE = "convex/cards/sets/lea/__tests__/red.test.ts";
    const OP_ONLY_BLOCK = `    it("deals 3 to a player", () => {
        const state = makeState();
        pushSpell(state, bolt.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });`;
    // Names card-owned code (`kick…`), so the Op-only class clears it.
    const CARD_OWNED_BLOCK = `    it("its kicker gate is enforced", () => {
        const state = makeState();
        pushSpell(state, bolt.id, "p1");
        resolveTopOfStack(state);
        expect(kickerGate(state)).toBe(true);
    });`;
    const wrap = (...blocks: string[]) =>
        `${HEADER}const bolt = getDefinition("${BOLT}");\ndescribe("Lightning Bolt", () => {\n${blocks.join("\n\n")}\n});\n`;
    const SOURCE = wrap(OP_ONLY_BLOCK, CARD_OWNED_BLOCK);

    it("classifies the fixture blocks the way the cases below assume", () => {
        const blocks = classifyTestBlocks(SET_FILE, SOURCE, { cards });
        expect(blocks.map((b) => b.opOnly?.kind)).toEqual([
            "op-only",
            "cleared",
        ]);
    });

    it("removes the Op-only block in a card-set suite and keeps the card-owned sibling", () => {
        const r = purgeFile(SET_FILE, SOURCE, new Set(), { cards });
        expect(r.removedOpOnly).toBe(1);
        expect(r.removedIdentity).toBe(0);
        expect(r.deleted).toEqual([
            {
                kind: "op-only",
                line: 4,
                name: "Lightning Bolt > deals 3 to a player",
            },
        ]);
        expect(
            classifyTestBlocks(SET_FILE, r.text).map((b) => b.title)
        ).toEqual(["its kicker gate is enforced"]);
    });

    it("leaves the same block alone without card facts — outside the card sets it is an engine fixture", () => {
        const r = purgeFile(
            "convex/gre/__tests__/x.test.ts",
            SOURCE,
            new Set()
        );
        expect(r.removed).toBe(0);
        expect(r.text).toBe(SOURCE);
    });

    it("removes an identity block outside the card sets — the rewrite is repo-wide", () => {
        const source = `${HEADER}describe("d", () => {\n${IDENTITY_BLOCK}\n\n${BEHAVIOUR_BLOCK}\n});\n`;
        const r = purgeFile("src/lib/__tests__/x.test.ts", source, new Set());
        expect(r.removedIdentity).toBe(1);
        expect(r.deleted).toEqual([
            { kind: "identity", line: 3, name: "d > is a 2/2 Bear" },
        ]);
        expect(r.text).toContain("deals its damage through the engine");
    });

    it("reports a file whose every block was purged as emptied", () => {
        const r = purgeFile(SET_FILE, wrap(OP_ONLY_BLOCK), new Set(), {
            cards,
        });
        expect(r.after).toBe(0);
        expect(r.emptied).toBe(true);
    });

    it("the repo-wide rewrite hands card facts to card-set suites ONLY — an engine test on the same card is untouched", () => {
        const GRE_FILE = "convex/gre/__tests__/x.test.ts";
        const r = purgeSources(
            [
                { file: SET_FILE, source: SOURCE },
                { file: GRE_FILE, source: SOURCE },
            ],
            cards,
            new Set()
        );
        expect(r.writes.map((w) => w.file)).toEqual([SET_FILE]);
        expect(r.removedOpOnly).toBe(1);
        expect(r.rows).toEqual([
            `op-only\t${SET_FILE}:4\tLightning Bolt > deals 3 to a player`,
        ]);
        expect(r.byArea.get("set:lea")).toEqual([2, 1]);
        expect(r.byArea.get("convex/gre")).toEqual([2, 2]);
    });

    it("the repo-wide rewrite unlinks a suite it emptied instead of writing it back", () => {
        const r = purgeSources(
            [{ file: SET_FILE, source: wrap(OP_ONLY_BLOCK) }],
            cards,
            new Set()
        );
        expect(r.unlinks).toEqual([SET_FILE]);
        expect(r.writes).toEqual([]);
    });

    it("--keep spares an Op-only block by file:line", () => {
        const r = purgeFile(SET_FILE, SOURCE, new Set([`${SET_FILE}:4`]), {
            cards,
        });
        expect(r.removed).toBe(0);
        expect(r.text).toBe(SOURCE);
    });
});
