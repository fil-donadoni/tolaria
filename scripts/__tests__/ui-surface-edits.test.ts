// Which SURFACES elements a `surfaces.ts` diff edits (issue #4687). The source
// is a fixture shaped like the real file: helpers above, the array, a table
// below. Diffs are real `git diff -U0` output, produced from two fixture
// versions so the hunk arithmetic is checked against git, never hand-written.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
    classifySurfaceEdits,
    parseSurfaceElements,
} from "../lib/ui-surface-edits";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-surface-edits-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function element(id: string, body = "route: `/x`"): string {
    return [
        "    {",
        `        id: "${id}",`,
        `        // ${body}`,
        "        entries: [],",
        "    },",
    ].join("\n");
}

function source(opts: {
    helper?: string;
    elements: string[];
    table?: string;
}): string {
    return [
        `const HELPER = "${opts.helper ?? "a"}";`,
        "",
        "export const SURFACES: readonly Surface[] = [",
        opts.elements.join("\n"),
        "];",
        "",
        `export const TABLE = "${opts.table ?? "t"}";`,
        "",
    ].join("\n");
}

/** `git diff -U0` between two versions of the same file. */
function diffOf(before: string, after: string): string {
    const a = path.join(dir, "before.ts");
    const b = path.join(dir, "after.ts");
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    try {
        execFileSync("git", ["diff", "--no-index", "-U0", "--no-color", a, b], {
            encoding: "utf8",
        });
        return "";
    } catch (err) {
        // `--no-index` exits 1 when the files differ; the diff is on stdout.
        return (err as { stdout: string }).stdout;
    }
}

const BASE = ["one", "two", "three"].map((id) => element(id));

function classify(after: string, before = source({ elements: BASE })) {
    return classifySurfaceEdits(after, diffOf(before, after));
}

describe("parseSurfaceElements", () => {
    it("reads every element with its id and span", () => {
        const parsed = parseSurfaceElements(source({ elements: BASE }));
        expect(parsed?.elements.map((e) => e.id)).toEqual([
            "one",
            "two",
            "three",
        ]);
        expect(parsed?.elements[0]).toMatchObject({ start: 4, end: 8 });
    });

    it("refuses a source with no SURFACES array", () => {
        expect(parseSurfaceElements("export const X = [];\n")).toBeNull();
    });

    it("refuses an element with no id", () => {
        const noId = source({
            elements: ["    {", "        entries: [],", "    },"],
        });
        expect(parseSurfaceElements(noId)).toBeNull();
    });
});

describe("classifySurfaceEdits", () => {
    it("an edit inside one element selects that surface alone", () => {
        const after = source({
            elements: [BASE[0], element("two", "changed"), BASE[2]],
        });
        expect(classify(after)).toEqual({ kind: "surfaces", ids: ["two"] });
    });

    it("an appended element selects the new surface alone", () => {
        const after = source({ elements: [...BASE, element("four")] });
        expect(classify(after)).toEqual({ kind: "surfaces", ids: ["four"] });
    });

    it("edits in two elements select both", () => {
        const after = source({
            elements: [element("one", "x"), BASE[1], element("three", "y")],
        });
        expect(classify(after)).toEqual({
            kind: "surfaces",
            ids: ["one", "three"],
        });
    });

    it("a line deleted inside an element selects that element", () => {
        const trimmed = element("two").replace("        // route: `/x`\n", "");
        const after = source({ elements: [BASE[0], trimmed, BASE[2]] });
        expect(classify(after)).toEqual({ kind: "surfaces", ids: ["two"] });
    });

    it("a shared helper above the array is shared machinery", () => {
        const after = source({ elements: BASE, helper: "b" });
        expect(classify(after)).toMatchObject({
            kind: "shared",
            reason: expect.stringContaining("outside the SURFACES array"),
        });
    });

    it("a table below the array is shared machinery", () => {
        const after = source({ elements: BASE, table: "u" });
        expect(classify(after).kind).toBe("shared");
    });

    it("an edit in a surface AND in a helper is shared, not the surface", () => {
        const after = source({
            elements: [element("one", "x"), BASE[1], BASE[2]],
            helper: "b",
        });
        expect(classify(after).kind).toBe("shared");
    });

    it("removing a whole element is shared: retiring a surface is not a narrowing", () => {
        const after = source({ elements: [BASE[0], BASE[2]] });
        expect(classify(after).kind).toBe("shared");
    });

    it("a code line between elements is shared", () => {
        const after = source({
            elements: [BASE[0], "    helperCall(),", BASE[1], BASE[2]],
        });
        expect(classify(after).kind).toBe("shared");
    });

    it("a comment between elements moves nothing", () => {
        const after = source({
            elements: [BASE[0], "    // a note", BASE[1], BASE[2]],
        });
        expect(classify(after)).toEqual({ kind: "surfaces", ids: [] });
    });

    it("an unparseable source is shared", () => {
        expect(
            classifySurfaceEdits("nothing here\n", "@@ -1 +1 @@\n-a\n+b\n")
        ).toMatchObject({ kind: "shared" });
    });
});
