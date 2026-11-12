// A stylesheet diff confined to class rules selects only the surfaces whose
// closure holds a module writing those classes (issue #9295, owner ruling);
// anything else keeps the stylesheet global — fail-closed.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import { computeUiScope, type ScopeSurface } from "../lib/ui-scope";
import {
    classOwners,
    selectorClasses,
    stylesheetConfinement,
    zeroContextLines,
} from "../lib/ui-stylesheet-scope";

const SHEET = [
    /* 1 */ ":root {",
    /* 2 */ "    --x: 1;",
    /* 3 */ "}",
    /* 4 */ "/* ── Frame ──",
    /* 5 */ " * prose */",
    /* 6 */ ".frame-half {",
    /* 7 */ "    border: 3px solid red;",
    /* 8 */ "}",
    /* 9 */ ".frame-half-mine,",
    /* 10 */ ".frame-half-mine:hover::after {",
    /* 11 */ "    bottom: 0;",
    /* 12 */ "}",
    /* 13 */ "@keyframes frame-pulse {",
    /* 14 */ "    50% {",
    /* 15 */ "        opacity: 0.8;",
    /* 16 */ "    }",
    /* 17 */ "}",
    /* 18 */ "@media (prefers-reduced-motion: no-preference) {",
    /* 19 */ "    .frame-half-mine {",
    /* 20 */ "        animation: frame-pulse 1s infinite;",
    /* 21 */ "    }",
    /* 22 */ "}",
    /* 23 */ "body {",
    /* 24 */ "    margin: 0;",
    /* 25 */ "}",
    /* 26 */ "@keyframes body-fade {",
    /* 27 */ "    to { opacity: 0; }",
    /* 28 */ "}",
    /* 29 */ "html { animation: body-fade 1s; }",
    /* 30 */ "",
].join("\n");

const confine = (added: number[], removed: number[] = []) =>
    stylesheetConfinement({ before: SHEET, after: SHEET, added, removed });
const sorted = (s: Set<string> | undefined) => [...(s ?? [])].sort();

describe("stylesheetConfinement (issue #9295)", () => {
    it("a declaration inside a class rule is confined to that rule's classes", () => {
        const c = confine([7]);
        expect(sorted(c?.classes)).toEqual(["frame-half"]);
    });

    it("a selector list with pseudo-classes and pseudo-elements keeps its classes", () => {
        expect(sorted(confine([11])?.classes)).toEqual(["frame-half-mine"]);
    });

    it("a rule under @media is confined like the bare rule", () => {
        expect(sorted(confine([20])?.classes)).toEqual(["frame-half-mine"]);
    });

    it("a keyframes step is confined to the class rules that name it, plus its name", () => {
        const c = confine([15]);
        expect(sorted(c?.classes)).toEqual(["frame-half-mine"]);
        expect(sorted(c?.keyframes)).toEqual(["frame-pulse"]);
    });

    it("comment and blank lines confine nothing and move nothing", () => {
        expect(sorted(confine([4, 5, 30])?.classes)).toEqual([]);
    });

    it("a removed line is read in the OLD sheet", () => {
        const before = SHEET;
        const after = "";
        expect(
            sorted(
                stylesheetConfinement({
                    before,
                    after,
                    removed: [7],
                    added: [],
                })?.classes
            )
        ).toEqual(["frame-half"]);
    });

    it.each([
        [2, ":root"],
        [24, "a type selector"],
        [27, "keyframes a type-selector rule names"],
        [18, "the @media prelude itself"],
    ])("line %i stays global (%s)", (line) => {
        expect(confine([line])).toBeNull();
    });

    it("unbalanced braces stay global", () => {
        expect(
            stylesheetConfinement({
                before: "",
                after: ".a {",
                removed: [],
                added: [1],
            })
        ).toBeNull();
    });
});

describe("selectorClasses", () => {
    it.each([
        [".a", ["a"]],
        [".a.b > .c ~ .d + .e", ["a", "b", "c", "d", "e"]],
        [".a:not(.b)[data-x='1']::before", ["a", "b"]],
    ])("%s → %j", (sel, classes) => {
        expect(sorted(selectorClasses(sel) ?? undefined)).toEqual(classes);
    });

    it.each(["*", "div.a", ".a &", ":root", ".a, body", "#id"])(
        "%s is not class-confined",
        (sel) => {
            expect(selectorClasses(sel)).toBeNull();
        }
    );
});

