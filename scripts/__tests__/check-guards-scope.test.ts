import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import vitestConfig from "../../vitest.config";
import { classifyLane } from "../check-lane";

/**
 * `check:guards` scope guard — the light gate must run the WHOLE node project.
 *
 * History. #1912 put the bot suite into `check:pr` because that is where the
 * catalogue-wide bot guards live. The same hole existed one suite over and was
 * left open: the node half of the application suite (`convex/**` + `scripts/**`)
 * was selected as `vitest run --project node scripts/__tests__`, i.e. the repo's
 * own hygiene tests only. Every catalogue guard under `convex/` — the Effect
 * Script validator's three-way Op-registry/executor/schema coverage
 * (`convex/gre/effects/__tests__/validate.test.ts`), `mechanicsRegistry`,
 * `divergenceMarkers`, `effectScripts`, `serialize`'s persisted-key drift check,
 * `tokenPrintLookup` — was outside the light gate. A branch reached review with
 * `validate.test.ts` red and a `check:pr` that exited 0, and the "green" claim in
 * the PR was made in good faith.
 *
 * Fix: drop the path filter. The whole node project costs ~26s at the light
 * tier's 2 workers (577 files, measured on main) — cheaper than the bot fast
 * lane it already runs, because node needs no jsdom environment init and the
 * project runs `isolate: false`, so the ~290-module card registry is imported
 * once per worker instead of once per file.
 *
 * That price is only true while the selection stays whole. A path filter, an
 * `--exclude`, or a deny-list added here re-opens the hole in exactly the way
 * that is invisible: the gate still prints green, just over fewer files. This
 * test pins the selection.
 *
 * Deliberately in `scripts/__tests__`: it must keep running under `bun run test`
 * even if someone narrows the very lane it describes.
 */

const ROOT = path.resolve(__dirname, "../..");

interface Pkg {
    scripts: Record<string, string>;
}

const pkg: Pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
);

/**
 * Positional (non-flag) arguments of a `vitest run …` command — vitest treats
 * every one of them as a filename filter, which is exactly what must not
 * appear here. `--project x` consumes its value, so it is not positional.
 */
function positionalFilters(segment: string): string[] {
    const tokens = segment.trim().split(/\s+/);
    const runAt = tokens.findIndex((t) => t === "run");
    expect(runAt, `no "vitest run" in: ${segment}`).toBeGreaterThan(-1);
    const out: string[] = [];
    for (let i = runAt + 1; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === "--project" || tok === "--config" || tok === "--reporter") {
            i++;
            continue;
        }
        if (tok.startsWith("-")) continue;
        out.push(tok);
    }
    return out;
}

describe("check:guards scope — the light gate runs the whole node project", () => {
    const guards = pkg.scripts["check:guards"];
    const segments = guards.split("&&").map((s) => s.trim());
    const nodeSegment = segments.find(
        (s) =>
            /--project\s+node-engine\b/.test(s) &&
            /--project\s+node-tooling\b/.test(s)
    );

    it("has a node-project segment at all — both partitions (ADR 0136 §5)", () => {
        expect(
            nodeSegment,
            `check:guards must run the application suite's node project. Current value:\n  ${guards}`
        ).toBeTruthy();
    });

    it("selects the node project with NO path filter", () => {
        const filters = positionalFilters(nodeSegment!);
        expect(
            filters,
            `check:guards narrows the node project to ${JSON.stringify(filters)}. ` +
                `Every catalogue guard outside those paths (validate.test.ts, mechanicsRegistry, ` +
                `divergenceMarkers, serialize's drift check, …) then passes check:pr without ` +
                `running — the gate stays green while the branch is red, which is how a red PR ` +
                `reached review claiming green. The whole project is ~26s at 2 workers: run it.`
        ).toEqual([]);
    });

    it("is reached from check:pr", () => {
        expect(pkg.scripts["check:pr"]).toContain("check:guards");
    });

    it("still runs the bot fast lane (#1912 is not undone)", () => {
        expect(guards).toContain("TOLARIA_BOT_FAST=1");
        expect(guards).toMatch(/--project\s+bot-node/);
        expect(guards).toMatch(/--project\s+bot-dom/);
    });

    it("runs the CR-citation sweep (#2429)", () => {
        // Offline and ~1s: it reads only the vendored document, so it does not
        // break the gate's no-network contract (ADR 0098). Belt and braces with
        // `scripts/__tests__/cr-citations.test.ts`, which runs the same scan
        // inside the node project — either alone would catch a bad citation,
        // and the pair survives one of them being dropped.
        expect(guards).toContain("cr:lint");
    });
});

