import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    classifyPath,
    classifyLane,
    renderPlan,
    type LanePlan,
} from "../check-lane";

/**
 * `bun run check:lane` (issue #2740, parent #2738) — the gate-lane
 * classifier, landing INERT: it decides and prints, it runs nothing.
 *
 * Per repo convention (land.test.ts, ui-gate-budgets.test.ts): the git
 * plumbing stays thin and untested; every DECISION is a pure function tested
 * directly against hand-built path lists, never through a subprocess.
 *
 * The load-bearing property is FAIL-CLOSED: a path no rule recognises must
 * yield `full`. Unknown never means skin.
 */

const ROOT = resolve(__dirname, "..", "..");

function ids(entries: { id: string }[]): string[] {
    return entries.map((e) => e.id);
}

describe("check-lane — path classification (issue #2740)", () => {
    it("classifies src/** as skin", () => {
        expect(classifyPath("src/components/board/Card.tsx")).toBe("skin");
        expect(classifyPath("src/index.css")).toBe("skin");
    });

    it("classifies stylesheets, index.html and static assets as skin", () => {
        expect(classifyPath("index.html")).toBe("skin");
        expect(classifyPath("public/img/symbols/W.svg")).toBe("skin");
        expect(classifyPath("public/manifest.webmanifest")).toBe("skin");
    });

    it("classifies convex/** and scripts/** as engine", () => {
        expect(classifyPath("convex/gre/engine.ts")).toBe("engine");
        expect(classifyPath("scripts/land.ts")).toBe("engine");
    });

    it("classifies shared tooling inputs as full", () => {
        for (const p of [
            "package.json",
            "bun.lock",
            "vitest.config.ts",
            "vitest.blade.config.ts",
            "vite.config.ts",
            "vitest.setup.ts",
            "tsconfig.json",
            "tsconfig.app.json",
            "convex/tsconfig.json",
            "eslint.config.js",
            ".prettierrc",
            "data/cr/comprehensive-rules.txt",
            ".claude/hooks/deny-guard.sh",
        ]) {
            expect(classifyPath(p), p).toBe("full");
        }
    });

    it("FAILS CLOSED: a path matching no rule is full, never skin", () => {
        expect(classifyPath("some/brand/new/top-level/thing.ts")).toBe("full");
        expect(classifyPath("CLAUDE.md")).toBe("full");
        expect(classifyPath("docs/adr/0104-gate-lanes.md")).toBe("full");
        expect(classifyPath(".agents/whatever.md")).toBe("full");
    });
});

describe("check-lane — lane selection, named cases (issue #2740)", () => {
    it("src-only ⇒ skin", () => {
        const plan = classifyLane([
            "src/components/board/Card.tsx",
            "src/index.css",
            "src/components/board/Card.module.css",
        ]);
        expect(plan.lane).toBe("skin");
    });

    it("a new src test file ⇒ skin, and the scripts half of node still runs", () => {
        const plan = classifyLane([
            "src/lib/__tests__/card-utils.test.ts",
            "src/lib/card-utils.ts",
        ]);
        expect(plan.lane).toBe("skin");
        // src-test-env-split.test.ts lives in scripts/** and is the guard
        // against a new src test file being selected by neither vitest
        // project — the skin lane is precisely the lane that adds them.
        expect(ids(plan.run)).toContain("node[src,scripts]");
    });

    it("convex-only ⇒ engine", () => {
        const plan = classifyLane([
            "convex/cards/sets/lea/red.ts",
            "convex/gre/effects/interpreter.ts",
        ]);
        expect(plan.lane).toBe("engine");
    });

    it("scripts-only ⇒ engine", () => {
        expect(classifyLane(["scripts/gate.ts"]).lane).toBe("engine");
    });

    it("mixed src + convex ⇒ full", () => {
        const plan = classifyLane([
            "src/components/board/Card.tsx",
            "convex/gre/engine.ts",
        ]);
        expect(plan.lane).toBe("full");
    });

    it("package.json ⇒ full, even alongside a src-only diff", () => {
        expect(classifyLane(["package.json"]).lane).toBe("full");
        expect(classifyLane(["src/app.tsx", "package.json"]).lane).toBe("full");
    });

    it("vitest.config.ts ⇒ full", () => {
        expect(classifyLane(["vitest.config.ts"]).lane).toBe("full");
        expect(classifyLane(["src/app.tsx", "vitest.config.ts"]).lane).toBe(
            "full"
        );
    });

    it("data/** ⇒ full", () => {
        expect(classifyLane(["data/cr/comprehensive-rules.txt"]).lane).toBe(
            "full"
        );
        expect(
            classifyLane(["convex/gre/engine.ts", "data/cr/VERSION.json"]).lane
        ).toBe("full");
    });

    it("a path matching no rule ⇒ full (fail-closed)", () => {
        expect(classifyLane(["something/nobody/anticipated.txt"]).lane).toBe(
            "full"
        );
        expect(
            classifyLane([
                "src/components/board/Card.tsx",
                "something/nobody/anticipated.txt",
            ]).lane
        ).toBe("full");
    });

    it("empty diff ⇒ full (fail-closed: an empty diff is usually a wrong base ref)", () => {
        const plan = classifyLane([]);
        expect(plan.lane).toBe("full");
        expect(plan.rationale).toMatch(/empty/i);
    });
});