describe("classOwners", () => {
    const files = new Map([
        ["src/a.tsx", `<div className="frame-half frame-half-mine" />`],
        ["src/b.tsx", "const c = `frame-${seat}`;"],
        ["src/c.tsx", `<div className="frame-halfway" />`],
        ["src/d.tsx", `style={{ animation: "frame-pulse 1s" }}`],
    ]);

    it("whole tokens and template prefixes own a class; a longer token does not", () => {
        expect(
            classOwners(
                { classes: new Set(["frame-half"]), keyframes: new Set() },
                files
            )
        ).toEqual(["src/a.tsx", "src/b.tsx"]);
    });

    it("a module writing a keyframes name inline owns it", () => {
        expect(
            classOwners(
                { classes: new Set(), keyframes: new Set(["frame-pulse"]) },
                files
            )
        ).toEqual(["src/b.tsx", "src/d.tsx"]);
    });

    it("a class nothing names is dead: no owner", () => {
        expect(
            classOwners(
                { classes: new Set(["gone"]), keyframes: new Set() },
                files
            )
        ).toEqual([]);
    });
});

describe("zeroContextLines", () => {
    it("reads -U0 hunk headers, a missing count meaning one line", () => {
        const diff = [
            "@@ -3 +3 @@",
            "-a",
            "+b",
            "@@ -10,2 +9,0 @@",
            "@@ -20,0 +18,3 @@",
        ].join("\n");
        expect(zeroContextLines(diff)).toEqual({
            removed: [3, 10, 11],
            added: [3, 18, 19, 20],
        });
    });
});

describe("computeUiScope — a class-confined stylesheet (issue #9295)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-css-scope-"));
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
    const FILES: Record<string, string> = {
        "src/index.css": SHEET,
        "src/main.tsx": `import "./index.css";\nimport { Header } from "./header";\nimport { router } from "./router";\n`,
        "src/header.tsx": `export const Header = 1;\n`,
        "src/router.tsx": `import Lobby from "./routes/lobby.route";\nimport Game from "./routes/game.route";\nimport Orphan from "./routes/orphan.route";\n`,
        "src/routes/lobby.route.tsx": `export default 1;\n`,
        "src/routes/game.route.tsx": `import { Frame } from "~/frame";\n`,
        "src/routes/orphan.route.tsx": `import { Lost } from "~/lost";\n`,
        "src/frame.tsx": `export const Frame = 1;\n`,
        "src/lost.tsx": `export const Lost = 1;\n`,
    };
    for (const [rel, body] of Object.entries(FILES)) {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    const SURFACES: ScopeSurface[] = [
        { id: "lobby", entries: ["src/routes/lobby.route.tsx"] },
        { id: "game", entries: ["src/routes/game.route.tsx"] },
    ];
    const scope = (owners: Map<string, string[]> = new Map()) =>
        computeUiScope({
            changed: ["src/index.css"],
            surfaces: SURFACES,
            graph: createImportGraph({ root }),
            additiveRegistrations: new Set(),
            stylesheetOwners: owners,
        });

    it("an unconfined stylesheet stays full", () => {
        expect(scope()).toMatchObject({ kind: "full" });
    });

    it("selects exactly the surfaces whose closure holds an owner", () => {
        expect(scope(new Map([["src/index.css", ["src/frame.tsx"]]]))).toEqual({
            kind: "scoped",
            surfaces: ["game"],
        });
    });

    it("a class with no owner selects nothing", () => {
        expect(scope(new Map([["src/index.css", []]]))).toEqual({
            kind: "scoped",
            surfaces: [],
        });
    });

    it("an owner in the app shell forces full", () => {
        expect(
            scope(new Map([["src/index.css", ["src/header.tsx"]]]))
        ).toMatchObject({ kind: "full" });
    });

    it("an owner no surface walks is a doubt", () => {
        expect(
            scope(new Map([["src/index.css", ["src/lost.tsx"]]]))
        ).toMatchObject({ kind: "undecided" });
    });
});
