// `bun run census:check` — the Profile Census's own gate
// (`.claude/skills/profile-census/SKILL.md`): judges the seed file a pass
// rewrote against the same file at a git ref (default HEAD, i.e. before the
// uncommitted pass), and validates residue files. Every rule lives in the
// pure `scripts/lib/profile-census.ts` / `convex/limited/cardProfilesCore.ts`;
// this file only reads files.
//
//   bun run census:check -- --layer capabilities [--rows a,b] [--ref <git-ref>]
//   bun run census:check -- --layer archetypes --scope vintage-cube [--rows a]
//   bun run census:check -- --residue data/card-profiles/residue/<file>.json
//
// Exit 0 = legal, 1 = refused (each reason printed), 2 = bad arguments.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCensusResidue } from "../convex/limited/cardProfilesCore";
import { censusWriteErrors, type CensusLayer } from "./lib/profile-census";

const REPO_ROOT = resolve(__dirname, "..");

function seedPath(layer: CensusLayer, scope: string | undefined): string {
    return layer === "capabilities"
        ? "data/card-profiles/capabilities.json"
        : `data/card-profiles/archetypes/${scope}.json`;
}

function atRef(ref: string, rel: string): unknown {
    try {
        const text = execFileSync("git", ["show", `${ref}:${rel}`], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            maxBuffer: 64 * 1024 * 1024,
        });
        return JSON.parse(text);
    } catch {
        return null; // a scope with no seed file at `ref` yet
    }
}

function main(argv: string[]): number {
    const arg = (flag: string): string | undefined => {
        const i = argv.indexOf(flag);
        return i < 0 ? undefined : argv[i + 1];
    };
    const residues = argv.flatMap((a, i) =>
        argv[i - 1] === "--residue" ? [a] : []
    );
    const layer = arg("--layer");
    if (residues.length === 0 && layer === undefined) {
        console.error(
            "usage: census:check --layer capabilities|archetypes [--scope s] [--rows a,b] [--ref r] | --residue <file>…"
        );
        return 2;
    }
    const errors: string[] = [];
    for (const file of residues) {
        const result = validateCensusResidue(
            JSON.parse(readFileSync(resolve(file), "utf8"))
        );
        errors.push(...result.errors.map((e) => `${file}: ${e}`));
    }
    if (layer !== undefined) {
        if (layer !== "capabilities" && layer !== "archetypes") {
            console.error(`--layer "${layer}" is not capabilities|archetypes`);
            return 2;
        }
        const scope = arg("--scope");
        if (layer === "archetypes" && scope === undefined) {
            console.error("--layer archetypes needs --scope");
            return 2;
        }
        const rel = seedPath(layer, scope);
        if (!existsSync(resolve(REPO_ROOT, rel))) {
            console.error(`${rel} does not exist`);
            return 2;
        }
        const after = JSON.parse(readFileSync(resolve(REPO_ROOT, rel), "utf8"));
        const before = atRef(arg("--ref") ?? "HEAD", rel);
        const rows = arg("--rows")?.split(",").filter(Boolean);
        errors.push(
            ...censusWriteErrors({ layer, before, after, rows } as Parameters<
                typeof censusWriteErrors
            >[0]).map((e) => `${rel}: ${e}`)
        );
    }
    for (const error of errors) console.error(error);
    console.log(
        errors.length === 0
            ? "census:check: PASS"
            : `census:check: REFUSED (${errors.length})`
    );
    return errors.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