describe("check:guards scope — the light gate runs the whole dom project (#2655)", () => {
    // #2584 died on a shell-height CENSUS guard
    // (src/components/chrome/__tests__/shell-height-claims.guard.test.tsx) — a
    // file the failing diff never touched, which reds BECAUSE some OTHER
    // src/ file changed. A diff-derived subset of the dom project would not
    // have caught it: the coverage has to be the WHOLE project, same as the
    // node project's rule above, for the same reason.
    //
    // Before this, an implement-subagent's `check:pr` never ran the dom
    // project at all — it runs only inside `bun run test:app` (heavy tier),
    // which is blocked in an issue worktree by design (scripts/gate.ts). A
    // src/ guard was invisible until the merge-train re-gated the rebased
    // tree, after review had already been paid for.
    const guards = pkg.scripts["check:guards"];
    const segments = guards.split("&&").map((s) => s.trim());
    const nodeSegment = segments.find((s) =>
        /--project\s+node-engine\b/.test(s)
    );
    const domSegment = segments.find(
        (s) => /--project\s+dom\b/.test(s) && !/bot-dom/.test(s)
    );

    it("has a dom-project segment at all", () => {
        expect(
            domSegment,
            `check:guards must run the application suite's dom project — every src/ component ` +
                `and layout guard is invisible until the merge-train otherwise (#2584). Current ` +
                `value:\n  ${guards}`
        ).toBeTruthy();
    });

    it("selects the dom project with NO path filter", () => {
        const filters = positionalFilters(domSegment!);
        expect(
            filters,
            `check:guards narrows the dom project to ${JSON.stringify(filters)}. A census guard ` +
                `outside those paths (e.g. shell-height-claims.guard.test.tsx, which fails because ` +
                `some OTHER src/ file changed, not because of an edit to itself) then passes ` +
                `check:pr without running — exactly the #2584 shape, undetectable from the diff.`
        ).toEqual([]);
    });

    it("shares the node segment's invocation — no separate mutex, no separate lock", () => {
        // `vitest run --project node-engine --project node-tooling --project
        // dom` is ONE process inside ONE
        // `check:guards` command, which check:pr already runs under
        // `bun scripts/gate.ts light` (pinned by
        // worktree-bootstrap.test.ts's "light pre-PR gate" describe block).
        // Light never takes the machine-wide mutex and caps vitest workers at
        // TOLARIA_VITEST_WORKERS (default 2, vitest.config.ts) — adding dom
        // here must not require `heavy` or `TOLARIA_ALLOW_FULL_SUITE`.
        expect(domSegment).toBe(nodeSegment);
    });

    it("is reached from check:pr, which the issue-worktree guard never blocks", () => {
        expect(pkg.scripts["check:pr"]).toContain("check:guards");
        expect(pkg.scripts["check:pr"]).toMatch(/gate\.ts\s+light\b/);
    });
});

