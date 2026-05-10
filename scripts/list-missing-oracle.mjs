#!/usr/bin/env node
/** Lists UUIDs in <set>.ts that still lack `oracleText:`. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const filePath = process.argv[2];
const lines = readFileSync(resolve(filePath), "utf-8").split("\n");
const UUID_RE =
    /^(\s*)(\/\/\s*)?id:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;
const NAME_RE = /name:\s*"([^"]+)"/;

for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(UUID_RE);
    if (!m) continue;
    const [, , comment, uuid] = m;
    let name = "";
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const nm = lines[j].match(NAME_RE);
        if (nm) {
            name = nm[1];
            break;
        }
    }
    let hasOracle = false;
    // Look ahead within a fixed window; close detection is brittle for
    // generator-built defs (makeColorWard etc), so scan up to the next
    // top-level boundary instead — i.e. up to the next `^export const` or
    // `^// export const` line, or a hard cap of 200 lines.
    for (let j = i + 1; j < Math.min(i + 200, lines.length); j++) {
        const line = lines[j];
        if (/^(\/\/\s*)?export const /.test(line)) break;
        if (line.includes("oracleText:")) {
            hasOracle = true;
            break;
        }
    }
    if (!hasOracle) {
        console.log(`${uuid}\t${name}\t${comment ? "stub" : "active"}`);
    }
}
