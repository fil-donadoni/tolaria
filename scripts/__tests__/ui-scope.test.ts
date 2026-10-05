// Which `check:ui` surfaces a diff selects (issue #3627). Fixture tree shaped
// like the app: a shell (`src/main.tsx` → router → route modules), shared UI
// primitives, a stylesheet, and components only some routes import. Mirrors
// `check-lane.test.ts`'s fail-closed cases: "unknown" must mean full.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createImportGraph } from "../lib/import-graph";
import {
    computeUiScope,
    isStaffOnlyRouteEntry,
    renderUiScope,
    type ScopeSurface,
} from "../lib/ui-scope";
import type { SurfaceEdits } from "../lib/ui-surface-edits";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-scope-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const FILES: Record<string, string> = {
    "index.html": `<div id="root"></div>`,
    "vite.config.ts": `import { buildDefine } from "./scripts/lib/build-define";\n`,
    "scripts/lib/build-define.ts": `export const buildDefine = () => ({});\n`,
    "public/img/logo.svg": `<svg/>`,
    "src/index.css": `:root{}`,
    "src/lib/design-tokens.ts": `export const TOKENS = {};\n`,
    "src/main.tsx": `import "./index.css";\nimport { AppRouter } from "./app-router";\n`,
    "src/app-router.tsx": `import { router } from "./router";\n`,
    "src/router.tsx": [
        `import Lobby from "./routes/lobby.route";`,
        `import Game from "./routes/game.route";`,
        `import Census from "./routes/census.route";`,
        `import Orphan from "./routes/orphan.route";`,
        `import AdminPanel from "./routes/admin/admin-panel.route";`,
        `import DraftLab from "./routes/draft-lab.route";`,
        `import AppShell from "./components/chrome/app-shell";`,
    ].join("\n"),
    "src/components/chrome/app-shell.tsx": `import { NavLink } from "./nav-link";\n`,
    "src/components/chrome/nav-link.tsx": `export const NavLink = 1;\n`,
    // The primitive, the token source and the route-local stylesheet are
    // imported by a ROUTE only, never by the shell — so each forces full
    // through its own rule, and removing that rule would scope it to `lobby`.
    "src/components/ui/button.tsx": `export const Button = 1;\n`,
    "src/routes/lobby.route.tsx": `import { Button } from "~/components/ui/button";\nimport { TOKENS } from "~/lib/design-tokens";\nimport { DeckShelf } from "~/components/deck-shelf";\nimport { Card } from "~/components/card";\nimport type { Shape } from "~/components/shape";\n`,
    "src/routes/game.route.tsx": `import { Card } from "~/components/card";\nimport { PauseDialog } from "~/components/dialogs/pause";\nconst quiz = () => import("~/components/debug/quiz");\n`,
    // A route the router mounts and NO surface declares: whatever it renders
    // is reachable at runtime, and nothing walks it.
    "src/routes/orphan.route.tsx": `import { Widget } from "~/components/orphan-widget";\n`,
    "src/components/orphan-widget.tsx": `export const Widget = 1;\n`,
    // Staff-only pages (the admin layout's, plus Draft Lab): mounted by the
    // router, declared by NO surface. `admin-widget` is theirs alone;
    // `deck-shelf` is shared with the lobby, `admin-tool` is shared by both
    // staff pages, and `admin-shape` is named only through a type import.
    "src/routes/admin/admin-panel.route.tsx": `import { AdminWidget } from "~/components/admin/admin-widget";\nimport { Tool } from "~/components/admin/admin-tool";\nimport { DeckShelf } from "~/components/deck-shelf";\nimport type { AdminShape } from "~/components/admin/admin-shape";\n`,
    "src/routes/draft-lab.route.tsx": `import { Tool } from "~/components/admin/admin-tool";\n`,
    "src/components/admin/admin-widget.tsx": `export const AdminWidget = 1;\n`,
    "src/components/admin/admin-tool.tsx": `export const Tool = 1;\n`,
    "src/components/admin/admin-shape.ts": `export type AdminShape = 1;\n`,
    // Named by the lobby in a type-only statement and by nothing at runtime:
    // the build erases the edge, so no screen runs its code.
    "src/components/shape.ts": `export type Shape = 1;\n`,
    // A census page (`/admin/design-system` in the app) that mounts dialog
    // specimens one at a time behind openers, in two sections: the page's own
    // frame (`lib`), a section with two rows and a fixture module, a section
    // with one row. The pause dialog is also a board dialog the game renders.
    "src/routes/census.route.tsx": `import { Frame } from "./census/lib";\nimport { SectionA } from "./census/section-a";\nimport { SectionB } from "./census/section-b";\n`,
    "src/routes/census/lib.tsx": `export const Frame = 1;\n`,
    "src/routes/census/section-a.tsx": `import { Frame } from "./lib";\nimport { FIXTURES } from "./fixtures-a";\nimport { PauseDialog } from "~/components/dialogs/pause";\nimport { ConcedeDialog } from "~/components/dialogs/concede";\n`,
    "src/routes/census/fixtures-a.ts": `export const FIXTURES = [];\n`,
    "src/routes/census/section-b.tsx": `import { Frame } from "./lib";\nimport { ReportDialog } from "~/components/dialogs/report";\n`,
    "src/components/dialogs/pause.tsx": `import { PauseBody } from "./pause-body";\nexport const PauseDialog = 1;\n`,
    "src/components/dialogs/pause-body.tsx": `export const PauseBody = 1;\n`,
    "src/components/dialogs/concede.tsx": `export const ConcedeDialog = 1;\n`,
    "src/components/dialogs/report.tsx": `export const ReportDialog = 1;\n`,
    "src/components/deck-shelf.tsx": `import "./deck-shelf.css";\nexport const DeckShelf = 1;\n`,
    "src/components/deck-shelf.css": `.shelf{}`,
    "src/components/card.tsx": `import { rank } from "../../convex/gre/pure-rank";\nexport const Card = 1;\n`,
    // `convex/**` the frontend imports (a pure engine module, ADR 0074) sits
    // in a surface closure; the mutation and the data file nothing imports
    // are server-only.
    "convex/gre/pure-rank.ts": `export const rank = 1;\n`,
    "convex/game.ts": `export const play = 1;\n`,
    "data/cards.json": `{}`,
    "src/components/debug/quiz.tsx": `export default 1;\n`,
    "src/components/dead-code.tsx": `export const Dead = 1;\n`,
};
for (const [rel, body] of Object.entries(FILES)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
}