describe("the node partitions are the whole backend half of the app suite (ADR 0136 §5)", () => {
    interface ProjectConfig {
        test?: { name?: string; include?: string[] };
    }
    const projects =
        (vitestConfig as { test?: { projects?: ProjectConfig[] } }).test
            ?.projects ?? [];
    const include = (name: string) =>
        projects.find((p) => p.test?.name === name)?.test?.include ?? [];

    it("node-engine includes convex/** and node-tooling only scripts/**", () => {
        // `check:guards` buys its coverage from these globs — if node-engine
        // stops covering convex/, dropping the path filter above buys nothing.
        expect(include("node-engine")).toContain("convex/**/*.test.ts");
        const tooling = include("node-tooling");
        expect(tooling.length).toBeGreaterThan(0);
        for (const f of tooling) expect(f).toMatch(/^scripts\//);
    });
});

/**
 * ADR 0136 §5 amends ADR 0104 §2: a lane may run a FIXED partition of a
 * project. The partition names are the contract — this pins which lane runs
 * which, and that the retired `node` id is named nowhere: a `--project node`
 * left in a script or a lane names a project that no longer exists.
 */
describe("node partitions — which lane runs which (ADR 0136 §5)", () => {
    const vitestCommands = (cmd: string) =>
        cmd.split("&&").filter((seg) => /vitest run/.test(seg));
    const engine = classifyLane(["convex/gre/engine.ts"]);

    it("the engine lane runs node-engine whole", () => {
        const node = engine.run.find((c) => c.id === "node-engine");
        expect(node?.command).toBe("bunx vitest run --project node-engine");
        expect(positionalFilters(node!.command)).toEqual([]);
    });

    it("check:pr (via check:guards) and test:app run both partitions", () => {
        for (const script of ["check:guards", "test:app"]) {
            const cmd = pkg.scripts[script];
            expect(cmd, script).toMatch(/--project\s+node-engine\b/);
            expect(cmd, script).toMatch(/--project\s+node-tooling\b/);
        }
        expect(pkg.scripts["check:pr"]).toContain("check:guards");
    });

    it("no script and no lane names the retired `node` project", () => {
        const plans = [
            classifyLane(["src/app.tsx"]),
            engine,
            classifyLane(["scripts/land.ts"]),
            classifyLane([
                "convex/cards/sets/lea/red.ts",
                "data/card-index.json",
            ]),
            classifyLane(["docs/adr/0111.md"]),
            classifyLane(["CONTEXT.md", "convex/gre/engine.ts"]),
            classifyLane(["package.json"]),
        ];
        const commands = [
            ...Object.entries(pkg.scripts).flatMap(([name, cmd]) =>
                vitestCommands(cmd).map((c) => [`package.json ${name}`, c])
            ),
            ...plans.flatMap((p) =>
                p.run.map((c) => [`${p.lane} lane ${c.id}`, c.command])
            ),
        ];
        const retired = commands.filter(([, c]) =>
            /--project\s+node(?![\w-])/.test(c)
        );
        expect(
            retired.map(([where]) => where),
            "`--project node` names a project that no longer exists (ADR 0136 §5). " +
                "Name node-engine, node-tooling, or both."
        ).toEqual([]);
    });
});

describe("the dom project is the whole DOM-dependent half of the app suite (#2655)", () => {
    const config = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const domBlock = config.match(
        /name:\s*"dom"[\s\S]*?include:\s*\[([\s\S]*?)\]/
    )?.[1];

    it("includes src/**", () => {
        expect(domBlock, "dom project include not found").toBeTruthy();
        // `check:guards`'s dom segment buys its coverage from this glob — if
        // the project narrows, dropping the path filter above buys nothing.
        expect(domBlock!).toContain("src/**");
    });
});

describe("the cards lane runs a FIXED partition of node and bot-node (ADR 0136 §4/§5, issue #3778)", () => {
    // ADR 0104 forbids a test selection computed from the changed files; ADR
    // 0136 §5 admits a fixed partition classified by content. The cards lane
    // sits exactly on that line: `convex/cards/` whole — every catalogue
    // guard and EVERY set's tests — never "the touched set's own __tests__".
    // A card borrowed by another set's test file is proven either way, and
    // the price is measured (425 node files in 18s, 16 bot files in 8s).
    const PARTITION = ["convex/cards/"];
    const plan = (files: string[]) => classifyLane(files);
    const command = (files: string[], id: string) => {
        const check = plan(files).run.find((c) => c.id === id);
        expect(check, `${id} missing from the cards lane`).toBeTruthy();
        return check!.command;
    };
    const LEA = ["convex/cards/sets/lea/red.ts", "data/card-index.json"];
    const WAR = ["convex/cards/sets/war/black.ts"];

    it("both diffs are the cards lane (else the rest proves nothing)", () => {
        expect(plan(LEA).lane).toBe("cards");
        expect(plan(WAR).lane).toBe("cards");
    });

    it("node[cards] selects the node project over convex/cards/ and nothing else", () => {
        const cmd = command(LEA, "node[cards]");
        expect(cmd).toMatch(/--project\s+node\b/);
        expect(positionalFilters(cmd)).toEqual(PARTITION);
    });

    it("bot[cards] selects the bot-node project over convex/cards/ and nothing else", () => {
        const cmd = command(LEA, "bot[cards]");
        expect(cmd).toMatch(/--project\s+bot-node\b/);
        // The censuses run whole: TOLARIA_BOT_FAST would skip slow files.
        expect(cmd).not.toContain("TOLARIA_BOT_FAST");
        expect(positionalFilters(cmd)).toEqual(PARTITION);
    });

    it("the partition does not move with the diff — two different sets, identical selections", () => {
        for (const id of ["node[cards]", "bot[cards]"]) {
            expect(command(WAR, id), id).toBe(command(LEA, id));
        }
    });

    it("the three bot censuses live inside the partition and inside bot-node's include", () => {
        const config = fs.readFileSync(
            path.join(ROOT, "vitest.config.ts"),
            "utf8"
        );
        expect(config).toMatch(
            /BOT_GLOB_NODE\s*=\s*\[[^\]]*"convex\/\*\*\/\*\.bot\.test\.ts"/
        );
        for (const census of [
            "aiEffectsGuard.bot.test.ts",
            "opValuerCoverage.bot.test.ts",
            "opBeneficenceCensus.bot.test.ts",
        ]) {
            const file = path.join("convex/cards/__tests__", census);
            expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
            expect(file.startsWith(PARTITION[0]), file).toBe(true);
        }
    });
});
