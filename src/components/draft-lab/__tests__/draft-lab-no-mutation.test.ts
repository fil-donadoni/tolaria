import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Issue #1612 hard acceptance: "No Convex mutation is called from this
 * surface, at all." (ADR 0074: "The Draft Lab is a client-only developer
 * surface. It writes nothing.") Every Draft Lab file — the route, its
 * components, its state hook, and its pure engine — is scanned for any
 * import of a Convex mutation/action surface (`useMutation`, `useAction`,
 * the generated `api`/`internal` client, `convex/react`) or a raw `ctx.db`
 * write call.
 *
 * A static guard rather than a runtime spy: the surface has no server
 * boundary to spy on in a unit test, and "never imported" is a stronger,
 * permanent proof than "wasn't called this particular render". Mirrors the
 * project's existing static-scan guard shape
 * (`scripts/__tests__/bot-suite-boundary.test.ts`).
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const DRAFT_LAB_ROOTS = [
    "src/routes/draft-lab.route.tsx",
    "src/components/draft-lab",
    "src/hooks/useDraftLab.ts",
    "src/lib/limited",
];

const FORBIDDEN_PATTERNS: RegExp[] = [
    /useMutation/,
    /useAction/,
    /from ["']convex\/react["']/,
    /_generated\/api/,
    /ctx\.db\./,
];

function collectFiles(rel: string): string[] {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return [abs];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectFiles(path.relative(REPO_ROOT, full)));
        } else if (
            /\.tsx?$/.test(entry.name) &&
            !/\.test\.tsx?$/.test(entry.name)
        ) {
            out.push(full);
        }
    }
    return out;
}

describe("Draft Lab writes nothing (issue #1612 acceptance)", () => {
    it("scans a non-empty set of Draft Lab files", () => {
        const files = DRAFT_LAB_ROOTS.flatMap(collectFiles);
        expect(files.length).toBeGreaterThan(0);
    });

    it("no Draft Lab file imports or calls a Convex mutation surface", () => {
        const files = DRAFT_LAB_ROOTS.flatMap(collectFiles);
        const violations: string[] = [];

        for (const file of files) {
            const source = fs.readFileSync(file, "utf-8");
            for (const pattern of FORBIDDEN_PATTERNS) {
                if (pattern.test(source)) {
                    violations.push(
                        `${path.relative(REPO_ROOT, file)} matches ${pattern}`
                    );
                }
            }
        }

        expect(
            violations,
            `Draft Lab must never call a Convex mutation (ADR 0074):\n${violations.join("\n")}`
        ).toEqual([]);
    });
});