const CENSUS = "src/routes/census.route.tsx";
const SECTION_A = "src/routes/census/section-a.tsx";
const SECTION_B = "src/routes/census/section-b.tsx";
const SURFACES: ScopeSurface[] = [
    { id: "lobby", entries: ["src/routes/lobby.route.tsx"] },
    { id: "game-board", entries: ["src/routes/game.route.tsx"] },
    { id: "game-debug", entries: ["src/routes/game.route.tsx"] },
    { id: "census", entries: [CENSUS] },
    {
        id: "dlg-pause",
        entries: [CENSUS],
        mounts: ["src/components/dialogs/pause.tsx"],
        specimen: { section: SECTION_A },
    },
    {
        id: "dlg-concede",
        entries: [CENSUS],
        mounts: ["src/components/dialogs/concede.tsx"],
        specimen: { section: SECTION_A },
    },
    {
        id: "dlg-report",
        entries: [CENSUS],
        mounts: ["src/components/dialogs/report.tsx"],
        specimen: { section: SECTION_B },
    },
];

function scopeOf(...changed: string[]) {
    return computeUiScope({
        changed,
        surfaces: SURFACES,
        graph: createImportGraph({ root }),
    });
}

describe("computeUiScope — scoped", () => {
    it("an isolated component selects only the routes importing it", () => {
        expect(scopeOf("src/components/deck-shelf.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["lobby"],
        });
    });

    it("a component two routes import selects both, in table order", () => {
        expect(scopeOf("src/components/card.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["lobby", "game-board", "game-debug"],
        });
    });

    it("a module a route names only in a type-only import selects nothing — the build erases the edge (issue #4913)", () => {
        expect(scopeOf("src/components/shape.ts")).toEqual({
            kind: "scoped",
            surfaces: [],
        });
    });

    it("a module reached only through a literal dynamic import selects its route", () => {
        expect(scopeOf("src/components/debug/quiz.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["game-board", "game-debug"],
        });
    });

    it("a server-only convex module beside a component selects exactly the component's surfaces (issue #5074)", () => {
        expect(
            scopeOf("convex/game.ts", "src/components/deck-shelf.tsx")
        ).toEqual({ kind: "scoped", surfaces: ["lobby"] });
    });

    it("a convex module a surface's closure imports still selects that surface (issue #5074)", () => {
        expect(scopeOf("convex/gre/pure-rank.ts")).toEqual({
            kind: "scoped",
            surfaces: ["lobby", "game-board", "game-debug"],
        });
    });

    it("a diff of only server-only convex/data paths owes no browser time (issue #5074)", () => {
        expect(
            scopeOf("convex/game.ts", "convex/schema.ts", "data/cards.json")
        ).toEqual({ kind: "scoped", surfaces: [] });
    });

    it("convex/_generated keeps its placement — never server-only (issue #5074)", () => {
        expect(scopeOf("convex/_generated/api.d.ts")).toEqual({
            kind: "full",
            reason: "convex/_generated/api.d.ts is in no surface's closure and no rule places it",
        });
    });

    it.each([
        "data/catalogue/catalogue-abc.json",
        "data/full-catalogue/full-catalogue-abc.json.gz",
    ])(
        "%s is loaded by the client through import.meta.glob — never server-only (issue #5074 review)",
        (artifact) => {
            expect(scopeOf(artifact)).toEqual({
                kind: "full",
                reason: `${artifact} is in no surface's closure and no rule places it`,
            });
        }
    );

    it("a test-only diff selects nothing", () => {
        expect(
            scopeOf(
                "src/components/__tests__/card.test.tsx",
                "src/lib/ai/brain.bot.test.ts",
                "scripts/check-lane.ts",
                "docs/guides/ui-runbooks.md"
            )
        ).toEqual({ kind: "scoped", surfaces: [] });
    });

    it("an empty diff selects nothing", () => {
        expect(scopeOf()).toEqual({ kind: "scoped", surfaces: [] });
    });
});

