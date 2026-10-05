// When a health batch owes the blade robustness audit, and how much of it
// (issue #5078). The predicate is pure over an injected closure and registry
// diff; the last block runs it against the real tree.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { batchTouchesBot } from "../lib/health-bot-refresh";
import {
    describeRobustnessMode,
    REGISTRY_PATH,
    robustnessMode,
    robustnessModeFromGit,
    robustnessOwed,
    robustnessStepEnv,
    ROBUSTNESS_LABELS_ENV,
    ROBUSTNESS_ROOTS,
    gitTreeSource,
} from "../lib/health-robustness-trigger";
import { createImportGraph } from "../lib/import-graph";
import { matchesBotGlob } from "../lib/bot-globs";
import type { RegistryChange } from "../lib/blade-registry-entries";

const WEIGHTS = "convex/gre/ai/evalWeights.ts";
const VALUER = "convex/gre/ai/opValuers.ts";
const SEARCH_ONLY_TODAY = "convex/gre/ai/newValuer.ts";
const CLOSURE = new Set([
    WEIGHTS,
    VALUER,
    REGISTRY_PATH,
    "convex/gre/search.ts",
]);

function mode(
    changed: readonly string[] | null,
    opts: { closure?: ReadonlySet<string>; registry?: RegistryChange } = {}
) {
    return robustnessMode({
        changed,
        closure: () => opts.closure ?? CLOSURE,
        registry: () =>
            opts.registry ?? { kind: "entries", labels: ["entry A"] },
    });
}

describe("robustnessMode — no audit", () => {
    it("a batch of bot:reach sweep modules and src/lib/ai quiz files owes none, though it touches the Bot", () => {
        const changed = [
            "convex/gre/ai/botReachBlink.ts",
            "convex/gre/ai/botReachStack.ts",
            "src/lib/ai/verdict-quiz-builder.ts",
            "src/lib/ai/eval-term-labels.ts",
        ];
        // Today's predicate: any Bot-glob file triggers.
        expect(batchTouchesBot(changed)).toBe(true);
        expect(mode(changed).kind).toBe("none");
    });

    it("a batch outside the Bot globs owes none, without asking for the closure", () => {
        const m = robustnessMode({
            changed: ["convex/cards/sets/arn.ts", "scripts/health-main.ts"],
            closure: () => {
                throw new Error("closure must not be built");
            },
            registry: () => {
                throw new Error("registry must not be read");
            },
        });
        expect(m.kind).toBe("none");
    });

    it("an empty diff owes none", () => {
        expect(mode([]).kind).toBe("none");
    });

    it("the engine is a declared residual: a closure file outside the Bot globs never triggers", () => {
        const m = mode(["convex/gre/combat.ts"], {
            closure: new Set([...CLOSURE, "convex/gre/combat.ts"]),
        });
        expect(m.kind).toBe("none");
    });
});

describe("robustnessMode — full audit", () => {
    it("the eval-weights module", () => {
        const m = mode([WEIGHTS]);
        expect(m).toMatchObject({ kind: "full" });
        expect(m.reason).toContain(WEIGHTS);
    });

    it("a search-reachable valuer module", () => {
        expect(mode(["convex/gre/search.ts"]).kind).toBe("full");
        expect(mode([VALUER]).kind).toBe("full");
    });

    it("a module the search starts importing joins by itself — the closure decides, not a list", () => {
        const changed = [SEARCH_ONLY_TODAY];
        expect(mode(changed).kind).toBe("none");
        const grown = new Set([...CLOSURE, SEARCH_ONLY_TODAY]);
        expect(mode(changed, { closure: grown }).kind).toBe("full");
    });

    it("an unknown last-GREEN tip or unreadable diff", () => {
        const m = mode(null);
        expect(m.kind).toBe("full");
        expect(m.reason).toMatch(/unknown last-GREEN/);
    });

    it("the registry plus another closure file", () => {
        expect(mode([REGISTRY_PATH, VALUER]).kind).toBe("full");
    });

    it("a registry change outside its entries", () => {
        const m = mode([REGISTRY_PATH], {
            registry: { kind: "other", why: "changed outside its entries" },
        });
        expect(m.kind).toBe("full");
    });
});

describe("robustnessMode — incremental audit", () => {
    it("a batch adding one must entry and nothing else trigger-relevant audits exactly that entry", () => {
        const m = mode([REGISTRY_PATH, "convex/gre/ai/botReach.ts"], {
            registry: { kind: "entries", labels: ["new entry"] },
        });
        expect(m).toMatchObject({ kind: "incremental", labels: ["new entry"] });
        expect(robustnessOwed(m)).toBe(true);
        expect(robustnessStepEnv(m)).toEqual({
            [ROBUSTNESS_LABELS_ENV]: JSON.stringify(["new entry"]),
        });
    });

    it("a registry change touching no must entry owes none", () => {
        const m = mode([REGISTRY_PATH], {
            registry: { kind: "entries", labels: [] },
        });
        expect(m.kind).toBe("none");
        expect(robustnessOwed(m)).toBe(false);
        expect(robustnessStepEnv(m)).toBeUndefined();
    });
});

