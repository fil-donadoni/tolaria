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
afterAll(() =>
    fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    })
);

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
    it("a comment line between elements that carries code after `*/` is shared, not inert (review of issue #4687)", () => {
        const after = source({
            elements: [
                BASE[0],
                "    /* x */ ...EXTRA_SURFACES,",
                BASE[1],
                BASE[2],
            ],
        });
        expect(classify(after)).toMatchObject({ kind: "shared" });
    });

    it("a block-comment closing line is inert; one with code after it is not", () => {
        const inert = source({
            elements: [
                BASE[0],
                "    /*",
                "     * note",
                "     */",
                BASE[1],
                BASE[2],
            ],
        });
        expect(classify(inert)).toEqual({ kind: "surfaces", ids: [] });
        const code = source({
            elements: [BASE[0], "    */ ...EXTRA_SURFACES,", BASE[1], BASE[2]],
        });
        expect(classify(code)).toMatchObject({ kind: "shared" });
    });

    it("a listed file with no hunks at all is shared — the diff was read from the wrong tree", () => {
        expect(
            classifySurfaceEdits(source({ elements: BASE }), "")
        ).toMatchObject({ kind: "shared" });
    });

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

// Specimen tables (issue #9226): a `*_SPECIMENS` row becomes ONE surface,
// `<SECTION.idPrefix>-<slug>`, through a `dialogSpecimenSurface` spread in
// the array. The fixture mirrors that shape: section, table, spread.
function specimen(slug: string, body = "label"): string {
    return [
        "    {",
        `        slug: "${slug}",`,
        `        // ${body}`,
        "        module: `x.tsx`,",
        `        layer: "[data-${slug}]",`,
        "    },",
    ].join("\n");
}

const SPECIMENS = ["alpha", "beta"].map((slug) => specimen(slug));

function specimenSource(opts: {
    rows?: string[];
    prefix?: string;
    spread?: boolean;
    /** Lines that read the table across rows, after it (`SPECIMEN_LAYERS`). */
    crossRead?: string[];
}): string {
    const spread =
        opts.spread === false
            ? []
            : [
                  "    ...BOARD_SPECIMENS.map((spec) =>",
                  "        dialogSpecimenSurface(BOARD_SECTION, spec)",
                  "    ),",
              ];
    return [
        "const BOARD_SECTION: DialogSpecimenSection = {",
        `    idPrefix: "${opts.prefix ?? "dlg"}",`,
        '    seam: "data-board",',
        "};",
        "",
        "const BOARD_SPECIMENS: readonly DialogSpecimen[] = [",
        (opts.rows ?? SPECIMENS).join("\n"),
        "];",
        "",
        ...(opts.crossRead ?? []),
        "export const SURFACES: readonly Surface[] = [",
        BASE.join("\n"),
        ...spread,
        "];",
        "",
    ].join("\n");
}

describe("classifySurfaceEdits — specimen tables (issue #9226)", () => {
    const before = specimenSource({});

    it("an edit inside a specimen row selects `<idPrefix>-<slug>` alone", () => {
        const after = specimenSource({
            rows: [SPECIMENS[0], specimen("beta", "cards: true")],
        });
        expect(classify(after, before)).toEqual({
            kind: "surfaces",
            ids: ["dlg-beta"],
        });
    });

    it("the section's idPrefix names the surface", () => {
        const b = specimenSource({ prefix: "pick" });
        const after = specimenSource({
            prefix: "pick",
            rows: [specimen("alpha", "x"), SPECIMENS[1]],
        });
        expect(classify(after, b)).toEqual({
            kind: "surfaces",
            ids: ["pick-alpha"],
        });
    });

    it("a specimen row AND a SURFACES element select both", () => {
        const after = specimenSource({
            rows: [specimen("alpha", "x"), SPECIMENS[1]],
        }).replace(element("two"), element("two", "y"));
        expect(classify(after, before)).toEqual({
            kind: "surfaces",
            ids: ["dlg-alpha", "two"],
        });
    });

    it("a table no spread maps into SURFACES stays shared", () => {
        const b = specimenSource({ spread: false });
        const after = specimenSource({
            spread: false,
            rows: [specimen("alpha", "x"), SPECIMENS[1]],
        });
        expect(classify(after, b)).toMatchObject({ kind: "shared" });
    });

    it("a section whose idPrefix cannot be read stays shared", () => {
        const noPrefix = (src: string) =>
            src.replace('    idPrefix: "dlg",\n', "");
        const after = specimenSource({
            rows: [specimen("alpha", "x"), SPECIMENS[1]],
        });
        expect(classify(noPrefix(after), noPrefix(before))).toMatchObject({
            kind: "shared",
        });
    });

    it("a table with a row that has no slug stays shared", () => {
        const noSlug = ["    {", "        // no slug", "    },"].join("\n");
        const b = specimenSource({ rows: [...SPECIMENS, noSlug] });
        const after = specimenSource({
            rows: [specimen("alpha", "x"), SPECIMENS[1], noSlug],
        });
        expect(classify(after, b)).toMatchObject({ kind: "shared" });
    });

    it("an edit to the section constant stays shared", () => {
        const after = specimenSource({}).replace("data-board", "data-other");
        expect(classify(after, before)).toMatchObject({ kind: "shared" });
    });

    it("removing a whole specimen row is shared", () => {
        const after = specimenSource({ rows: [SPECIMENS[0]] });
        expect(classify(after, before)).toMatchObject({ kind: "shared" });
    });

    const LAYERS = [
        "const SPECIMEN_LAYERS = specimenLayerSelector([",
        "    ...[",
        "        ...BOARD_SPECIMENS,",
        "    ].map((s) => s.layer),",
        "]);",
        "",
    ];

    it("a row field another reader spreads across rows is shared (review of issue #9226)", () => {
        const b = specimenSource({ crossRead: LAYERS });
        const after = specimenSource({
            crossRead: LAYERS,
            rows: [
                SPECIMENS[0],
                specimen("beta").replace("[data-beta]", "[x]"),
            ],
        });
        expect(classify(after, b)).toMatchObject({
            kind: "shared",
            reason: expect.stringContaining("`layer`"),
        });
    });

    it("a field no cross-row reader reads still narrows beside one", () => {
        const b = specimenSource({ crossRead: LAYERS });
        const after = specimenSource({
            crossRead: LAYERS,
            rows: [SPECIMENS[0], specimen("beta", "cards: true")],
        });
        expect(classify(after, b)).toEqual({
            kind: "surfaces",
            ids: ["dlg-beta"],
        });
    });

    it("a table referenced in any other shape stays shared", () => {
        const other = ["const N = BOARD_SPECIMENS.length;", ""];
        const b = specimenSource({ crossRead: other });
        const after = specimenSource({
            crossRead: other,
            rows: [SPECIMENS[0], specimen("beta", "cards: true")],
        });
        expect(classify(after, b)).toMatchObject({ kind: "shared" });
    });
});
