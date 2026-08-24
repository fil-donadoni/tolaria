import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    classifyPath,
    classifyLane,
    renderPlan,
    renderJson,
    runPlan,
    renderReceipt,
    executePlan,
    shellStdio,
    type LanePlan,
    type RunResult,
} from "../check-lane";

/**
 * `bun run check:lane` (issue #2741, wiring execution onto the classifier
 * landed inert in #2740; parent #2738) — the gate-lane classifier AND
 * executor: it decides, prints the plan, then runs it and prints a receipt.
 *
 * Per repo convention (land.test.ts, ui-gate-budgets.test.ts): the git
 * plumbing stays thin and untested; every DECISION is a pure function tested
 * directly against hand-built path lists, never through a subprocess. The
 * "check-lane — execution" describe block below tests `runPlan` the same
 * way, via an injected fake `exec` instead of a real subprocess.
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

    /**
     * Round-1 review finding (#2740). `SKIN_PATTERNS` carried `/\.css$/` and
     * an UNANCHORED asset-extension alternation, and `classifyPath` tests
     * `SKIN_PATTERNS` BEFORE `ENGINE_PATTERNS` — so any path outside `data/`
     * and `.claude/` classified as `skin` on its extension alone, whatever
     * directory it lived in. The `FAILS CLOSED` fixtures below are `.ts`/`.md`
     * only, which is exactly why it survived: no test could structurally reach
     * the bug. Directory is the primary key; an extension is never a key.
     */
    it("an extension NEVER promotes a path out of engine (#2740 review)", () => {
        expect(classifyPath("convex/gre/theme.css")).toBe("engine");
        expect(classifyPath("convex/cards/art/x.svg")).toBe("engine");
        expect(classifyPath("scripts/ui-gate/report.css")).toBe("engine");
        expect(classifyPath("scripts/ui-gate/logo.png")).toBe("engine");
    });

    it("an extension NEVER promotes an unrecognised path out of full (#2740 review)", () => {
        expect(classifyPath("docs/img/a.png")).toBe("full");
        expect(classifyPath("docs/guides/style.css")).toBe("full");
        // Five such files are tracked TODAY — `.agents/skills/*/assets/*.svg`
        // — and the PR-body census lists `.agents/**` as `full`.
        expect(
            classifyPath(".agents/skills/convex-quickstart/assets/icon.svg")
        ).toBe("full");
        expect(classifyPath(".claude/hooks/theme.css")).toBe("full");
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

    it("a css/asset-only diff under convex|scripts ⇒ engine, never skin (#2740 review)", () => {
        expect(classifyLane(["scripts/ui-gate/report.css"]).lane).toBe(
            "engine"
        );
        expect(
            classifyLane(["convex/gre/theme.css", "convex/cards/art/x.svg"])
                .lane
        ).toBe("engine");
        // Mixed with a real src file it is the mixed case, not skin.
        expect(
            classifyLane(["src/app.tsx", "scripts/ui-gate/report.css"]).lane
        ).toBe("full");
    });

    it("an asset-only diff outside every rule ⇒ full (#2740 review)", () => {
        expect(classifyLane(["docs/img/a.png"]).lane).toBe("full");
        expect(
            classifyLane([".agents/skills/convex-quickstart/assets/icon.svg"])
                .lane
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

    /**
     * The sharpest symptom of the round-1 finding was not the lane itself but
     * the RECEIPT: `classifyLane(["scripts/ui-gate/report.css"])` yielded
     * `skin` and rendered "no changed path under convex/** or scripts/** —
     * the bot suites cannot go red" for a diff that plainly contained a
     * `scripts/**` path. A reason that misdescribes the diff is a false
     * statement in the one artifact whose entire purpose is to be judgable,
     * so the reasons are checked against the files, not merely against
     * themselves.
     */
    it("every skip reason claiming 'no changed path under X' tells the truth", () => {
        const diffs = [
            ["src/components/board/Card.tsx", "src/index.css"],
            ["public/img/symbols/W.svg"],
            ["index.html"],
            ["scripts/ui-gate/report.css"],
            ["convex/gre/theme.css", "convex/cards/art/x.svg"],
            ["convex/gre/engine.ts", "scripts/gate.ts"],
            ["scripts/gate.ts"],
        ];
        for (const files of diffs) {
            const plan = classifyLane(files);
            for (const s of plan.skip) {
                const claim = s.reason.match(
                    /no changed path under ([^—]+?)\s*—/
                );
                if (!claim) continue;
                for (const glob of claim[1].split(/\s+or\s+/)) {
                    const prefix = glob.trim().replace(/\*+$/, "");
                    for (const f of plan.files) {
                        expect(
                            f.startsWith(prefix),
                            `lane=${plan.lane} skip=${s.id} claims "${s.reason}" but the diff contains ${f}`
                        ).toBe(false);
                    }
                }
            }
        }
    });

    /**
     * The header's rationale makes a POSITIVE claim about the diff ("all
     * under …") where the skip reasons make negative ones. Same defect class,
     * so it is checked the same way: against the files, never against itself.
     */
    it("the rationale's 'all under X' claim tells the truth for every lane", () => {
        const allowed: Record<string, RegExp> = {
            skin: /^(src\/|public\/|index\.html$)/,
            engine: /^(convex\/|scripts\/)/,
        };
        for (const files of [
            ["src/components/board/Card.tsx", "src/index.css"],
            ["public/img/symbols/W.svg", "index.html"],
            ["scripts/ui-gate/report.css"],
            ["convex/gre/theme.css", "scripts/gate.ts"],
            ["convex/gre/engine.ts"],
        ]) {
            const plan = classifyLane(files);
            const re = allowed[plan.lane];
            expect(re, `${plan.lane} is not a narrowed lane`).toBeDefined();
            expect(plan.rationale).toContain("all under");
            for (const f of plan.files) {
                expect(
                    re.test(f),
                    `lane=${plan.lane} says "${plan.rationale}" but the diff contains ${f}`
                ).toBe(true);
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
        // #2741: this lane now executes for real — the plan-only render no
        // longer claims anything about running or not running (that claim
        // moved to renderReceipt, tested below, which is built from the
        // execution outcome instead of asserted here).
        expect(out).not.toMatch(/inert/i);
    });

    /**
     * The dirty-tree refusal exists so the printed SHA describes exactly what
     * was classified; the machine-readable form must not lose that (#2740
     * review, nit 2).
     */
    it("the --json form carries the HEAD SHA the human receipt carries", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        const parsed = JSON.parse(renderJson(plan, "4f2a91c")) as LanePlan & {
            head: string;
        };
        expect(parsed.head).toBe("4f2a91c");
        expect(parsed.lane).toBe("engine");
        expect(parsed.files).toEqual(["convex/gre/engine.ts"]);
        expect(ids(parsed.run)).toContain("node[all]");
        expect(renderPlan(plan, "4f2a91c")).toContain("4f2a91c");
    });

    /**
     * `renderJson` is the ONLY JSON renderer (#2748 review, finding 1):
     * `main()` no longer hand-builds `JSON.stringify({ head, ...plan,
     * ...result })` next to it, so this same function must also cover the
     * EXECUTED case — the `RunResult` merged in alongside the plan fields.
     * Proof-of-failure: temporarily deleted `head` from `renderJson`'s
     * return — this test AND "the --json form carries the HEAD SHA..."
     * above both went red (`parsed.head` was `undefined`); reverted.
     */
    it("also merges in the RunResult once the plan has executed", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        const result: RunResult = {
            outcomes: [{ id: "node[all]", status: "pass", ms: 5 }],
            ok: true,
            totalMs: 5,
        };
        const parsed = JSON.parse(renderJson(plan, "4f2a91c", result)) as {
            head: string;
            lane: string;
            ok: boolean;
            totalMs: number;
            outcomes: { id: string }[];
        };
        expect(parsed.head).toBe("4f2a91c");
        expect(parsed.lane).toBe("engine");
        expect(parsed.ok).toBe(true);
        expect(parsed.totalMs).toBe(5);
        expect(parsed.outcomes).toEqual(result.outcomes);
    });

    it("renders the full lane without an empty skip block", () => {
        const out = renderPlan(classifyLane(["package.json"]), "deadbee");
        expect(out).toMatch(/^lane: {2}full/m);
        expect(out).toContain("check:pr");
        expect(out).not.toMatch(/^skip:/m);
    });
});

describe("check-lane — execution (issue #2741)", () => {
    /**
     * Round-trip: an `exec` fake standing in for the shell, so the DECISION
     * (fail-fast? how a not-run check is recorded?) is tested without
     * spawning anything — repo convention (land.ts, docs-lane.ts: git
     * plumbing thin & untested, decisions pure & tested).
     */
    function fakeExec(results: Record<string, { ok: boolean; ms: number }>): {
        exec: (command: string) => { ok: boolean; ms: number };
        calls: string[];
    } {
        const calls: string[] = [];
        return {
            calls,
            exec: (command: string) => {
                calls.push(command);
                const r = results[command];
                if (!r) throw new Error(`unexpected command: ${command}`);
                return r;
            },
        };
    }

    it("runs every planned check and reports pass when all pass", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        const { exec, calls } = fakeExec(
            Object.fromEntries(
                plan.run.map((c) => [c.command, { ok: true, ms: 10 }])
            )
        );
        const result = runPlan(plan, exec);

        expect(result.ok).toBe(true);
        expect(calls).toEqual(plan.run.map((c) => c.command));
        expect(result.outcomes.map((o) => o.status)).toEqual(
            plan.run.map(() => "pass")
        );
        expect(result.totalMs).toBe(10 * plan.run.length);
    });

    /**
     * FAIL-FAST, matching check:pr's own `&&`-chained behaviour (see the
     * doc comment on `runPlan`): the first red check stops the rest, and
     * every check after it is recorded `not-run` rather than silently
     * missing from the receipt.
     *
     * Proof-of-failure (manual, per .claude/rules/gre-development.md §
     * Proof-of-failure): reverting the `if (!ok) { ...continue; }` guard so
     * `runPlan` always calls `exec` turned this red — `calls` grew past the
     * failing check and outcomes past it read "pass"/"fail" instead of
     * "not-run". Reverted.
     */
    it("stops at the first red check; later checks are not-run, never silently absent", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        expect(plan.run.length).toBeGreaterThan(2);
        const failing = plan.run[1].command;
        const { exec, calls } = fakeExec(
            Object.fromEntries(
                plan.run.map((c, i) => [
                    c.command,
                    { ok: c.command !== failing, ms: 5 + i },
                ])
            )
        );
        const result = runPlan(plan, exec);

        expect(result.ok).toBe(false);
        // exec was called for the first two checks only — the failing one
        // and everything after it never ran.
        expect(calls).toEqual(plan.run.slice(0, 2).map((c) => c.command));
        expect(result.outcomes[0].status).toBe("pass");
        expect(result.outcomes[1].status).toBe("fail");
        for (const o of result.outcomes.slice(2)) {
            expect(o.status).toBe("not-run");
            expect(o.ms).toBe(0);
        }
    });

    it("renderReceipt shows every outcome and a PASS/FAIL summary with the total", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const result = runPlan(
            plan,
            fakeExec(
                Object.fromEntries(
                    plan.run.map((c) => [c.command, { ok: true, ms: 1000 }])
                )
            ).exec
        );
        const out = renderReceipt(result);
        for (const o of result.outcomes) expect(out).toContain(o.id);
        expect(out).toMatch(/^PASS/m);
        expect(out).toContain(`${(result.totalMs / 1000).toFixed(1)}s`);
    });

    it("renderReceipt reports FAIL when any check failed", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const failing = plan.run[0].command;
        const result = runPlan(
            plan,
            fakeExec(
                Object.fromEntries(
                    plan.run.map((c) => [
                        c.command,
                        { ok: c.command !== failing, ms: 1 },
                    ])
                )
            ).exec
        );
        expect(renderReceipt(result)).toMatch(/^FAIL/m);
    });

    /**
     * `executePlan` — the ONE function that fans a plan out to
     * `renderPlan`, `runPlan` and `renderJson` (#2748 review, finding 3) —
     * takes the plan as data and has no access to `classifyLane` or the git
     * plumbing, so it structurally CANNOT rebuild a second, independently
     * classified plan for rendering. This is the behavioural form of the
     * invariant #2741 exists to hold: the executed commands (via `exec`)
     * and the rendered output (json or human) both derive from the exact
     * plan this test constructs — a rendering path fed by a different
     * plan (e.g. a re-derived one with a different `lane`/`run`/`skip`)
     * would show up here as a mismatch between what was executed and what
     * was printed.
     *
     * Proof-of-failure (manual): changed `executePlan`'s `renderJson` call
     * to render a hand-built second plan (`{ ...plan, lane: "full" }`)
     * instead of `plan` — this test went red (`parsed.lane` was `"full"`,
     * expected `"engine"`, while `calls` still matched the original
     * `plan.run` commands: exactly the "receipt describes a different run"
     * shape). Reverted.
     */
    it("executePlan renders and executes off the exact same plan object it was given (#2741, #2748)", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        const { exec, calls } = fakeExec(
            Object.fromEntries(
                plan.run.map((c) => [c.command, { ok: true, ms: 3 }])
            )
        );
        const lines: string[] = [];
        const result = executePlan(plan, "4f2a91c", true, exec, (l) =>
            lines.push(l)
        );

        expect(calls).toEqual(plan.run.map((c) => c.command));

        const parsed = JSON.parse(lines[0]) as LanePlan & {
            head: string;
            ok: boolean;
        };
        expect(parsed.head).toBe("4f2a91c");
        expect(parsed.lane).toBe(plan.lane);
        expect(parsed.files).toEqual(plan.files);
        expect(ids(parsed.run)).toEqual(ids(plan.run));
        expect(parsed.ok).toBe(result.ok);
    });

    it("executePlan prints the human plan then the human receipt when not in json mode", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const { exec } = fakeExec(
            Object.fromEntries(
                plan.run.map((c) => [c.command, { ok: true, ms: 2 }])
            )
        );
        const lines: string[] = [];
        executePlan(plan, "deadbee", false, exec, (l) => lines.push(l));

        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(renderPlan(plan, "deadbee"));
        expect(lines[1]).toMatch(/^PASS/m);
    });

    /**
     * Narrower structural guard, kept alongside the behavioural test above
     * rather than in its place: it pins only that `classifyLane` itself has
     * exactly one call site in this file's own source (one declaration, one
     * call in `main()`). It does NOT, on its own, prove renderPlan/runPlan
     * consume the same plan — a hand-built second plan constructed WITHOUT
     * calling `classifyLane` again (e.g. `{ ...plan, lane: "full" }`) would
     * pass this text scan while still describing a different run than the
     * one executed. That case is what the behavioural `executePlan` test
     * above actually catches.
     *
     * Proof-of-failure (manual, from the original #2741 PR): temporarily
     * added a second `classifyLane(...)` call inside `main()` — this test
     * went red (found 2 call sites, wanted 1). Reverted.
     */
    it("classifyLane has exactly one call site outside its own declaration (textual, narrower than the behavioural guard above)", () => {
        const src = readFileSync(
            resolve(ROOT, "scripts/check-lane.ts"),
            "utf8"
        );
        const declarations = (src.match(/function classifyLane\(/g) ?? [])
            .length;
        const total = (src.match(/\bclassifyLane\(/g) ?? []).length;
        expect(declarations).toBe(1);
        expect(total - declarations).toBe(1);
    });

    /**
     * `shellRun` (the real executor `main()` uses) delegates every command
     * to `scripts/gate.ts light` — the repo's single light-tier mechanism
     * (no mutex, `TOLARIA_VITEST_WORKERS` left for `vitest.config.ts`'s own
     * default). This pins the delegation shape so it can't quietly drift
     * into a hand-rolled env/tier reimplementation.
     */
    it("delegates execution to `scripts/gate.ts light`, never a hand-rolled tier", () => {
        const src = readFileSync(
            resolve(ROOT, "scripts/check-lane.ts"),
            "utf8"
        );
        expect(src).toMatch(
            /spawnSync\(\s*"bun",\s*\[GATE, "light", command\]/
        );
        expect(src).not.toContain("TOLARIA_ALLOW_FULL_SUITE");
        expect(src).not.toMatch(/gate\.ts["'`]\s*,\s*"heavy"/);
    });
});

describe("check-lane — --json stdout isolation (#2748 review, finding 2)", () => {
    /**
     * `shellRun` always spawned children with `stdio: "inherit"`, so in
     * `--json` mode every check's own stdout (tsc, prettier, vitest, vite)
     * landed on `check:lane --json`'s stdout ahead of the JSON blob,
     * breaking `bun run check:lane --json | jq` even though the file's own
     * usage block advertises `--json` as emitting JSON. `shellStdio` is the
     * pure decision extracted out of `shellRun` so it's testable without
     * spawning a real check — repo convention (every DECISION in this file
     * is a pure function tested directly).
     *
     * Proof-of-failure: temporarily made `shellStdio` return `["inherit",
     * "inherit", "inherit"]` unconditionally (ignoring `json`) — the first
     * assertion below went red (`[2]` !== `"inherit"`). Reverted.
     */
    it("redirects the child's stdout to the parent's stderr (fd 2) in json mode", () => {
        expect(shellStdio(true)).toEqual(["inherit", 2, "inherit"]);
    });

    it("leaves the child's stdout inherited outside json mode, so the human receipt still streams check output live", () => {
        expect(shellStdio(false)).toEqual(["inherit", "inherit", "inherit"]);
    });
});