describe("check-lane — the plan object drives both lists (issue #2740)", () => {
    const skin = classifyLane(["src/components/board/Card.tsx"]);
    const engine = classifyLane(["convex/gre/engine.ts"]);
    const full = classifyLane(["package.json"]);

    it("skin runs the app-side checks and skips what a src diff cannot break", () => {
        expect(ids(skin.run)).toEqual([
            "format(diff)",
            "lint(diff)",
            "tsc[app,scripts]",
            "bundle",
            "cr:lint",
            "node[src,scripts]",
            "dom",
        ]);
        expect(ids(skin.skip)).toEqual([
            "tsc[convex,node]",
            "check:index",
            "check:stubs",
            "bot fast lane",
            "node[convex]",
        ]);
    });

    it("engine keeps the WHOLE type-check and drops only dom", () => {
        expect(ids(engine.run)).toEqual([
            "format(diff)",
            "lint(diff)",
            "tsc[all]",
            "check:index",
            "check:stubs",
            "bundle",
            "cr:lint",
            "bot fast lane",
            "node[all]",
        ]);
        expect(ids(engine.skip)).toEqual(["dom"]);
        // src/** imports convex/gre (ADR 0074), so an engine diff CAN break
        // the app project — the whole type-check is one of the three
        // backstops that make dropping `dom` safe (#2738).
        expect(ids(engine.run)).not.toContain("tsc[app,scripts]");
    });

    it("full delegates to check:pr verbatim and skips nothing", () => {
        expect(ids(full.run)).toEqual(["check:pr"]);
        expect(full.skip).toEqual([]);
    });

    it("every skip carries a non-empty reason", () => {
        for (const plan of [skin, engine, full]) {
            for (const s of plan.skip) {
                expect(s.reason.length, s.id).toBeGreaterThan(10);
            }
        }
    });

    it("run and skip lists are disjoint", () => {
        for (const plan of [skin, engine, full]) {
            const run = new Set(ids(plan.run));
            for (const s of plan.skip) expect(run.has(s.id), s.id).toBe(false);
        }
    });
});

