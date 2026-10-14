// Render a launchd plist from scripts/runner-units/ (docs/guides/huawei-runner.md
// § Install on the MacBook): `bun scripts/launchd-render.ts <template> > <out>`.
// Fails loudly (exit 1, nothing on stdout) when node is not on the rendered PATH.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderLaunchdUnit } from "./lib/launchd-render";

const template = process.argv[2];
if (!template) {
    console.error("usage: bun scripts/launchd-render.ts <template.plist>");
    process.exit(2);
}
const which = (bin: string) =>
    execFileSync("/bin/sh", ["-c", `command -v ${bin}`], {
        encoding: "utf8",
    }).trim();
try {
    process.stdout.write(
        renderLaunchdUnit(readFileSync(template, "utf8"), {
            repo: execFileSync("git", ["rev-parse", "--show-toplevel"], {
                encoding: "utf8",
            }).trim(),
            bun: which("bun"),
            nodeBin: dirname(which("node")),
            home: process.env.HOME ?? "",
        })
    );
} catch (e) {
    console.error(`launchd-render: ${(e as Error).message}`);
    process.exit(1);
}
