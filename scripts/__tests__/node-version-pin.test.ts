import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// The Node runtime pin (issue #5305). Three files name it, one per toolchain
// that reads it — `.nvmrc` (nvm, the macOS machine), `mise.toml` (mise, the
// Omarchy default) and `package.json` `engines.node` (the declared contract)
// — and they must agree, or the two machines run different engines. The
// running Node must be the pinned major: a shell whose nvm default still
// points at the old line runs the whole suite on the wrong engine and goes
// green on it.

const ROOT = path.resolve(__dirname, "..", "..");
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), "utf8");

const nvmrc = read(".nvmrc").trim();
const mise = /^node\s*=\s*"([^"]+)"/m.exec(read("mise.toml"))?.[1];
const engines = (
    JSON.parse(read("package.json")) as { engines?: { node?: string } }
).engines?.node;

describe("Node runtime pin (issue #5305)", () => {
    it("`.nvmrc`, `mise.toml` and `engines.node` name the same version", () => {
        expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
        expect(mise).toBe(nvmrc);
        expect(engines).toBe(`>=${nvmrc} <${Number(nvmrc.split(".")[0]) + 1}`);
    });

    it("the running Node is the pinned major", () => {
        const pinned = nvmrc.split(".")[0];
        expect(
            process.versions.node.split(".")[0],
            `running Node ${process.versions.node}, pinned ${nvmrc} — \`nvm install && nvm alias default ${pinned}\` (macOS) or \`mise install\` (Omarchy)`
        ).toBe(pinned);
    });
});
