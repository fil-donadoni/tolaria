// A diff that only registers a new static route is not global to `check:ui`
// (issue #8409); anything else in those two files still is.
import { describe, expect, it } from "vitest";
import {
    isAdditiveRouteRegistration,
    isAdditiveShellRule,
} from "../lib/ui-route-registration-edits";

const row = (pattern: string, extra = "") =>
    `    {\n        pattern: "${pattern}",\n        mode: "browse",\n${extra}        why: "Why.",\n    },\n`;
const table = (...rows: string[]) =>
    `const a = 1;\nexport const SHELL_ROUTE_RULES: readonly R[] = [\n${rows.join("")}] as const;\nconst b = 2;\n`;

describe("isAdditiveShellRule", () => {
    const old = table(row("/"), row("/limited"));

    it("accepts a new static browse row", () => {
        expect(
            isAdditiveShellRule(
                old,
                table(row("/"), row("/x"), row("/limited"))
            )
        ).toBe(true);
    });

    it.each([
        ["a dynamic pattern", table(row("/"), row("/$id"), row("/limited"))],
        [
            "an extra key",
            table(
                row("/"),
                row("/x", '        ownsReturn: ["event"],\n'),
                row("/limited")
            ),
        ],
        ["an edited row", table(row("/"), row("/changed"))],
        ["a removed row", table(row("/"))],
        [
            "a change outside the table",
            `${table(row("/"), row("/limited"), row("/x"))}// z\n`,
        ],
        ["no change", old],
    ])("refuses %s", (_label, next) => {
        expect(isAdditiveShellRule(old, next)).toBe(false);
    });

    it("refuses a new row outside the table", () => {
        expect(isAdditiveShellRule(old, `${old}${row("/x")}`)).toBe(false);
    });

    it("refuses an immersive row", () => {
        const immersive = row("/x").replace("browse", "immersive");
        expect(
            isAdditiveShellRule(
                old,
                table(row("/"), immersive, row("/limited"))
            )
        ).toBe(false);
    });
});

const route = (name: string, path: string, parent = "rootRoute") =>
    `// Comment.\nconst ${name} = createRoute({\n    getParentRoute: () => ${parent},\n    path: "${path}",\n    component: lazyRouteComponent(() => import("./routes/x.route")),\n});\n\n`;
const router = (blocks: string[], children: string[]) =>
    `import x from "y";\n\n${blocks.join("")}const routeTree = rootRoute.addChildren([\n${children
        .map((c) => `    ${c},\n`)
        .join("")}]);\n`;

describe("isAdditiveRouteRegistration", () => {
    const old = router([route("aRoute", "/a")], ["aRoute"]);

    it("accepts a new static route and its tree line", () => {
        expect(
            isAdditiveRouteRegistration(
                old,
                router(
                    [route("aRoute", "/a"), route("bRoute", "/b")],
                    ["aRoute", "bRoute"]
                )
            )
        ).toBe(true);
    });

    it.each([
        [
            "a dynamic path",
            router(
                [route("aRoute", "/a"), route("bRoute", "/$b")],
                ["aRoute", "bRoute"]
            ),
        ],
        [
            "a nested route",
            router(
                [route("aRoute", "/a"), route("bRoute", "/b", "aRoute")],
                ["aRoute", "bRoute"]
            ),
        ],
        [
            "a route with no tree line",
            router([route("aRoute", "/a"), route("bRoute", "/b")], ["aRoute"]),
        ],
        ["an edited route", router([route("aRoute", "/changed")], ["aRoute"])],
        [
            "a reused path",
            router(
                [route("aRoute", "/a"), route("bRoute", "/a")],
                ["aRoute", "bRoute"]
            ),
        ],
        [
            "another change beside the new route",
            router(
                [route("aRoute", "/a"), route("bRoute", "/b")],
                ["bRoute", "aRoute"]
            ).replace("y", "z"),
        ],
        ["no change", old],
    ])("refuses %s", (_label, next) => {
        expect(isAdditiveRouteRegistration(old, next)).toBe(false);
    });
});
