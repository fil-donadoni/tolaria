import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

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
        (s) => /--project\s+node\b/.test(s) && !/bot-node/.test(s)
    );

    it("has a node-project segment at all", () => {
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
    const nodeSegment = segments.find(
        (s) => /--project\s+node\b/.test(s) && !/bot-node/.test(s)
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
        // `vitest run --project node --project dom` is ONE process inside ONE
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

describe("the node project is the whole backend half of the app suite", () => {
    const config = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    const nodeBlock = config.match(
        /name:\s*"node"[\s\S]*?include:\s*\[([\s\S]*?)\]/
    )?.[1];

    it("includes both convex/** and scripts/**", () => {
        expect(nodeBlock, "node project include not found").toBeTruthy();
        // `check:guards` buys its coverage from this glob — if the project stops
        // covering convex/, dropping the path filter above buys nothing.
        expect(nodeBlock!).toContain("convex/**");
        expect(nodeBlock!).toContain("scripts/**");
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
