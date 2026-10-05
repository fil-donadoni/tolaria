/**
 * Keeps a worktree's `convex/_generated/` in step with its OWN `convex/` tree
 * (issue #5077).
 *
 * WHY. The generated API is gitignored, and a fresh worktree gets it by COPY
 * from the primary checkout. Nothing refreshes the primary's copy when a PR
 * lands, so after a landing that adds Convex modules the copy describes the
 * tree BEFORE it — and every worktree cut from it (a health run's included)
 * reds at the type-check with `Property '<module>' does not exist` on `api`.
 * Observed after PR #5069: 58 errors, a RED marker on a tree with nothing
 * wrong in it.
 *
 * The only part of the generated API that depends on the tree is its module
 * list (`dataModel.d.ts` reads the schema by `typeof import`, `server.*` are
 * fixed). So the check is a comparison of two lists: the `api.d.ts` keys and
 * the files the Convex CLI would discover (`convex-entry-points.ts`, ~40 ms).
 * Equal → the copy is kept byte-for-byte. Different → the CLI regenerates it
 * for this tree, offline: `convex codegen --system-udfs` takes the code path
 * that needs no deployment and never starts a backend (~0.8 s). That path
 * emits the generator's component-less variant — no `components` export,
 * which nothing here imports while `convex/convex.config.ts` does not exist;
 * when one does, regeneration is refused rather than silently drop it.
 *
 * Zero imports beyond node builtins and the builtins-only
 * `convex-entry-points.ts` ON PURPOSE — `bootstrap-worktree.ts` imports it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { discoverEntryPoints } from "./convex-entry-points";

export const GENERATED_API = join("convex", "_generated", "api.d.ts");

/** The module keys of a generated `api.d.ts` — `auth`, `"cards/sets/x"`, … */
export function generatedApiModules(apiDts: string): string[] {
    return [...apiDts.matchAll(/^ {2}"?([^":\s]+)"?: typeof /gm)]
        .map((m) => m[1])
        .sort();
}

/** The module keys the Convex CLI would generate for `convexDir`. */
export function convexModules(convexDir: string): string[] {
    return discoverEntryPoints(convexDir)
        .map((f) =>
            relative(convexDir, f)
                .split(sep)
                .join("/")
                .replace(/\.[^./]+$/, "")
        )
        .sort();
}

export interface GeneratedApiDrift {
    /** Modules in the tree the generated `api` lacks. */
    missing: string[];
    /** Modules the generated `api` names that the tree no longer has. */
    extra: string[];
}

/** null when `root` has no generated API at all. */
export function generatedApiDrift(root: string): GeneratedApiDrift | null {
    const api = join(root, GENERATED_API);
    if (!existsSync(api)) return null;
    const have = new Set(generatedApiModules(readFileSync(api, "utf8")));
    const want = convexModules(join(root, "convex"));
    const wanted = new Set(want);
    return {
        missing: want.filter((m) => !have.has(m)),
        extra: [...have].filter((m) => !wanted.has(m)).sort(),
    };
}

export type Codegen = (root: string) => { ok: boolean; detail: string };

/** The Convex CLI's own generator, on the path that needs no deployment. */
export const convexCodegen: Codegen = (root) => {
    const r = spawnSync(
        join(root, "node_modules", ".bin", "convex"),
        ["codegen", "--system-udfs", "--typecheck", "disable"],
        { cwd: root, encoding: "utf8", timeout: 120_000 }
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return {
        ok: r.status === 0,
        detail: r.error
            ? `${String(r.error)} — is \`bun install\` done?`
            : out.split("\n").slice(-1)[0],
    };
};

export type RefreshOutcome =
    | { kind: "fresh" }
    | { kind: "regenerated"; drift: GeneratedApiDrift | null }
    | { kind: "failed"; reason: string };

function describeDrift(drift: GeneratedApiDrift | null): string {
    if (drift === null) return "no copy";
    const parts: string[] = [];
    const list = (ms: string[]) =>
        ms.slice(0, 4).join(", ") +
        (ms.length > 4 ? `, +${ms.length - 4}` : "");
    if (drift.missing.length) parts.push(`lacked ${list(drift.missing)}`);
    if (drift.extra.length) parts.push(`had stale ${list(drift.extra)}`);
    return parts.join("; ");
}

/**
 * Leaves `root`'s generated API matching `root`'s own `convex/` tree:
 * untouched when it already does, regenerated when it does not (or is
 * absent), `failed` when it still does not afterwards.
 */
export function refreshGeneratedApi(
    root: string,
    codegen: Codegen = convexCodegen
): RefreshOutcome {
    const drift = generatedApiDrift(root);
    if (drift && drift.missing.length === 0 && drift.extra.length === 0)
        return { kind: "fresh" };
    if (existsSync(join(root, "convex", "convex.config.ts")))
        return {
            kind: "failed",
            reason: `generated API ${describeDrift(drift)} — this tree defines components, which offline codegen would drop; run \`bunx convex codegen\` against a deployment`,
        };
    const r = codegen(root);
    if (!r.ok)
        return {
            kind: "failed",
            reason: `generated API ${describeDrift(drift)} and \`convex codegen\` failed: ${r.detail}`,
        };
    const after = generatedApiDrift(root);
    if (after === null || after.missing.length || after.extra.length)
        return {
            kind: "failed",
            reason: `\`convex codegen\` ran but the generated API still ${describeDrift(after)}`,
        };
    return { kind: "regenerated", drift };
}

/** One receipt line, in `worktree:init`'s vocabulary. */
export function refreshReceipt(outcome: RefreshOutcome): string {
    switch (outcome.kind) {
        case "fresh":
            return "convex/_generated (matches this tree)";
        case "regenerated":
            return `convex/_generated (regenerated for this tree — the copy ${describeDrift(outcome.drift)})`;
        case "failed":
            return `convex/_generated — ${outcome.reason}`;
    }
}
