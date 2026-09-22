import { describe, it, expect, vi } from "vitest";
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
    renderClassification,
    parseArgs,
    shellStdio,
    treeMoved,
    hasLintStagedStash,
    type LanePlan,
    type TreeSnapshot,
    type RunResult,
} from "../check-lane";
import { DOC_GATE_TESTS } from "../lib/doc-gate-tests";
import { ORIGIN_BASE } from "../lib/branches";

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

/**
 * The tree re-assertion (issue #4379) for a test that is not about it: a
 * quiet tree never refuses, so it is a no-op. `runPlan` and `executePlan`
 * take it as a REQUIRED parameter precisely so a caller cannot forget it,
 * which is why this is spelled out rather than defaulted away.
 */
const noopAssert = (): string => "4f2a91c";

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

    /**
     * ADR 0136 §3. `data/**` sat in `FULL_PATTERNS` and sent 40 of 300 PRs to
     * `check:pr` whole for the two artefacts every card PR regenerates. It is
     * engine input — generated or vendored — and the guards that read it
     * (`check:index`, `check:oracle`, `cr:lint`) run in the engine lane.
     *
     * Since ADR 0136 §4 the PATH class is `data`, never a lane of its own: it
     * rides with the code beside it, and alone it is `engine` (asserted in
     * the lane-selection block below).
     */
    it("classifies data/** as data — a path class that rides with its code (ADR 0136 §3/§4)", () => {
        for (const p of [
            "data/card-index.json",
            "data/cr/citations-ledger.json",
            "data/cr/comprehensive-rules.txt",
            "data/oracle-compiled.json",
            "data/json/LEA.json",
            "data/pick-ratings/vintage-cube.json",
        ]) {
            expect(classifyPath(p), p).toBe("data");
        }
    });

    it("classifies convex/cards/sets/** as cards, and the rest of convex/cards/** as engine (ADR 0136 §4)", () => {
        expect(classifyPath("convex/cards/sets/lea/red.ts")).toBe("cards");
        expect(
            classifyPath("convex/cards/sets/lea/__tests__/red.test.ts")
        ).toBe("cards");
        // The registry, the types and the catalogue guards are engine work.
        expect(classifyPath("convex/cards/mechanicsRegistry.ts")).toBe(
            "engine"
        );
        expect(classifyPath("convex/cards/types.ts")).toBe("engine");
        expect(
            classifyPath("convex/cards/__tests__/effectScripts.test.ts")
        ).toBe("engine");
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
        expect(classifyPath(".agents/whatever.md")).toBe("full");
    });

    it("classifies prose as docs — markdown under docs/** and root .md", () => {
        expect(classifyPath("docs/adr/0104-gate-lanes.md")).toBe("docs");
        expect(classifyPath("docs/findings/1872-mana.md")).toBe("docs");
        expect(classifyPath("docs/agents/quality-gates.md")).toBe("docs");
        expect(classifyPath("CLAUDE.md")).toBe("docs");
        expect(classifyPath("CONTEXT.md")).toBe("docs");
        expect(classifyPath("README.md")).toBe("docs");
    });

    /**
     * The docs lane is anchored to `.md` for the same reason `SKIN_PATTERNS`
     * is anchored to a directory (#2740 round-1 review): `docs/` also holds
     * images and stylesheets, and an extension must never be what promotes a
     * path out of `full`. The mirror-image hazard is the new one — a
     * DIRECTORY must not promote a non-prose file into the prose lane.
     */
    it("a docs/ path that is NOT markdown stays full", () => {
        expect(classifyPath("docs/img/a.png")).toBe("full");
        expect(classifyPath("docs/guides/style.css")).toBe("full");
        expect(classifyPath("docs/scripts/gen.ts")).toBe("full");
    });

    it("markdown outside docs/** and the repo root is NOT docs", () => {
        // `.agents/**` matches nothing, so it cannot reach the prose lane.
        // (`.claude/rules/*.md` DOES, by its own carve-out — see the
        // `.claude/**` block below, issue #4376.)
        expect(classifyPath(".agents/skills/x/SKILL.md")).toBe("full");
        // Nested markdown that belongs to code, not to prose.
        expect(classifyPath("convex/gre/README.md")).toBe("engine");
        expect(classifyPath("src/components/README.md")).toBe("skin");
    });

    /**
     * A nested `CLAUDE.md` is agent memory: the full text of a path-specific
     * rule, loaded by the harness only when a session reads a file under that
     * directory. `src/CLAUDE.md` is the sharp case — `SKIN_PATTERNS` matches
     * `^src/`, so without an explicit rule a markdown-only diff would classify
     * as `skin` and `bun run land` would demand a byte-exact `check:ui`
     * receipt for a file that cannot reach the DOM.
     */
    it("a nested CLAUDE.md is prose at any depth", () => {
        expect(classifyPath("src/CLAUDE.md")).toBe("docs");
        expect(classifyPath("convex/CLAUDE.md")).toBe("docs");
        expect(classifyPath("convex/gre/ai/CLAUDE.md")).toBe("docs");
    });

    /**
     * `AGENTS.md` is the generated mirror of the same prose for Codex and
     * opencode (`scripts/build-agents-md.ts`). It sits at the same paths and
     * carries the same hazard: `src/AGENTS.md` matches `^src/`, so without the
     * rule a regenerated-docs diff would enter the `skin` lane and owe a
     * `check:ui` receipt.
     */
    it("a nested AGENTS.md is prose at any depth", () => {
        expect(classifyPath("src/AGENTS.md")).toBe("docs");
        expect(classifyPath("convex/AGENTS.md")).toBe("docs");
        expect(classifyPath("AGENTS.md")).toBe("docs");
    });

    it("the CLAUDE.md rule is the basename, not the directory", () => {
        // Anything else nested under the same directories keeps its own lane —
        // the pattern must not become a hole that promotes code or assets.
        expect(classifyPath("src/CLAUDE.tsx")).toBe("skin");
        expect(classifyPath("src/claude.md")).toBe("skin");
        expect(classifyPath("src/CLAUDE.md.ts")).toBe("skin");
        expect(classifyPath("convex/gre/NOTES.md")).toBe("engine");
        // `.claude/CLAUDE.md` is neither a skill nor a rule index, so the
        // `.claude/**` carve-out does not reach it and FULL_PATTERNS does.
        expect(classifyPath(".claude/CLAUDE.md")).toBe("full");
    });

    /**
     * Prose rides with the code (ADR 0136 §3): a nested `CLAUDE.md` next to a
     * real code change takes the CODE's lane — never a narrower one than the
     * code alone would get, and the docs guards are appended (see the lane
     * selection block below).
     */
    it("a nested CLAUDE.md alongside code takes the code's lane", () => {
        expect(
            classifyLane(["src/CLAUDE.md", "src/lib/card-utils.ts"]).lane
        ).toBe("skin");
        expect(
            classifyLane(["convex/CLAUDE.md", "convex/gre/sba.ts"]).lane
        ).toBe("engine");
        // …and prose from the OTHER side does not narrow the lane either:
        // `convex/CLAUDE.md` in a `src` diff is not a `convex/**` code change.
        expect(
            classifyLane(["convex/CLAUDE.md", "src/lib/card-utils.ts"]).lane
        ).toBe("skin");
    });
});

