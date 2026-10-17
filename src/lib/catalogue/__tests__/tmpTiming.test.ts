import { it, expect, vi } from "vitest";
import { appendFileSync } from "node:fs";
vi.mock("@convex/cards/compiledPool", () => import("../compiled-pool.browser"));
vi.mock("@convex/cards/setModules", () => import("../set-modules.browser"));
import { installShards } from "../definitionShards";
import { setModuleSource } from "../set-modules.browser";
const log = (s: string) =>
    appendFileSync(
        "/private/tmp/claude-501/-Users-filippo-code-mtg-tolaria/42e4c6a6-3b48-4d57-9406-3e61b7c9fb2c/scratchpad/timing.txt",
        s + "\n"
    );
it("times", async () => {
    const t = performance.now();
    await installShards(setModuleSource.codes);
    log("SETS-ONLY " + (performance.now() - t));
    expect(1).toBe(1);
}, 120000);
