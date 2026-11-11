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

/**
 * ADR 0074, Amendment I (issue #8900): the Draft Lab's ONE write — filing a
 * Bot Finding report off a seat's built deck. It changes nothing about
 * drafts, events, ratings or profiles. The exception is a single entry, and
 * a single call: the allowed file may hold its `useMutation` import and ONE
 * `useMutation(<that mutation>)` call, each removed exactly once before the
 * scan — a second call, any other mutation, or the same call in any other
 * file still matches a forbidden pattern.
 */
const ALLOWED_WRITES = [
    {
        file: "src/components/draft-lab/draft-lab-report-finding-form.tsx",
        mutation: "api.botFindings.reportDraftFinding",
    },
] as const;

const ALLOWED_IMPORT = 'import { useMutation } from "convex/react";';

/** The source with the allowlisted import and call removed ONCE each when the
 *  file is the allowed one; any other file is scanned as written. */
function scannedSource(rel: string, source: string): string {
    const allowed = ALLOWED_WRITES.find((w) => w.file === rel);
    if (allowed === undefined) return source;
    return source
        .replace(ALLOWED_IMPORT, "")
        .replace(`useMutation(${allowed.mutation})`, "");
}

/** Every forbidden pattern the file still matches. */
function violationsIn(rel: string, source: string): string[] {
    const scanned = scannedSource(rel, source);
    return FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(scanned)).map(
        (pattern) => `${rel} matches ${pattern}`
    );
}

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
            violations.push(
                ...violationsIn(
                    path.relative(REPO_ROOT, file),
                    fs.readFileSync(file, "utf-8")
                )
            );
        }

        expect(
            violations,
            `Draft Lab must never call a Convex mutation (ADR 0074):\n${violations.join("\n")}`
        ).toEqual([]);
    });
});

describe("the ONE allowed Draft Lab write (ADR 0074 Amendment I, issue #8900)", () => {
    const [allowed] = ALLOWED_WRITES;
    const source = fs.readFileSync(path.join(REPO_ROOT, allowed.file), "utf-8");
    const call = `useMutation(${allowed.mutation})`;

    it("the allowlist holds exactly the Bot Finding report", () => {
        expect(ALLOWED_WRITES).toEqual([
            {
                file: "src/components/draft-lab/draft-lab-report-finding-form.tsx",
                mutation: "api.botFindings.reportDraftFinding",
            },
        ]);
    });

    it("the allowed file makes that one call, once, and is in the scan", () => {
        expect(source.split(call).length - 1).toBe(1);
        expect(
            collectDraftLabFiles().map((f) => path.relative(REPO_ROOT, f))
        ).toContain(allowed.file);
        expect(violationsIn(allowed.file, source)).toEqual([]);
    });

    it("a second mutation in the allowed file still reds", () => {
        for (const extra of [
            "useMutation(api.limited.events.createLimitedEvent)",
            call,
        ])
            expect(
                violationsIn(allowed.file, `${source}\nconst x = ${extra};`)
            ).toEqual([`${allowed.file} matches /useMutation/`]);
    });

    it("the allowed call in any other Draft Lab file still reds", () => {
        expect(
            violationsIn(
                "src/components/draft-lab/draft-lab-controls.tsx",
                `${ALLOWED_IMPORT}\nconst r = ${call};`
            )
        ).toEqual([
            "src/components/draft-lab/draft-lab-controls.tsx matches /useMutation/",
        ]);
    });
});
