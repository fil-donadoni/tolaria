import { describe, it, expect } from "vitest";
import { purgeFile } from "../purge-identity-tests";
import { classifyTestBlocks } from "../lib/identity-test-classifier";

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