describe("computeUiScope — staff-only routes (issue #5075)", () => {
    it("a module only a staff-only page imports contributes nothing — not full", () => {
        for (const path of [
            "src/routes/admin/admin-panel.route.tsx",
            "src/routes/draft-lab.route.tsx",
            "src/components/admin/admin-widget.tsx",
            "src/components/admin/admin-tool.tsx",
            "src/components/admin/admin-shape.ts",
        ]) {
            expect(scopeOf(path), path).toEqual({
                kind: "scoped",
                surfaces: [],
            });
        }
    });

    it("a module shared by a staff-only page and a product surface selects the product surface", () => {
        expect(scopeOf("src/components/deck-shelf.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["lobby"],
        });
    });

    it("a staff-only module beside a product component selects exactly the product surfaces", () => {
        expect(
            scopeOf(
                "src/components/admin/admin-widget.tsx",
                "src/components/dialogs/pause-body.tsx"
            )
        ).toEqual({
            kind: "scoped",
            surfaces: ["game-board", "game-debug", "census", "dlg-pause"],
        });
    });

    it("the rule places a module only the staff-only pages reach — an unrelated orphan route's module still selects full", () => {
        expect(scopeOf("src/components/orphan-widget.tsx").kind).toBe("full");
    });
});

describe("computeUiScope — specimen rows (issue #4913)", () => {
    it("a row's mount selects that row and the route surfaces whose closure holds it — never its sibling rows", () => {
        // `pause-body` is reached only through the pause dialog: the game
        // route renders that dialog, the census page imports it for § A, and
        // § A's other row (concede) and § B's row never mount it.
        expect(scopeOf("src/components/dialogs/pause-body.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["game-board", "game-debug", "census", "dlg-pause"],
        });
    });

    it("a sibling row's mount is not a section's scaffolding", () => {
        expect(scopeOf("src/components/dialogs/concede.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["census", "dlg-concede"],
        });
    });

    it("a section's own module (openers, fixture props) selects every row of that section and none of another's", () => {
        expect(scopeOf("src/routes/census/fixtures-a.ts")).toEqual({
            kind: "scoped",
            surfaces: ["census", "dlg-pause", "dlg-concede"],
        });
        expect(scopeOf(SECTION_B)).toEqual({
            kind: "scoped",
            surfaces: ["census", "dlg-report"],
        });
    });

    it("the page's shared scaffolding still selects every row", () => {
        expect(scopeOf("src/routes/census/lib.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["census", "dlg-pause", "dlg-concede", "dlg-report"],
        });
        expect(scopeOf(CENSUS)).toEqual({
            kind: "scoped",
            surfaces: ["census", "dlg-pause", "dlg-concede", "dlg-report"],
        });
    });
});

