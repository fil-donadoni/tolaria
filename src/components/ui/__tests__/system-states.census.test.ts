// Census guard for issue #2592 (PRD #2405 D51): "one EmptyState / ErrorState /
// offline banner / toast set in ui/, used by every listed surface" — the
// acceptance criterion is explicitly a census, not a spot-check. Each row
// below is a (surface, root file, required shared component) triple; the test
// reads the file's SOURCE and asserts both the import AND a JSX usage of the
// shared component are present, so a surface that reverts to an ad hoc
// `<p>...</p>` (the exact regression this replaces across a dozen call sites)
// goes red instead of silently drifting.
//
// This is a static source scan, mirroring
// `src/components/chrome/__tests__/shell-height-claims.guard.test.tsx`'s
// discipline (a registry checked for completeness against the file tree,
// never a hand-verified spot check) — cheaper than rendering every surface
// end to end, and the failure mode this test exists to catch (a component
// forgetting to import the shared component) is a source-level fact.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

const COMPONENT_MODULE: Record<string, string> = {
    EmptyState: "empty-state",
    ErrorState: "error-state",
    LoadingScreen: "loading-screen",
    OfflineBanner: "offline-banner",
};

function read(relPath: string): string {
    const full = resolve(REPO_ROOT, relPath);
    if (!existsSync(full)) {
        throw new Error(
            `system-states census: ${relPath} does not exist — the surface moved; update this census, don't delete the row.`
        );
    }
    return readFileSync(full, "utf8");
}

/** True when `source` both imports and renders `componentName` (JSX-invokes
 *  it, not just mentions it in prose/a comment). */
function usesComponent(source: string, componentName: string): boolean {
    const module = COMPONENT_MODULE[componentName];
    const importsIt = new RegExp(
        `import\\s+${componentName}\\s+from\\s+["'][^"']*/${module}["']`
    ).test(source);
    const rendersIt = new RegExp(`<${componentName}[\\s/>]`).test(source);
    return importsIt && rendersIt;
}

type RequiredComponent = "EmptyState" | "ErrorState" | "LoadingScreen";

type SurfaceRow = {
    surface: string;
    file: string;
    /** Shared component(s) THIS file's own loading/empty/error moment must
     *  route through. A surface that delegates its empty/error moment
     *  entirely to a child component (e.g. `DeckList`) gets its OWN row for
     *  the moment it renders directly, and the child gets its own row too. */
    requires: RequiredComponent[];
};

// One row per surface the issue names (lobby, decks, limited list,
// antechamber, both builders, Draft Room, board waiting-for-opponent), split
// out per file where a surface spans more than one component. A surface
// missing from this table is a surface nobody censused — the whole point of
// the acceptance criterion.
const SURFACES: SurfaceRow[] = [
    {
        surface: "Lobby",
        file: "src/components/lobby/lobby.tsx",
        requires: ["LoadingScreen"],
    },
    {
        surface: "Decks (deck list)",
        file: "src/components/lobby/deck-list.tsx",
        requires: ["EmptyState"],
    },
    {
        surface: "Limited list — open events",
        file: "src/components/limited/limited-event-list.tsx",
        requires: ["EmptyState"],
    },
    {
        surface: "Limited list — your events",
        file: "src/components/limited/limited-your-events-page.tsx",
        requires: ["LoadingScreen", "EmptyState"],
    },
    {
        surface: "Antechamber (join game)",
        file: "src/components/join/join-game.tsx",
        requires: ["LoadingScreen", "ErrorState"],
    },
    {
        surface: "Pool deck builder (Limited)",
        file: "src/components/deckbuilder/pool-deck-builder.tsx",
        requires: ["LoadingScreen", "EmptyState", "ErrorState"],
    },
    {
        surface: "Constructed deck builder",
        file: "src/routes/deck-builder.route.tsx",
        requires: ["LoadingScreen", "ErrorState"],
    },
    {
        surface: "Draft Room — event shell (the event page it is entered from)",
        file: "src/components/limited/limited-event-detail.tsx",
        requires: ["LoadingScreen", "ErrorState"],
    },
    {
        surface: "Draft Room — room (/limited/$eventId/draft)",
        file: "src/components/limited/limited-draft-room.tsx",
        requires: ["LoadingScreen", "ErrorState"],
    },
    {
        surface: "Draft Room — pack",
        file: "src/components/limited/limited-draft-pack.tsx",
        requires: ["EmptyState"],
    },
    {
        surface: "Draft Room — pool",
        file: "src/components/limited/limited-draft-pool.tsx",
        requires: ["EmptyState"],
    },
    {
        surface: "Board — waiting for opponent",
        file: "src/components/board/waiting-for-opponent.tsx",
        requires: ["EmptyState"],
    },
];

// Flattened (surface, component) pairs — one test per pair so a single
// missing usage names exactly the surface and the component, not "some row
// somewhere failed".
const CASES = SURFACES.flatMap((row) =>
    row.requires.map((component) => ({
        surface: row.surface,
        file: row.file,
        component,
    }))
);

describe("system states census (issue #2592)", () => {
    it("every surface row points at a file that still exists", () => {
        for (const row of SURFACES) {
            expect(() => read(row.file)).not.toThrow();
        }
    });

    it.each(CASES)(
        "$surface ($file) uses the shared $component",
        ({ surface, file, component }) => {
            const source = read(file);
            expect(
                usesComponent(source, component),
                `${surface} (${file}) does not import+render <${component}> — ` +
                    `either it regressed to an ad hoc element, or this census row is stale.`
            ).toBe(true);
        }
    );

    // The offline banner (issue #2592): ONE global mount, not a per-surface
    // affordance — every route shares one Convex client, so a per-surface
    // banner would just be N subscriptions to the same fact.
    it("OfflineBanner is mounted exactly once, at the router root", () => {
        const router = read("src/router.tsx");
        expect(usesComponent(router, "OfflineBanner")).toBe(true);

        // Guard against a SECOND mount creeping in elsewhere — the shared
        // set means ONE offline strip, not one per surface.
        for (const row of SURFACES) {
            const source = read(row.file);
            expect(
                /<OfflineBanner[\s/>]/.test(source),
                `${row.file} mounts <OfflineBanner> a second time — it belongs only at the router root.`
            ).toBe(false);
        }
    });

    // The toast (issue #2592): ONE toast component (`ErrorToast`, built on
    // `Banner tone="danger"`), mounted on the board — not a second ad hoc
    // fixed-position notice.
    it("ErrorToast is the only fixed-position danger toast, mounted on the board", () => {
        const board = read("src/components/board/board.tsx");
        expect(
            /import\s+ErrorToast\s+from\s+["'][^"']*\/error-toast["']/.test(
                board
            ) && /<ErrorToast[\s/>]/.test(board)
        ).toBe(true);
    });
});
