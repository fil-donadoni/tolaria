import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { liveLaneSourceCalls } from "../lib/live-lane-source-calls";

// issue #7884: a test asserting a lane PLAN or a receipt DECISION injects its
// sources (`inertClassifyLane`, an injected `scopeOf`) instead of paying the
// whole-tree import-graph walk. One that IS about the live walk says so with
// a `live-walk:` comment. The class cannot come back unseen.
const TESTS = resolve(__dirname);

function testFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
            ? testFiles(join(dir, e.name))
            : e.name.endsWith(".test.ts")
              ? [join(dir, e.name)]
              : []
    );
}

const IMPORT = 'import { classifyLane } from "../check-lane";\n';
const live = (body: string) => liveLaneSourceCalls(IMPORT + body);

describe("liveLaneSourceCalls — the rule", () => {
    it("flags a bare classifyLane(files)", () => {
        expect(live("const p = classifyLane(files);")).toEqual([
            { line: 2, callee: "classifyLane" },
        ]);
    });

    it("flags a classifyLane that injects only `related`", () => {
        expect(live("classifyLane(f, f, related({}));")).toHaveLength(1);
    });

    it("accepts a fully injected classifyLane and the inert helper", () => {
        expect(
            live("classifyLane(a, b, r, new Map(), bot(1, 2), () => [], s);")
        ).toEqual([]);
        expect(live("inertClassifyLane(files);")).toEqual([]);
    });

    it("flags a skinReceiptInvalidForDiff relying on the live scopeOf", () => {
        expect(live("skinReceiptInvalidForDiff(p, root, body);")).toHaveLength(
            1
        );
        expect(
            live("skinReceiptInvalidForDiff(p, root, body, () => scope);")
        ).toEqual([]);
    });

    it("flags landingDiffScope unless marked live-walk", () => {
        expect(live("landingDiffScope(diff, root);")).toHaveLength(1);
        expect(
            live(
                "// live-walk: the scope a real diff derives\nlandingDiffScope(diff, root);"
            )
        ).toEqual([]);
    });

    it("ignores a classifyLane that is not check-lane's (pr-fixup's)", () => {
        expect(
            liveLaneSourceCalls(
                'import { classifyLane } from "../pr-fixup";\nclassifyLane(x);'
            )
        ).toEqual([]);
    });

    it("a file-level marker exempts the whole file", () => {
        expect(
            live(
                "// live-walk-file: subject is the classifier\nclassifyLane(a);"
            )
        ).toEqual([]);
    });

    it("ignores a declaration and counts commas inside nested calls once", () => {
        expect(live("function classifyLane(\n...a\n) {}")).toEqual([]);
        expect(
            live("skinReceiptInvalidForDiff(f(a, b), r, 'x, y');")
        ).toHaveLength(1);
    });
});

describe("scripts/__tests__ — no test pays the live lane-source walk unmarked (issue #7884)", () => {
    const own = resolve(__dirname, "lane-sources-injected.test.ts");
    it("every classifyLane / skinReceiptInvalidForDiff / landingDiffScope call injects its sources or is a named live-walk test", () => {
        const offenders = testFiles(TESTS)
            .filter((f) => f !== own)
            .flatMap((f) =>
                liveLaneSourceCalls(readFileSync(f, "utf8")).map(
                    (c) => `${relative(TESTS, f)}:${c.line} ${c.callee}`
                )
            );
        expect(offenders).toEqual([]);
    });
});