describe("computeUiScope — full (fail-closed)", () => {
    it.each([
        ["src/components/ui/button.tsx", "a shared UI primitive"],
        ["src/index.css", "a stylesheet"],
        ["src/components/deck-shelf.css", "a stylesheet"],
        ["src/lib/design-tokens.ts", "a design-token source"],
        ["src/main.tsx", "the app shell"],
        ["src/app-router.tsx", "the app shell"],
        ["src/router.tsx", "the router"],
        ["index.html", "the HTML document"],
        ["public/img/logo.svg", "a public asset"],
        ["scripts/ui-gate/surfaces.ts", "the check:ui lane itself"],
        ["scripts/ui-gate/floors.ts", "the check:ui lane itself"],
        ["vite.config.ts", "the build configuration's closure"],
        ["scripts/lib/build-define.ts", "the build configuration's closure"],
    ])("%s selects full (%s)", (changed, reason) => {
        const scope = scopeOf("src/components/deck-shelf.tsx", changed);
        expect(scope.kind).toBe("full");
        expect(scope.kind === "full" && scope.reason).toContain(reason);
    });

    it("a component under a route no surface declares selects full — reachable at runtime, walked by nothing (issue #4913 review)", () => {
        // The type-only rule must not swallow it: the file IS in the
        // type-inclusive closure of the shell (through the router), but it
        // is in the runtime closure too, so nothing about it is erased.
        expect(scopeOf("src/components/orphan-widget.tsx")).toEqual({
            kind: "full",
            reason: "src/components/orphan-widget.tsx is in no surface's closure and no rule places it",
        });
    });

    it("a component the shell imports selects full, though no rule names it", () => {
        const scope = scopeOf("src/components/chrome/nav-link.tsx");
        expect(scope.kind).toBe("full");
        expect(scope.kind === "full" && scope.reason).toContain("app shell");
    });

    it("an unplaced path selects full", () => {
        for (const unplaced of [
            "src/components/dead-code.tsx",
            "tooling/gen.ts",
            "src/components/deleted-since-base.tsx",
        ]) {
            const scope = scopeOf(unplaced);
            expect(scope, unplaced).toEqual({
                kind: "full",
                reason: `${unplaced} is in no surface's closure and no rule places it`,
            });
        }
    });
});

