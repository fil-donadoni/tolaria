import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Issue #1612 hard acceptance: "No Convex mutation is called from this
 * surface, at all." (ADR 0074: "The Draft Lab is a client-only developer
 * surface. It writes nothing." — ADR 0074 forbids WRITES, not reads; a
 * read-only `useQuery` is explicitly allowed, see the fixup note below.)
 * Every Draft Lab file — the route, its components, its state hook, and its
 * pure engine — is scanned for any import/call of a Convex MUTATION/ACTION
 * surface (`useMutation`, `useAction`) or a raw `ctx.db` WRITE call
 * (`insert`/`patch`/`replace`/`delete`).
 *
 * A static guard rather than a runtime spy: the surface has no server
 * boundary to spy on in a unit test, and "never imported" is a stronger,
 * permanent proof than "wasn't called this particular render". Mirrors the
 * project's existing static-scan guard shape
 * (`scripts/__tests__/bot-suite-boundary.test.ts`).
 *
 * Narrowed (issue #1612 fixup, pre-merge review): the ORIGINAL pattern set
 * also banned `from "convex/react"` and any `_generated/api` reference
 * outright, which blocked EVERY Convex surface — including a read. That
 * papered over the review finding that a real `cardProfiles` DB read was
 * missing entirely (`useDraftLab.ts` now calls `useQuery(api.limited
 * .cardProfiles.listScopeCardProfiles, …)`, a read-only query). The bar this
 * guard enforces is "no mutation, no action, writes nothing" — `useQuery`
 * and importing `api`/`convex/react` to call one are legitimate on this
 * surface; only the write-shaped surfaces below are still forbidden.
 *
 * File enumeration (non-blocking finding, same pre-merge review): the
 * ORIGINAL `DRAFT_LAB_ROOTS` hand-listed two exact files
 * (`draft-lab.route.tsx`, `useDraftLab.ts`) alongside two whole directories
 * — a new sibling file dropped next to either hand-listed file (e.g. a
 * second route file, or a second top-level hook) would silently escape the
 * scan. `collectDraftLabFiles` below instead walks the WHOLE surface: every
 * file under the two dedicated directories (`src/components/draft-lab`,
 * `src/lib/limited` — both directories exist for Draft Lab alone, confirmed
 * by directory listing), plus any file whose name matches the Draft Lab
 * naming convention (`draft-lab`/`draftLab`) anywhere under the shared
 * `src/routes` and `src/hooks` directories — so a new file needs only to
 * follow the project's existing naming convention to be covered
 * automatically, with no `DRAFT_LAB_ROOTS` edit required.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** Directories that exist FOR Draft Lab alone — every file under them,
 *  recursively, is in scope (no name filter needed). */
const DRAFT_LAB_DEDICATED_DIRS = [
    "src/components/draft-lab",
    "src/lib/limited",
];

/** Shared directories that also hold non-Draft-Lab files — only files whose
 *  name matches the Draft Lab naming convention are in scope. */
const DRAFT_LAB_NAME_FILTERED_DIRS = ["src/routes", "src/hooks"];

const DRAFT_LAB_NAME_PATTERN = /draft-?lab/i;

const FORBIDDEN_PATTERNS: RegExp[] = [
    /useMutation/,
    /useAction/,
    /ctx\.db\.(insert|patch|replace|delete)/,
    // Reviewer-proved bypass (pre-merge, issue #1612 fixup #2): the narrowed
    // pattern set above only bans the named hooks — but `useConvex()` hands
    // back the raw `ConvexReactClient`, whose `.mutation(...)`/`.action(...)`
    // methods write/act exactly like `useMutation`/`useAction` do, just
    // without matching either literal. A wrapper hook that itself calls
    // `useMutation`/`useAction` internally and re-exports a differently-named
    // function would ALSO slip past a hook-name-only scan. Ban `useConvex`
    // outright (this surface has no legitimate use for the raw client — it
    // only ever needs the read-only `useQuery` hook) and ban the method-call
    // shape itself as a second, independent line of defense.
    /useConvex\b/,
    /\.(mutation|action)\(/,
];

function isSourceFile(name: string): boolean {
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
}

function walk(abs: string): string[] {
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return isSourceFile(path.basename(abs)) ? [abs] : [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full));
        } else if (isSourceFile(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function collectDraftLabFiles(): string[] {
    const dedicated = DRAFT_LAB_DEDICATED_DIRS.flatMap((rel) =>
        walk(path.join(REPO_ROOT, rel))
    );
    const filtered = DRAFT_LAB_NAME_FILTERED_DIRS.flatMap((rel) =>
        walk(path.join(REPO_ROOT, rel)).filter((f) =>
            DRAFT_LAB_NAME_PATTERN.test(path.basename(f))
        )
    );
    return [...dedicated, ...filtered];
}

describe("Draft Lab writes nothing (issue #1612 acceptance)", () => {
    it("scans a non-empty set of Draft Lab files", () => {
        const files = collectDraftLabFiles();
        expect(files.length).toBeGreaterThan(0);
    });

    it("the name-filtered scan actually matches files under BOTH src/routes and src/hooks (reviewer-proved gap, fixup #2)", () => {
        // A bare non-empty check on the COMBINED file list (above) would stay
        // green even if a rename silently dropped one of the two shared,
        // name-filtered directories to zero matches — the dedicated
        // directories alone (`src/components/draft-lab`, `src/lib/limited`)
        // are non-empty regardless, so they'd mask the loss. Assert each
        // name-filtered directory independently contributes at least one
        // file, so a regression in the `/draft-?lab/i` filter (or a rename of
        // `draft-lab.route.tsx`/`useDraftLab.ts` off the naming convention)
        // fails loudly here instead of silently.
        for (const rel of DRAFT_LAB_NAME_FILTERED_DIRS) {
            const matches = walk(path.join(REPO_ROOT, rel)).filter((f) =>
                DRAFT_LAB_NAME_PATTERN.test(path.basename(f))
            );
            expect(
                matches.length,
                `expected at least one Draft-Lab-named file under ${rel}, found none`
            ).toBeGreaterThan(0);
        }
    });

    it("no Draft Lab file imports or calls a Convex mutation/action surface", () => {
        const files = collectDraftLabFiles();
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