/**
 * `.claude/**` is SPLIT (issue #4376): a skill and a rule index are prose, a
 * hook and a settings file are programs.
 *
 * WHY THE SPLIT EXISTS. `^\.claude/` was in `FULL_PATTERNS` whole, written
 * when that tree held hooks and rule indexes only. Issues #4087/#4090 moved
 * every workflow skill in there, so a one-line `SKILL.md` edit paid
 * `check:pr` verbatim (~440s) instead of `check:docs` (seconds). What a skill
 * or a rule index can break is a closed set of guards, all of them already in
 * `DOC_GATE_TESTS` — `docs-lane.test.ts`'s `.claude/` census is what keeps
 * that true as guards get added.
 *
 * WHAT MUST NOT MOVE is the other half: the carve-out is anchored to `.md`
 * inside two named directories, so a `.ts`/`.sh`/`.json` under a skill, a
 * hook, a settings file or an agent definition still forces the full gate.
 */
describe("check-lane — `.claude/**` is split: prose is docs, programs are full (issue #4376)", () => {
    it("a skill's markdown is prose, at any depth under its directory", () => {
        expect(classifyPath(".claude/skills/next-issue/SKILL.md")).toBe("docs");
        expect(
            classifyPath(".claude/skills/new-card/references/forms.md")
        ).toBe("docs");
    });

    it("a rule index is prose", () => {
        expect(classifyPath(".claude/rules/gre-development.md")).toBe("docs");
        expect(classifyPath(".claude/rules/bot-development.md")).toBe("docs");
    });

    /**
     * The mirror-image hazard of the docs lane's own anchoring rule: a
     * DIRECTORY must never promote a non-prose file into the prose lane. A
     * skill that ships a script is the sharp case — the script runs.
     */
    it("a non-prose file under a skill stays full", () => {
        expect(classifyPath(".claude/skills/next-issue/lib/plan.ts")).toBe(
            "full"
        );
        expect(classifyPath(".claude/skills/new-set/bin/compile.sh")).toBe(
            "full"
        );
        expect(classifyPath(".claude/skills/to-prd/fixtures/x.json")).toBe(
            "full"
        );
    });

    it("hooks, settings and anything else under .claude/ stay full", () => {
        expect(classifyPath(".claude/hooks/deny-guard.sh")).toBe("full");
        expect(classifyPath(".claude/hooks/lib/join-continued-lines.awk")).toBe(
            "full"
        );
        expect(classifyPath(".claude/settings.json")).toBe("full");
        expect(classifyPath(".claude/settings.local.json")).toBe("full");
        // Neither a skill nor a rule index: nothing enumerates what reads
        // these, so they keep the fail-closed default.
        expect(classifyPath(".claude/CLAUDE.md")).toBe("full");
        expect(classifyPath(".claude/agents/cavecrew-builder.md")).toBe("full");
        expect(classifyPath(".claude/rules/nested/deeper.md")).toBe("full");
    });

    // The three acceptance cases of issue #4376, as lanes rather than paths.
    it("one SKILL.md alone ⇒ docs, and the lane runs check:docs", () => {
        const plan = classifyLane([".claude/skills/next-issue/SKILL.md"]);
        expect(plan.lane).toBe("docs");
        expect(plan.run.map((c) => c.id)).toEqual(["check:docs"]);
    });

    it("a SKILL.md plus a hook ⇒ full — the program decides", () => {
        expect(
            classifyLane([
                ".claude/skills/next-issue/SKILL.md",
                ".claude/hooks/deny-guard.sh",
            ]).lane
        ).toBe("full");
    });

    it("a rule index plus a src/** file ⇒ skin, with node[docs] appended", () => {
        const plan = classifyLane([
            ".claude/rules/frontend-components.md",
            "src/components/Board.tsx",
        ]);
        expect(plan.lane).toBe("skin");
        expect(plan.run.map((c) => c.id)).toContain("node[docs]");
    });

    /**
     * The rationale is a positive claim about every path in the diff, and the
     * truth test elsewhere in this file reads it back — so the docs lane's own
     * sentence has to name where this prose actually lives.
     */
    it("the docs rationale names the .claude/ directories it now admits", () => {
        const plan = classifyLane([".claude/rules/gre-development.md"]);
        expect(plan.rationale).toMatch(/\.claude\/\{skills,rules\}/);
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

    it("prose-only ⇒ docs, delegating to check:docs verbatim", () => {
        const plan = classifyLane([
            "docs/adr/0111-extra-phases.md",
            "docs/adr/README.md",
            "CONTEXT.md",
        ]);
        expect(plan.lane).toBe("docs");
        expect(ids(plan.run)).toEqual(["check:docs"]);
    });

    /**
     * The regression this lane was built to kill: `bun run land` on a
     * one-file `docs/findings/**` branch classified `full` and paid the whole
     * `check:pr` suite — 466s measured on PR #2891.
     */
    it("a single docs/findings file ⇒ docs, not full", () => {
        const plan = classifyLane([
            "docs/findings/1872-cast-time-mana-color-fixing.md",
        ]);
        expect(plan.lane).toBe("docs");
    });

    /**
     * ADR 0136 §3 — prose in a mixed diff no longer forces `full`. 75 of 300
     * PRs (2026-09-03 → 09-17) paid `check:pr` whole for an ADR or a guide
     * that travelled with the code it described. The code decides the lane
     * and the run list ENDS with the docs lane's own node test list — the
     * same `DOC_GATE_TESTS` that `check:docs` runs, so the prose is proven by
     * exactly the guards that read it. Three cases, each proven to fail once.
     */
    const docsNodeCommand = `bunx vitest run --project node-engine --project node-tooling ${DOC_GATE_TESTS.join(" ")}`;

    it("prose + engine code ⇒ engine, run list ending with the check:docs node files", () => {
        for (const files of [
            ["CONTEXT.md", "convex/gre/phases.ts"],
            ["docs/adr/0111.md", "scripts/check-lane.ts"],
            [
                "docs/guides/land-and-release.md",
                "convex/CLAUDE.md",
                "convex/gre/sba.ts",
            ],
        ]) {
            const plan = classifyLane(files);
            expect(plan.lane, files.join(",")).toBe("engine");
            const last = plan.run.at(-1)!;
            expect(last.id).toBe("node[docs]");
            expect(last.command).toBe(docsNodeCommand);
            expect(plan.rationale).toContain("prose");
        }
    });

    it("prose + skin code ⇒ skin, run list ending with the check:docs node files", () => {
        const plan = classifyLane([
            "docs/adr/0111.md",
            "src/components/board/Card.tsx",
        ]);
        expect(plan.lane).toBe("skin");
        const last = plan.run.at(-1)!;
        expect(last.id).toBe("node[docs]");
        expect(last.command).toBe(docsNodeCommand);
        expect(plan.rationale).toContain("prose");
    });

    it("pure code appends nothing — node[docs] appears only when prose is in the diff", () => {
        expect(ids(classifyLane(["convex/gre/phases.ts"]).run)).not.toContain(
            "node[docs]"
        );
        expect(
            ids(classifyLane(["src/components/board/Card.tsx"]).run)
        ).not.toContain("node[docs]");
    });

    it("prose over a src + convex mix is still full — prose never narrows a mixed code diff", () => {
        const plan = classifyLane([
            "docs/adr/0111.md",
            "src/components/board/Card.tsx",
            "convex/gre/phases.ts",
        ]);
        expect(plan.lane).toBe("full");
        expect(ids(plan.run)).toEqual(["check:pr"]);
        expect(plan.rationale).toContain("spanning src/**");
        expect(plan.rationale).not.toContain("prose");
    });

    it("prose over an unrecognised path is still full", () => {
        expect(classifyLane(["docs/adr/0111.md", "package.json"]).lane).toBe(
            "full"
        );
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

    /**
     * ADR 0136 §3. The card PR shape — the definition plus the two artefacts
     * it regenerates — is the single most common diff in the repo and it was
     * `full` for the artefacts alone.
     */
    it("a card PR — definition + regenerated data/** artefacts — ⇒ cards (ADR 0136 §4)", () => {
        const plan = classifyLane([
            "convex/cards/sets/lea/red.ts",
            "data/card-index.json",
            "data/cr/citations-ledger.json",
        ]);
        expect(plan.lane).toBe("cards");
        expect(plan.rationale).toContain("all under");
        // …and the guards that READ data/** are in the plan.
        expect(ids(plan.run)).toEqual(
            expect.arrayContaining(["check:index", "check:oracle", "cr:lint"])
        );
    });

    it("cards needs a card: data/** alone is engine, and any other convex/scripts path makes it engine", () => {
        expect(classifyLane(["convex/cards/sets/lea/red.ts"]).lane).toBe(
            "cards"
        );
        expect(
            classifyLane([
                "convex/cards/sets/lea/red.ts",
                "convex/cards/sets/arn/blue.ts",
                "convex/cards/sets/lea/__tests__/red.test.ts",
                "data/oracle-compiled.json",
            ]).lane
        ).toBe("cards");
        // A card that needs a new Op touches convex/gre/** — engine.
        for (const other of [
            "convex/gre/effects/interpreter.ts",
            "convex/cards/mechanicsRegistry.ts",
            "convex/game.ts",
            "scripts/check-lane.ts",
        ]) {
            expect(
                classifyLane([
                    "convex/cards/sets/lea/red.ts",
                    "data/card-index.json",
                    other,
                ]).lane,
                other
            ).toBe("engine");
        }
        // Beside src/** it is the mixed case, like any other code.
        expect(
            classifyLane(["convex/cards/sets/lea/red.ts", "src/app.tsx"]).lane
        ).toBe("full");
        // Prose rides along without changing the lane (ADR 0136 §3).
        const withProse = classifyLane([
            "convex/cards/sets/lea/red.ts",
            "docs/adr/0136.md",
        ]);
        expect(withProse.lane).toBe("cards");
        expect(ids(withProse.run).at(-1)).toBe("node[docs]");
    });

    it("data/** alone ⇒ engine; data/** beside src/** ⇒ full", () => {
        expect(classifyLane(["data/cr/comprehensive-rules.txt"]).lane).toBe(
            "engine"
        );
        expect(
            classifyLane(["convex/gre/engine.ts", "data/cr/VERSION.json"]).lane
        ).toBe("engine");
        expect(classifyLane(["src/app.tsx", "data/card-index.json"]).lane).toBe(
            "full"
        );
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
    const cards = classifyLane([
        "convex/cards/sets/lea/red.ts",
        "data/card-index.json",
    ]);
    const docs = classifyLane(["docs/adr/0111-extra-phases.md"]);
    const full = classifyLane(["package.json"]);

    it("docs delegates to check:docs and names what prose cannot break", () => {
        expect(ids(docs.run)).toEqual(["check:docs"]);
        expect(ids(docs.skip)).toEqual([
            "tsc[all]",
            "lint(diff)",
            "dom",
            "node-engine+node-tooling",
        ]);
    });

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
            "check:oracle",
            "bot fast lane",
            "node[convex]",
        ]);
    });

    it("engine admits node-tooling whole for a scripts/** diff, never a slice (ADR 0136 §5)", () => {
        const tooling = classifyLane(["scripts/land.ts"]);
        expect(tooling.lane).toBe("engine");
        expect(ids(tooling.run).slice(-2)).toEqual([
            "node-engine",
            "node-tooling",
        ]);
        expect(tooling.run.at(-1)!.command).toBe(
            "bunx vitest run --project node-tooling"
        );
        expect(ids(tooling.skip)).toEqual(["dom"]);
        for (const files of [
            ["convex/gre/engine.ts"],
            ["data/card-index.json"],
        ]) {
            expect(ids(classifyLane(files).skip), files[0]).toContain(
                "node-tooling"
            );
        }
    });

    it("engine keeps the WHOLE type-check and drops only dom and node-tooling", () => {
        expect(ids(engine.run)).toEqual([
            "format(diff)",
            "lint(diff)",
            "tsc[all]",
            "check:index",
            "check:stubs",
            "check:oracle",
            "bundle",
            "cr:lint",
            "bot fast lane",
            "node-engine",
        ]);
        expect(ids(engine.skip)).toEqual(["dom", "node-tooling"]);
        // src/** imports convex/gre (ADR 0074), so an engine diff CAN break
        // the app project — the whole type-check is one of the three
        // backstops that make dropping `dom` safe (#2738).
        expect(ids(engine.run)).not.toContain("tsc[app,scripts]");
    });

    it("cards runs tsc[convex], the catalogue guards and convex/cards/ whole, and names four skips (ADR 0136 §4)", () => {
        expect(ids(cards.run)).toEqual([
            "format(diff)",
            "lint(diff)",
            "tsc[convex]",
            "check:index",
            "check:stubs",
            "check:oracle",
            "bundle",
            "cr:lint",
            "node[cards]",
            "bot[cards]",
        ]);
        expect(ids(cards.skip)).toEqual([
            "tsc[app,scripts]",
            "bot fast lane",
            "node-engine+node-tooling",
            "dom",
        ]);
        const out = renderPlan(cards, "4f2a91c");
        expect(out).toMatch(/^lane:\s+cards\b/);
        for (const s of cards.skip) {
            expect(out).toContain(s.id);
            expect(out).toContain(s.reason);
        }
    });

    it("full delegates to check:pr verbatim and skips nothing", () => {
        expect(ids(full.run)).toEqual(["check:pr"]);
        expect(full.skip).toEqual([]);
    });

    it("every skip carries a non-empty reason", () => {
        for (const plan of [skin, engine, cards, full]) {
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
            ["convex/cards/sets/lea/red.ts", "data/card-index.json"],
            ["convex/cards/sets/lea/red.ts", "docs/adr/0136.md"],
            // Prose rides with the code (ADR 0136 §3): a nested CLAUDE.md
            // sits UNDER the directory the reasons name, so they say "no
            // changed CODE under X" and the claim is checked against the
            // code paths — the prose is carried by node[docs] instead.
            ["src/CLAUDE.md", "convex/gre/engine.ts"],
            ["convex/CLAUDE.md", "src/components/board/Card.tsx"],
            ["src/CLAUDE.md", "convex/CLAUDE.md"],
        ];
        for (const files of diffs) {
            const plan = classifyLane(files);
            for (const s of plan.skip) {
                const claim = s.reason.match(
                    /no changed (path|code) under ([^—]+?)\s*—/
                );
                if (!claim) continue;
                const [, kind, globs] = claim;
                for (const glob of globs.split(/\s*(?:,|or)\s+/)) {
                    const prefix = glob.trim().replace(/\*+$/, "");
                    for (const f of plan.files) {
                        if (kind === "code" && classifyPath(f) === "docs")
                            continue;
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
            engine: /^(convex\/|scripts\/|data\/)/,
            cards: /^(convex\/cards\/sets\/|data\/)/,
        };
        for (const files of [
            ["src/components/board/Card.tsx", "src/index.css"],
            ["public/img/symbols/W.svg", "index.html"],
            ["scripts/ui-gate/report.css"],
            ["convex/gre/theme.css", "scripts/gate.ts"],
            ["convex/gre/engine.ts"],
            ["convex/cards/sets/lea/red.ts", "data/card-index.json"],
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
        // With prose in the diff the claim is "N under X, M prose": the code
        // paths must match the lane and the prose paths must be prose.
        for (const files of [
            ["docs/adr/0136.md", "convex/gre/engine.ts"],
            ["docs/adr/0136.md", "convex/cards/sets/lea/red.ts"],
            ["CONTEXT.md", "src/components/board/Card.tsx", "src/CLAUDE.md"],
        ]) {
            const plan = classifyLane(files);
            const re = allowed[plan.lane];
            expect(re, `${plan.lane} is not a narrowed lane`).toBeDefined();
            expect(plan.rationale).not.toContain("all under");
            const prose = plan.files.filter((f) => classifyPath(f) === "docs");
            expect(plan.rationale).toContain(`${prose.length} prose`);
            for (const f of plan.files) {
                if (classifyPath(f) === "docs") continue;
                expect(
                    re.test(f),
                    `lane=${plan.lane} says "${plan.rationale}" but the diff contains ${f}`
                ).toBe(true);
            }
        }
    });

    it("run and skip lists are disjoint", () => {
        for (const plan of [skin, engine, cards, full]) {
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
        classifyLane(["convex/cards/sets/lea/red.ts", "data/card-index.json"]),
        classifyLane(["docs/adr/0111-extra-phases.md"]),
        classifyLane(["docs/adr/0111-extra-phases.md", "convex/gre/engine.ts"]),
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
        expect(projects).toContain("node-engine");
        expect(projects).toContain("node-tooling");
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

    it("every test file node[docs] names exists on disk", () => {
        const mixed = classifyLane(["CONTEXT.md", "convex/gre/engine.ts"]);
        const docs = mixed.run.find((c) => c.id === "node[docs]")!;
        const files = docs.command.split(" ").filter((w) => w.endsWith(".ts"));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(
                () => readFileSync(resolve(ROOT, file), "utf8"),
                file
            ).not.toThrow();
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
        // `tsc -b <dir>` builds <dir>/tsconfig.json.
        const cards = classifyLane(["convex/cards/sets/lea/red.ts"]);
        const convex = cards.run.find((c) => c.id === "tsc[convex]")!;
        const dir = convex.command.match(/tsc -b (\S+)/)![1];
        expect(() =>
            readFileSync(resolve(ROOT, dir, "tsconfig.json"), "utf8")
        ).not.toThrow();
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
        expect(ids(parsed.run)).toContain("node-engine");
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
            outcomes: [{ id: "node-engine", status: "pass", ms: 5 }],
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
        const result = runPlan(plan, exec, noopAssert);

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
        const result = runPlan(plan, exec, noopAssert);

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
            ).exec,
            noopAssert
        );
        const out = renderReceipt(result, { start: "4f2a91c", end: "4f2a91c" });
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
            ).exec,
            noopAssert
        );
        expect(
            renderReceipt(result, { start: "4f2a91c", end: "4f2a91c" })
        ).toMatch(/^FAIL/m);
    });

    /**
     * `executePlan` — the ONE function that fans a plan out to
     * `renderPlan`, `runPlan` and `renderJson` (#2748 review, finding 3) —
     * takes the plan as a parameter. That makes a rebuild an obvious edit,
     * NOT an impossible one: `executePlan` is module-scope beside
     * `classifyLane`, so a rebuild inserted into its body type-checks and
     * runs (proved in round-2 review of #2748). THIS TEST is the guard, and
     * it compares CONTENT, not object identity — `renderJson(structuredClone
     * (plan), …)` still passes here. What it does pin is the failure that
     * matters: a rendering path fed a differently-CLASSIFIED plan. This is
     * the behavioural form of the invariant #2741 exists to hold: the
     * executed commands (via `exec`)
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
    it("executePlan renders and executes off the plan it was given — same lane, files and run list (#2741, #2748)", () => {
        const plan = classifyLane(["convex/gre/engine.ts"]);
        const { exec, calls } = fakeExec(
            Object.fromEntries(
                plan.run.map((c) => [c.command, { ok: true, ms: 3 }])
            )
        );
        const lines: string[] = [];
        const result = executePlan(
            plan,
            "4f2a91c",
            true,
            exec,
            (l) => lines.push(l),
            () => "4f2a91c"
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
        executePlan(
            plan,
            "deadbee",
            false,
            exec,
            (l) => lines.push(l),
            () => "deadbee"
        );

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

describe("check-lane — `--plan`: the classification without the gate (ADR 0136 §8, issue #3781)", () => {
    /**
     * `/next-issue` §3 keys its `cards` short path on the lane the diff
     * really classifies as. Before `--plan` the only way to read that lane
     * was to RUN the gate, which is the pre-PR gate ADR 0136 §1 retired —
     * so the short path would have been keyed on a session's judgment
     * ("this looks like a simple card") instead.
     *
     * Proof-of-failure, one break per test: dropping `planOnly` from
     * `parseArgs`'s return reddened the first; letting `parseArgs` `continue`
     * over every argument instead of calling `fail` reddened the second;
     * having `renderClassification` pass a fabricated
     * `{ outcomes: [], ok: true, totalMs: 0 }` reddened the third; moving
     * `main()`'s `if (planOnly)` block below the `executePlan` call reddened
     * the fourth. Each reverted.
     */
    it("accepts --plan and reports it, alongside --json and --base=", () => {
        expect(parseArgs(["--plan"])).toEqual({
            base: ORIGIN_BASE,
            json: false,
            planOnly: true,
        });
        expect(parseArgs(["--plan", "--json", "--base=origin/x"])).toEqual({
            base: "origin/x",
            json: true,
            planOnly: true,
        });
        expect(parseArgs([]).planOnly).toBe(false);
    });

    it("still refuses an unknown argument — `--plan` is not a door for a lane flag (#2738)", () => {
        // `fail()` prints and exits, so the refusal is read off stderr plus
        // a non-zero exit, not off a thrown message.
        const errors: string[] = [];
        const err = vi
            .spyOn(console, "error")
            .mockImplementation((m: unknown) => {
                errors.push(String(m));
            });
        const exit = vi.spyOn(process, "exit").mockImplementation(((
            code?: number
        ) => {
            throw new Error(`exit ${code}`);
        }) as never);
        try {
            expect(() => parseArgs(["--skin"])).toThrow("exit 1");
            expect(() => parseArgs(["--cards"])).toThrow("exit 1");
            expect(errors.join("\n")).toMatch(/unknown argument `--skin`/);
            expect(errors.join("\n")).toMatch(/unknown argument `--cards`/);
        } finally {
            err.mockRestore();
            exit.mockRestore();
        }
    });

    it("renders the plan with no RunResult — nothing ran, so nothing is claimed to have passed", () => {
        const plan = classifyLane([
            "convex/cards/sets/arn/white.ts",
            "data/card-index.json",
        ]);
        expect(plan.lane).toBe("cards");

        expect(renderClassification(plan, "c0ffee1", false)).toBe(
            renderPlan(plan, "c0ffee1")
        );

        const parsed = JSON.parse(
            renderClassification(plan, "c0ffee1", true)
        ) as LanePlan & { head: string; ok?: boolean; outcomes?: unknown };
        expect(parsed.head).toBe("c0ffee1");
        expect(parsed.lane).toBe("cards");
        expect(parsed.ok).toBeUndefined();
        expect(parsed.outcomes).toBeUndefined();
    });

    /**
     * The narrow structural half: `main()` must exit on `--plan` BEFORE it
     * reaches `executePlan`, which is the only path to a shell. A `--plan`
     * that printed the lane and then ran the gate anyway would satisfy every
     * pure test above while re-introducing the retired pre-PR gate.
     *
     * Proof-of-failure: moved the `if (planOnly)` block below the
     * `executePlan(...)` call in `main()` — this test went red (the exit
     * index was greater than the execution index). Reverted.
     */
    it("exits before execution: the planOnly branch precedes the only executePlan call site", () => {
        const src = readFileSync(
            resolve(ROOT, "scripts/check-lane.ts"),
            "utf8"
        );
        const short = src.indexOf("if (planOnly) {");
        const exec = src.indexOf("const result = executePlan(");
        expect(short).toBeGreaterThan(-1);
        expect(exec).toBeGreaterThan(-1);
        expect(short).toBeLessThan(exec);
        expect(src.slice(short, exec)).toContain("process.exit(0)");
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

describe("check-lane — the tree may not move under the run (issue #4379, finding 2727)", () => {
    /**
     * The dirty-tree refusal in `main()` covers ONE instant: the tree being
     * dirty when the run starts. husky's `lint-staged` rewrites the tree on
     * every commit — it stashes the working state (`lint-staged automatic
     * backup`), runs prettier, restores it — so a `git commit && bun run
     * check:lane` chain, the shape every AFK session types, can have the
     * lane classify and gate files while the stash is still applied.
     * Observed (finding 2727): a `skin` diff fell back to `check:pr` because
     * the lane saw a diff it could not place, and a ratchet test failed with
     * a count matching a partially-restored tree.
     *
     * `treeMoved` is that DECISION, pure and tested directly — repo
     * convention for this file; the two `snapshotTree` calls around it are
     * git plumbing and stay untested.
     */
    const quiet: TreeSnapshot = {
        head: "4f2a91c",
        status: "",
        stash: "",
    };

    it("passes a tree that did not move", () => {
        expect(treeMoved(quiet, { ...quiet })).toBeNull();
    });

    it("refuses a HEAD that moved, naming both shas", () => {
        const moved = treeMoved(quiet, { ...quiet, head: "deadbee" });
        expect(moved).toContain("the tree moved under the lane");
        expect(moved).toContain("4f2a91c → deadbee");
    });

    it("refuses a working tree that went dirty under the run, naming the first change", () => {
        const moved = treeMoved(quiet, {
            ...quiet,
            status: " M src/app.tsx\n M src/lib/theme.ts\n",
        });
        expect(moved).toContain("the tree moved under the lane");
        expect(moved).toContain("src/app.tsx");
        expect(moved).not.toContain("theme.ts");
    });

    /**
     * A racing `lint-staged` PUSHES its backup and then DROPS it, so the
     * stack differs between two snapshots — the observed failure, where the
     * lint-staged banner appeared inside the lane's own log. Both directions
     * count: the entry may land after the start snapshot or vanish before
     * the end one, depending on where the run falls inside the commit.
     */
    it("refuses a lint-staged stash that was DROPPED under the run", () => {
        const moved = treeMoved(
            { ...quiet, stash: "lint-staged automatic backup" },
            quiet
        );
        expect(moved).toContain("lint-staged automatic backup");
        expect(moved).toContain("pushed or dropped under the run");
    });

    it("refuses a lint-staged stash that was PUSHED under the run", () => {
        const moved = treeMoved(quiet, {
            ...quiet,
            stash: "lint-staged automatic backup",
        });
        expect(moved).toContain("lint-staged automatic backup");
    });

    /**
     * The stash stack is shared by every worktree, and a `lint-staged` that
     * dies between its stash and its restore leaves the entry behind for
     * good — one dated 2026-09-17 was on this repo's stack when the guard
     * was first run. Refusing on PRESENCE, which is what issue #4379 asked
     * for, would therefore have refused every `check:lane` (and every
     * `land`) on the machine until a human dropped it. A stale entry changes
     * nothing and is applied to nothing, so it is inert here.
     */
    it("passes a stale lint-staged entry that was already on the stack and did not move", () => {
        const stale = { ...quiet, stash: "lint-staged automatic backup" };
        expect(treeMoved(stale, { ...stale })).toBeNull();
    });

    it("refuses any other change to the stash stack, without naming lint-staged", () => {
        const moved = treeMoved(quiet, {
            ...quiet,
            stash: "On staging: someone else's wip",
        });
        expect(moved).toContain("the stash stack changed under the run");
        expect(moved).not.toContain("lint-staged automatic backup");
    });

    it("recognises the lint-staged entry with and without the stash@{N} prefix, and nothing else", () => {
        expect(hasLintStagedStash("lint-staged automatic backup")).toBe(true);
        expect(
            hasLintStagedStash("stash@{0}: lint-staged automatic backup")
        ).toBe(true);
        expect(
            hasLintStagedStash("stash@{0}: On staging: wip\nstash@{1}: WIP")
        ).toBe(false);
        expect(hasLintStagedStash("")).toBe(false);
    });

    /**
     * The behavioural half: `executePlan` must re-assert BEFORE it renders.
     * `main()` injects `assertQuiet`, which exits the process on a moved
     * tree; if the receipt were printed first, the reader would already have
     * been told this tree was gated.
     *
     * Proof-of-failure: deleted `const endHead = endHeadOf();` from
     * `executePlan` (rendering `head` for both) — this test went red
     * (`lines` was non-empty, the receipt had been printed). Reverted.
     */
    it("re-asserts the tree after the last check and before the receipt", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const lines: string[] = [];
        const exec = (): { ok: boolean; ms: number } => ({ ok: true, ms: 1 });
        expect(() =>
            executePlan(
                plan,
                "4f2a91c",
                true,
                exec,
                (l) => lines.push(l),
                () => {
                    throw new Error("tree moved");
                }
            )
        ).toThrow("tree moved");
        expect(lines).toEqual([]);
    });

    /**
     * The re-assertion has to bracket EVERY check, not the run as a whole
     * (round-1 review). An `engine` or `full` lane runs fourteen checks over
     * minutes; a stash pushed and popped inside that span leaves HEAD,
     * status and the stash list identical at both ends, so an assertion
     * taken only after the last check sees nothing — while whichever checks
     * ran in the middle read the moved tree. That is this file's own bug,
     * relocated one level down.
     *
     * Proof-of-failure: deleted the `assertQuiet();` line from `runPlan`'s
     * loop — this test went red (`calls` was `["check-1"]`, the assertion
     * having fired only once, after the whole run). Reverted.
     */
    it("re-asserts before EVERY check, not once around the whole run", () => {
        const plan: LanePlan = {
            lane: "engine",
            rationale: "3 files",
            files: ["convex/gre/a.ts"],
            run: [
                { id: "check-1", command: "bun run a" },
                { id: "check-2", command: "bun run b" },
                { id: "check-3", command: "bun run c" },
            ],
            skip: [],
        };
        const calls: string[] = [];
        let running = "";
        const result = runPlan(
            plan,
            (command) => {
                running = command;
                return { ok: true, ms: 1 };
            },
            () => {
                calls.push(running === "" ? "before-first" : running);
                return "4f2a91c";
            }
        );
        expect(result.ok).toBe(true);
        // One assertion per check, each taken BEFORE that check ran: the
        // list is the state of the run at each assertion, so it lags the
        // command list by one.
        expect(calls).toEqual(["before-first", "bun run a", "bun run b"]);
    });

    it("stops asserting once a check has failed — the run is over", () => {
        const plan: LanePlan = {
            lane: "engine",
            rationale: "3 files",
            files: ["convex/gre/a.ts"],
            run: [
                { id: "check-1", command: "bun run a" },
                { id: "check-2", command: "bun run b" },
            ],
            skip: [],
        };
        let asserts = 0;
        const result = runPlan(
            plan,
            () => ({ ok: false, ms: 1 }),
            () => {
                asserts += 1;
                return "4f2a91c";
            }
        );
        expect(result.ok).toBe(false);
        expect(asserts).toBe(1);
    });

    it("carries the start and end sha in the human receipt", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const lines: string[] = [];
        executePlan(
            plan,
            "4f2a91c",
            false,
            () => ({ ok: true, ms: 1 }),
            (l) => lines.push(l),
            () => "4f2a91c"
        );
        expect(lines.join("\n")).toContain("tree:  4f2a91c → 4f2a91c");
    });

    it("carries the end sha in the json form", () => {
        const plan = classifyLane(["src/app.tsx"]);
        const lines: string[] = [];
        executePlan(
            plan,
            "4f2a91c",
            true,
            () => ({ ok: true, ms: 1 }),
            (l) => lines.push(l),
            () => "4f2a91c"
        );
        const parsed = JSON.parse(lines.join("\n")) as {
            head: string;
            endHead: string;
        };
        expect(parsed.head).toBe("4f2a91c");
        expect(parsed.endHead).toBe("4f2a91c");
    });

    /**
     * The structural half: the re-assertion has to be IN `main()`, between
     * the classification and anything that prints or runs, and it has to be
     * the function `executePlan` gets as its end-of-run hook. Every pure
     * test above stays green if `main()` simply never calls `assertQuiet` —
     * which is the whole bug, one level up.
     *
     * Proof-of-failure: deleted the `assertQuiet();` call that follows
     * `classifyLane` in `main()` — this test went red (no re-assertion
     * between the classification and the `planOnly` branch). Reverted.
     */
    it("main() re-asserts between classification and any output, and hands assertQuiet to executePlan", () => {
        const src = readFileSync(
            resolve(ROOT, "scripts/check-lane.ts"),
            "utf8"
        );
        const classify = src.indexOf("const plan = classifyLane(");
        const planOnly = src.indexOf("if (planOnly) {");
        const exec = src.indexOf("const result = executePlan(");
        expect(classify).toBeGreaterThan(-1);
        expect(planOnly).toBeGreaterThan(classify);
        expect(exec).toBeGreaterThan(planOnly);
        expect(src.slice(classify, planOnly)).toContain("assertQuiet();");
        expect(src.slice(exec)).toContain("assertQuiet");
    });
});
