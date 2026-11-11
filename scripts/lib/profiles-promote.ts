// `profiles:promote` core (PRD #8772, issue #8907): takes a Card Profile
// export (the Admin tool's Export button) back into the repository. The text
// is parsed, checked by `checkPromotableSeedFile` — the seed-file schema plus
// the SAME validators the CI seed guards run (Capability registry, Archetype
// catalogue seed, card ids) — and only a file that passes every check
// replaces the matching seed file, formatted by the repository's prettier
// config so `format:check` stays green. A refused file writes NOTHING.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as prettier from "prettier";
import {
    checkPromotableSeedFile,
    seedFilePath,
    serializeSeedFile,
} from "../../convex/limited/cardProfileSeedFiles";

export type PromoteResult =
    | { ok: true; path: string; rows: number }
    | { ok: false; errors: string[] };

/** Validates `text` as a Card Profile seed file and, only when it passes,
 *  overwrites the seed file it names under `repoRoot`. */
export async function promoteSeedFile(
    text: string,
    repoRoot: string
): Promise<PromoteResult> {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return {
            ok: false,
            errors: [`not JSON: ${(error as Error).message}`],
        };
    }
    const checked = checkPromotableSeedFile(json);
    if (!checked.ok) return checked;
    const rel = seedFilePath(checked.seed);
    const target = resolve(repoRoot, rel);
    if (!existsSync(target)) {
        return { ok: false, errors: [`${rel} does not exist to replace`] };
    }
    const options = (await prettier.resolveConfig(target)) ?? {};
    const formatted = await prettier.format(serializeSeedFile(checked.seed), {
        ...options,
        filepath: target,
    });
    writeFileSync(target, formatted);
    const rows =
        checked.seed.layer === "capabilities"
            ? Object.keys(checked.seed.file.capabilities).length
            : Object.keys(checked.seed.file.archetypes).length;
    return { ok: true, path: rel, rows };
}