describe("computeUiScope — surfaces.ts edits (issue #4687)", () => {
    const withEdits = (surfaceEdits: SurfaceEdits, ...changed: string[]) =>
        computeUiScope({
            changed,
            surfaces: SURFACES,
            graph: createImportGraph({ root }),
            surfaceEdits,
        });

    it("an edit confined to surface elements selects exactly those surfaces, in table order", () => {
        expect(
            withEdits(
                { kind: "surfaces", ids: ["game-debug", "lobby"] },
                "scripts/ui-gate/surfaces.ts"
            )
        ).toEqual({ kind: "scoped", surfaces: ["lobby", "game-debug"] });
    });

    it("composes with a component diff: the union of both selections", () => {
        expect(
            withEdits(
                { kind: "surfaces", ids: ["game-debug"] },
                "scripts/ui-gate/surfaces.ts",
                "src/components/deck-shelf.tsx"
            )
        ).toEqual({ kind: "scoped", surfaces: ["lobby", "game-debug"] });
    });

    it("a shared-helper edit in surfaces.ts still selects full, and says why", () => {
        const scope = withEdits(
            { kind: "shared", reason: "hunk outside the array" },
            "scripts/ui-gate/surfaces.ts"
        );
        expect(scope.kind).toBe("full");
        expect(scope.kind === "full" && scope.reason).toContain(
            "hunk outside the array"
        );
    });

    it("any OTHER lane file alongside a surface edit forces full", () => {
        const scope = withEdits(
            { kind: "surfaces", ids: ["lobby"] },
            "scripts/ui-gate/surfaces.ts",
            "scripts/ui-gate/probe.js"
        );
        expect(scope.kind).toBe("full");
        expect(scope.kind === "full" && scope.reason).toContain("probe.js");
    });

    it("a surface edit is never honoured for a path other than surfaces.ts", () => {
        expect(
            withEdits(
                { kind: "surfaces", ids: ["lobby"] },
                "scripts/ui-gate/floors.ts"
            ).kind
        ).toBe("full");
    });
});

describe("renderUiScope", () => {
    it("names the base, and the reason when full", () => {
        expect(
            renderUiScope({ kind: "full", reason: "--all" }, "origin/staging")
        ).toBe("scope (diff base origin/staging): FULL — --all");
        expect(
            renderUiScope({ kind: "scoped", surfaces: [] }, "origin/staging")
        ).toContain("SCOPED — 0 surfaces");
        expect(
            renderUiScope(
                { kind: "scoped", surfaces: ["lobby", "game-board"] },
                "origin/staging"
            )
        ).toBe(
            "scope (diff base origin/staging): SCOPED — 2 surface(s)\n  · lobby\n  · game-board"
        );
    });
});

describe("isStaffOnlyRouteEntry (issue #5075)", () => {
    it("takes the admin pages and Draft Lab; never the layout, the design-system page or a product route", () => {
        for (const yes of [
            "src/routes/admin/admin-index.route.tsx",
            "src/routes/admin/admin-verdicts.route.tsx",
            "src/routes/draft-lab.route.tsx",
        ]) {
            expect(isStaffOnlyRouteEntry(yes), yes).toBe(true);
        }
        for (const no of [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/design-system.route.tsx",
            "src/routes/design-system/section-a.tsx",
            "src/routes/lobby.route.tsx",
            "src/routes/admin/nested/x.route.tsx",
        ]) {
            expect(isStaffOnlyRouteEntry(no), no).toBe(false);
        }
    });
});

describe("the real router's admin layout (issue #5075)", () => {
    it("every page mounted under it is staff-only, except the design-system page the lane keeps walking", () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, "../../src/router.tsx"),
            "utf8"
        );
        const blocks = source.split("createRoute({").slice(1);
        const adminPages = blocks
            .filter((b) => /getParentRoute: \(\) => adminRoute\b/.test(b))
            .map((b) => /import\("\.\/(routes\/[^"]+)"\)/.exec(b)?.[1])
            .map((m) => `src/${m}.tsx`);
        expect(adminPages.length).toBeGreaterThan(8);
        const unclassified = adminPages.filter(
            (p) =>
                !isStaffOnlyRouteEntry(p) &&
                p !== "src/routes/design-system.route.tsx"
        );
        expect(
            unclassified,
            `admin-layout pages neither staff-only nor the design-system page: ${unclassified.join(", ")}`
        ).toEqual([]);
    });
});
