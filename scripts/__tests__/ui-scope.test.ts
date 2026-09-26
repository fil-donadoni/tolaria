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
        `import AppShell from "./components/chrome/app-shell";`,
    ].join("\n"),
    "src/components/chrome/app-shell.tsx": `import { NavLink } from "./nav-link";\n`,
    "src/components/chrome/nav-link.tsx": `export const NavLink = 1;\n`,
    // The primitive, the token source and the route-local stylesheet are
    // imported by a ROUTE only, never by the shell — so each forces full
    // through its own rule, and removing that rule would scope it to `lobby`.
    "src/components/ui/button.tsx": `export const Button = 1;\n`,
    "src/routes/lobby.route.tsx": `import { Button } from "~/components/ui/button";\nimport { TOKENS } from "~/lib/design-tokens";\nimport { DeckShelf } from "~/components/deck-shelf";\nimport { Card } from "~/components/card";\n`,
    "src/routes/game.route.tsx": `import { Card } from "~/components/card";\nconst quiz = () => import("~/components/debug/quiz");\n`,
    "src/components/deck-shelf.tsx": `import "./deck-shelf.css";\nexport const DeckShelf = 1;\n`,
    "src/components/deck-shelf.css": `.shelf{}`,
    "src/components/card.tsx": `export const Card = 1;\n`,
    "src/components/debug/quiz.tsx": `export default 1;\n`,
    "src/components/dead-code.tsx": `export const Dead = 1;\n`,
};
for (const [rel, body] of Object.entries(FILES)) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
}

const SURFACES: ScopeSurface[] = [
    { id: "lobby", entries: ["src/routes/lobby.route.tsx"] },
    { id: "game-board", entries: ["src/routes/game.route.tsx"] },
    { id: "game-debug", entries: ["src/routes/game.route.tsx"] },
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

    it("a module reached only through a literal dynamic import selects its route", () => {
        expect(scopeOf("src/components/debug/quiz.tsx")).toEqual({
            kind: "scoped",
            surfaces: ["game-board", "game-debug"],
        });
    });

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

    it("a component the shell imports selects full, though no rule names it", () => {
        const scope = scopeOf("src/components/chrome/nav-link.tsx");
        expect(scope.kind).toBe("full");
        expect(scope.kind === "full" && scope.reason).toContain("app shell");
    });

    it("an unplaced path selects full", () => {
        for (const unplaced of [
            "src/components/dead-code.tsx",
            "convex/game.ts",
            "src/components/deleted-since-base.tsx",
        ]) {
            const scope = scopeOf(unplaced);
            expect(scope, unplaced).toEqual({
                kind: "full",
                reason: `${unplaced} is in no surface's entry closure and no rule places it`,
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