describe("wiring", () => {
    const root = join(__dirname, "..", "..");
    const read = (rel: string) => readFileSync(join(root, rel), "utf8");

    it("the label filter's env name is the one the shard runner reads", () => {
        expect(
            read(
                "convex/gre/ai/blade/__tests__/robustnessShardRunner.helper.ts"
            )
        ).toContain(`ENV.${ROBUSTNESS_LABELS_ENV}`);
    });

    it("health-main hands the mode's env to the audit step and records the mode", () => {
        const src = read("scripts/health-main.ts");
        expect(src).toContain("robustnessStepEnv(robustness)");
        expect(src).toContain("ctx.robustness = describeRobustnessMode");
        // The Bot Findings refresh keeps its own, wider predicate.
        expect(src).toContain("batchTouchesBot(batch)");
    });
});

describe("describeRobustnessMode", () => {
    it("names the mode and why", () => {
        expect(describeRobustnessMode(mode([WEIGHTS]))).toBe(
            `blade:robustness full — ${WEIGHTS} is in the audit's closure`
        );
        expect(describeRobustnessMode(mode([]))).toMatch(/not run — /);
    });
});

describe("the audit's closure on the real tree", () => {
    const root = join(__dirname, "..", "..");
    const graph = createImportGraph({
        root,
        source: gitTreeSource(root, "HEAD"),
    });
    const closure = new Set<string>();
    for (const entry of ROBUSTNESS_ROOTS)
        for (const f of graph.closureOf(entry)) closure.add(f);

    it("holds what the search runs", () => {
        for (const f of [
            WEIGHTS,
            VALUER,
            "convex/gre/search.ts",
            "convex/gre/evaluate.ts",
            "convex/gre/ai/blade/runner.ts",
            "convex/gre/ai/blade/robustness.ts",
            REGISTRY_PATH,
        ])
            expect(closure.has(f), f).toBe(true);
    });

    it("drops the Bot tooling the search never imports", () => {
        expect(closure.has("convex/gre/ai/botReach.ts")).toBe(false);
        expect(closure.has("src/lib/ai/eval-term-labels.ts")).toBe(false);
        const tooling = [...closure].filter(
            (f) => matchesBotGlob(f) && /botReach|\/src\/lib\/ai\//.test(f)
        );
        expect(tooling).toEqual([]);
    });
});

describe("robustnessModeFromGit — against a throwaway repository", () => {
    const REG = `export const BLADE_SCENARIOS: BladeScenario[] = [\n{ label: "A", tier: "must" },\n];\n`;
    const FILES: Record<string, string> = {
        "convex/gre/ai/blade/__tests__/robustnessShardRunner.helper.ts": `import "../registry";\nimport "../../valuer";\n`,
        [REGISTRY_PATH]: REG,
        "convex/gre/ai/valuer.ts": "export const v = 1;\n",
        "convex/gre/ai/evalWeights.ts": "export const w = 1;\n",
        "convex/gre/ai/botReachX.ts": "export const r = 1;\n",
    };
    const dir = mkdtempSync(join(tmpdir(), "robustness-trigger-"));
    const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    const write = (path: string, text: string) => {
        mkdirSync(join(dir, dirname(path)), { recursive: true });
        writeFileSync(join(dir, path), text);
    };
    const commit = (msg: string) => {
        git("add", "-A");
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg);
        return git("rev-parse", "HEAD");
    };
    const green = (() => {
        git("init", "-q");
        for (const [p, t] of Object.entries(FILES)) write(p, t);
        return commit("green");
    })();
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const run = (greenSha: string | null, tip: string) =>
        robustnessModeFromGit({
            root: dir,
            green: greenSha,
            tip,
            changed:
                greenSha === null
                    ? null
                    : git("diff", "--name-only", `${greenSha}..${tip}`)
                          .split("\n")
                          .filter(Boolean),
        });

    it("tooling the search never imports: no audit", () => {
        write("convex/gre/ai/botReachX.ts", "export const r = 2;\n");
        expect(run(green, commit("tooling")).kind).toBe("none");
    });

    it("a module in the closure: full audit", () => {
        write("convex/gre/ai/valuer.ts", "export const v = 2;\n");
        expect(run(green, commit("valuer")).kind).toBe("full");
    });

    it("one added must entry (and a stretch one): incremental, exactly that entry", () => {
        // The base is the tip the earlier tests left: its valuer change is
        // already behind us, so this batch touches the registry alone.
        const base = git("rev-parse", "HEAD");
        write(
            REGISTRY_PATH,
            REG.replace(
                "];",
                '{ label: "B: new", tier: "must" },\n{ label: "C", tier: "stretch" },\n];'
            )
        );
        expect(run(base, commit("entries"))).toMatchObject({
            kind: "incremental",
            labels: ["B: new"],
        });
    });

    it("an unknown last-GREEN tip: full audit", () => {
        expect(run(null, green).kind).toBe("full");
    });
});