describe("check-lane — diff-scoped commands (issue #2740)", () => {
    it("scopes prettier to the formattable paths only", () => {
        const plan = classifyLane([
            "src/app.tsx",
            "src/index.css",
            "public/img/symbols/W.svg",
        ]);
        const format = plan.run.find((c) => c.id === "format(diff)")!;
        expect(format.command).toContain("src/app.tsx");
        expect(format.command).toContain("src/index.css");
        expect(format.command).not.toContain(".svg");
    });

    it("scopes eslint to the lintable paths only", () => {
        const plan = classifyLane(["src/app.tsx", "src/index.css"]);
        const lint = plan.run.find((c) => c.id === "lint(diff)")!;
        expect(lint.command).toContain("src/app.tsx");
        expect(lint.command).not.toContain("src/index.css");
    });

    it("quotes paths so a filename with a space or a non-ASCII char survives", () => {
        const plan = classifyLane(["src/a b/Card.tsx"]);
        const format = plan.run.find((c) => c.id === "format(diff)")!;
        expect(format.command).toContain("'src/a b/Card.tsx'");
    });

    it("drops a diff-scoped check to the skip list when the diff has no such file", () => {
        const plan = classifyLane(["public/img/symbols/W.svg"]);
        expect(ids(plan.run)).not.toContain("lint(diff)");
        expect(ids(plan.run)).not.toContain("format(diff)");
        expect(ids(plan.skip)).toContain("lint(diff)");
        expect(ids(plan.skip)).toContain("format(diff)");
    });

    it("uses the present-paths list, so a deleted file is classified but never handed to prettier", () => {
        const plan = classifyLane(
            ["src/gone.tsx", "src/kept.tsx"],
            ["src/kept.tsx"]
        );
        expect(plan.lane).toBe("skin");
        const format = plan.run.find((c) => c.id === "format(diff)")!;
        expect(format.command).toContain("src/kept.tsx");
        expect(format.command).not.toContain("src/gone.tsx");
    });
});

describe("check-lane — every planned check is invokable today (issue #2740)", () => {
    const pkg = JSON.parse(
        readFileSync(resolve(ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const vitestConfig = readFileSync(
        resolve(ROOT, "vitest.config.ts"),
        "utf8"
    );
    const projects = new Set(
        [...vitestConfig.matchAll(/name:\s*"([a-z-]+)"/g)].map((m) => m[1])
    );

    const plans: LanePlan[] = [
        classifyLane(["src/app.tsx"]),
        classifyLane(["convex/gre/engine.ts"]),
        classifyLane(["package.json"]),
    ];

    /**
     * This slice lands inert, so nothing executes these strings yet — which
     * is exactly why they need a guard. A plan whose names are aspirational
     * is a plan #2741 cannot execute, and the whole point of rendering the
     * receipt from the plan object is that it can never describe a different
     * run from the one that happens.
     */
    it("every `bun run X` names a real package.json script", () => {
        for (const plan of plans) {
            for (const check of plan.run) {
                for (const [, script] of check.command.matchAll(
                    /bun run ([a-z:]+)/g
                )) {
                    expect(
                        pkg.scripts,
                        `${check.id}: ${script}`
                    ).toHaveProperty(script);
                }
            }
        }
    });

    it("every `--project X` names a real vitest project", () => {
        expect(projects).toContain("node");
        for (const plan of plans) {
            for (const check of plan.run) {
                for (const [, project] of check.command.matchAll(
                    /--project ([a-z-]+)/g
                )) {
                    expect([...projects], `${check.id}: ${project}`).toContain(
                        project
                    );
                }
            }
        }
    });

    it("every tsc project path named by the type-check exists", () => {
        const skin = classifyLane(["src/app.tsx"]);
        const tsc = skin.run.find((c) => c.id === "tsc[app,scripts]")!;
        for (const [, file] of tsc.command.matchAll(
            /(tsconfig[\w.]*\.json)/g
        )) {
            expect(() =>
                readFileSync(resolve(ROOT, file), "utf8")
            ).not.toThrow();
        }
    });
});

describe("check-lane — the printed receipt renders the plan (issue #2740)", () => {
    it("prints the lane, the run list and the skip list with reasons", () => {
        const plan = classifyLane([
            "src/components/board/Card.tsx",
            "src/index.css",
        ]);
        const out = renderPlan(plan, "4f2a91c");

        expect(out).toMatch(/^lane: {2}skin/m);
        expect(out).toContain("4f2a91c");
        expect(out).toContain("2 files");
        for (const c of plan.run) expect(out).toContain(c.id);
        for (const s of plan.skip) {
            expect(out).toContain(s.id);
            expect(out).toContain(s.reason);
        }
        // The receipt must say it ran nothing — this slice is inert.
        expect(out).toMatch(/inert|nothing was run|ran nothing/i);
    });

    it("renders the full lane without an empty skip block", () => {
        const out = renderPlan(classifyLane(["package.json"]), "deadbee");
        expect(out).toMatch(/^lane: {2}full/m);
        expect(out).toContain("check:pr");
        expect(out).not.toMatch(/^skip:/m);
    });
});
