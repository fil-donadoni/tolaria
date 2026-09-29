// Card sets and test support are not Convex entry points (issue #4811).
//
// The Convex CLI makes every single-dot `.ts` under `convex/` a function
// module. A card-set file or a test helper is neither a function nor needs to
// be one, and as an entry point it cost a user module plus ~19 KB of chunk
// imports in every entry that reached it: 10.16 MiB and 1,143 modules,
// measured at the rename. No lane runs a Convex push, so without this a new
// `sets/<code>/<colour>.ts` or `__tests__/helpers.ts` slides back in.
//
// It lives here, not beside the bundle-size test in `scripts/__tests__/`, so
// that the `cards` lane — the one a new set file lands through — runs it. It
// is a directory walk (no esbuild pass), so it costs nothing there.
import { describe, it, expect } from "vitest";
import * as path from "path";
import { nonFunctionEntryPoints } from "../../../scripts/lib/convex-bundle-size";

const CONVEX_DIR = path.resolve(__dirname, "..", "..");

describe("card sets and test support are not Convex entry points (issue #4811)", () => {
    it("discovers no entry point under convex/cards/sets/** or any __tests__/", () => {
        const offenders = nonFunctionEntryPoints(CONVEX_DIR);
        expect(
            offenders,
            `these files are Convex entry points, but hold no Convex function:\n` +
                offenders.map((f) => `  convex/${f}`).join("\n") +
                `\nGive each a multi-dot name, which the Convex CLI skips while ` +
                `keeping it importable: a set module is \`<name>.cards.ts\` ` +
                `(scripts/lib/set-module-suffix.ts), a test helper ` +
                `\`<name>.helper.ts\`, a test fixture \`<name>.fixture.ts\`.`
        ).toEqual([]);
    });
});
