import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderedPath, renderLaunchdUnit } from "../lib/launchd-render";

const subs = {
    repo: "/r",
    bun: "/h/.bun/bin/bun",
    nodeBin: "/h/.nvm/v24/bin",
    home: "/h",
};
const hasNode = (p: string) => p === "/h/.nvm/v24/bin/node";

describe("launchd plist templates (issue #5598)", () => {
    for (const name of ["land-runner"]) {
        const tpl = readFileSync(
            `scripts/runner-units/com.tolaria.${name}.plist`,
            "utf8"
        );

        it(`${name}: node dir lands on the rendered PATH`, () => {
            const out = renderLaunchdUnit(tpl, subs, hasNode);
            expect(renderedPath(out).split(":")).toContain("/h/.nvm/v24/bin");
            expect(out).not.toMatch(/__[A-Z_]+__/);
        });

        it(`${name}: node missing from the rendered PATH throws`, () => {
            expect(() => renderLaunchdUnit(tpl, subs, () => false)).toThrow(
                /node not resolvable/
            );
        });
    }

    it("a leftover placeholder throws", () => {
        expect(() => renderLaunchdUnit("__NOPE__", subs, hasNode)).toThrow(
            /unsubstituted/
        );
    });
});
