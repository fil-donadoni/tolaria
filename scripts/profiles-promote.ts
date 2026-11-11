// `bun run profiles:promote <file>` — takes a Card Profile export (the Admin
// Card Profiles tool's Export button, issue #8907) back into the repository:
// validates it with the seed guards CI runs and replaces the matching seed
// file (`data/card-profiles/capabilities.json` or
// `data/card-profiles/archetypes/<scope>.json`). Every rule lives in
// `scripts/lib/profiles-promote.ts` / `convex/limited/cardProfileSeedFiles.ts`.
//
// Exit 0 = promoted, 1 = refused (each reason printed, nothing written),
// 2 = bad arguments.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promoteSeedFile } from "./lib/profiles-promote";

const REPO_ROOT = resolve(__dirname, "..");

async function main(argv: string[]): Promise<number> {
    const [file] = argv;
    if (file === undefined || argv.length !== 1) {
        console.error("usage: profiles:promote <exported-file.json>");
        return 2;
    }
    const path = resolve(file);
    if (!existsSync(path)) {
        console.error(`${file} does not exist`);
        return 2;
    }
    const result = await promoteSeedFile(readFileSync(path, "utf8"), REPO_ROOT);
    if (!result.ok) {
        for (const error of result.errors) console.error(error);
        console.log(`profiles:promote: REFUSED (${result.errors.length})`);
        return 1;
    }
    console.log(
        `profiles:promote: wrote ${result.path} (${result.rows} rows) — review the diff and commit it`
    );
    return 0;
}

process.exit(await main(process.argv.slice(2)));
