/**
 * Which build produced this session (issue #3256).
 *
 * The highest-value field per byte in the bug-report payload: the Brain-Worker
 * investigation that motivated this work had to INFER the reporter's build from
 * the report's date against a merge that had moved the Worker's module graph.
 * That inference happened to be available; it usually is not.
 *
 * The commit and the build time come from the bundler's substitution
 * (`scripts/lib/build-define.ts`), the mode and the backend from Vite's own
 * env. Nothing here is a secret: the deployment URL already ships inside the
 * bundle, and it is the field that says which backend the reporter was talking
 * to — a staging report read as a production one is a wasted investigation.
 */
export type BuildIdentity = {
    /** Short commit the bundle was built from, or `"unknown"` — never blank. */
    commit: string;
    /** ISO timestamp of the build. */
    builtAt: string;
    /** Vite mode: `production`, `development`, `test`, … */
    mode: string;
    /** The Convex deployment this bundle talks to. */
    deployment: string;
};

export function collectBuildIdentity(): BuildIdentity {
    return {
        commit: readDefine(() => __BUILD_COMMIT__),
        builtAt: readDefine(() => __BUILD_TIME__),
        mode: import.meta.env.MODE || "unknown",
        deployment: import.meta.env.VITE_CONVEX_URL || "unknown",
    };
}

/** A bundler substitution that did not happen leaves an undeclared global, and
 *  a `ReferenceError` thrown while collecting diagnostics would cost the
 *  reporter the whole report. Fall back to the same never-blank sentinel the
 *  build-time reader uses. */
function readDefine(read: () => string): string {
    try {
        return read() || "unknown";
    } catch {
        return "unknown";
    }
}
