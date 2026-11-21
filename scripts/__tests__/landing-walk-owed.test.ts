// `landingWalkOwed` judges content rules on the diff's CHANGED LINES, never on
// what an untouched part of the file already declares (owner ruling, issue
// #7592). Driven against a real git repository: the merge-base diff, the
// untracked-file leg and the fail-closed leg are all git behaviour a stubbed
// reader cannot prove.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    changedLinesOfDiff,
    landingWalkOwed,
} from "../ui-gate/verify-receipt.ts";
import { createImportGraph } from "../lib/import-graph.ts";
import { skinReceiptInvalidForDiff } from "../lib/pr-refusals.ts";
import { renderInertSinceBase } from "../lib/ui-render-inert.ts";
import {
    computeUiScope,
    inertPaths,
    renderWalkOwed,
    type ScopeSurface,
} from "../lib/ui-scope.ts";

const CARD = "src/components/board/hand-card.tsx";
const BASE = "base";

/** A leaf component that already declares a z-index, the shape of
 *  `gre-hand-card.tsx` (issue #3219's Plot diff). */
const WITH_Z = [
    "export function HandCard() {",
    "    const label = 'Cast';",
    "    return <div className='relative z-10'>{label}</div>;",
    "}",
    "",
].join("\n");

let repo: string;
const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
};
const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
};
const commit = () => {
    git("add", "-A");
    git("commit", "-q", "-m", "change");
};
const owed = (paths: string[]) => landingWalkOwed(paths, repo, BASE);

beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "tolaria-walk-owed-"));
    git("init", "-q", "-b", BASE);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    write(CARD, WITH_Z);
    commit();
    git("checkout", "-q", "-b", "feature");
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 10 }));

describe("landingWalkOwed — content rules read the changed lines (issue #7592)", () => {
    it("an edit beside an untouched z-index owes no walk", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        commit();
        expect(owed([CARD])).toMatchObject({ owed: false });
    });

    it("an uncommitted edit is judged the same way", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        expect(owed([CARD])).toMatchObject({ owed: false });
    });

    it("ADDING a z-index owes a walk", () => {
        write(
            CARD,
            WITH_Z + "export const Pill = () => <span className='z-20' />;\n"
        );
        commit();
        expect(owed([CARD])).toMatchObject({
            owed: true,
            rule: "declares a z-index",
            path: CARD,
        });
    });

    it("a bare `sticky` on the LAST changed line still owes a walk", () => {
        const multi = [
            "export const Bar = () => (",
            "    <div",
            "        className={`",
            "    top-0",
            "        `}",
            "    />",
            ");",
            "",
        ].join("\n");
        write(CARD, multi);
        commit();
        write(CARD, multi.replace("    top-0", "    top-0\n    sticky"));
        commit();
        // Against the previous commit, the bare `sticky` is the ONLY changed line.
        expect(landingWalkOwed([CARD], repo, "HEAD~1")).toMatchObject({
            owed: true,
            path: CARD,
        });
    });

    it("REMOVING a z-index owes a walk", () => {
        write(CARD, WITH_Z.replace(" z-10", ""));
        commit();
        expect(owed([CARD])).toMatchObject({ owed: true, path: CARD });
    });

    it("a new file counts whole, committed or untracked", () => {
        const fresh = "src/components/board/new-pill.tsx";
        write(
            fresh,
            "export const Pill = () => <span className='sticky top-0' />;\n"
        );
        expect(owed([fresh])).toMatchObject({ owed: true, path: fresh });
        commit();
        expect(owed([fresh])).toMatchObject({ owed: true, path: fresh });
    });

    it("deleting a module owes nothing, though its removed lines held a z-index (issue #7608)", () => {
        git("rm", "-q", CARD);
        expect(owed([CARD])).toMatchObject({ owed: false });
        commit();
        expect(owed([CARD])).toMatchObject({ owed: false });
    });

    it("a path missing from disk that git never had is not a deletion", () => {
        expect(owed(["src/components/board/never-was.tsx"])).toMatchObject({
            owed: true,
        });
    });

    it("a diff it cannot read stays owed (no merge-base: fail closed)", () => {
        write(CARD, WITH_Z.replace("'Cast'", "'Plot'"));
        commit();
        expect(landingWalkOwed([CARD], repo, "no-such-ref")).toMatchObject({
            owed: true,
            path: CARD,
        });
    });
});

describe("changedLinesOfDiff", () => {
    it("keeps hunk lines only: the ---/+++ headers are not content", () => {
        const diff = [
            "diff --git a/x.tsx b/x.tsx",
            "--- a/x.tsx",
            "+++ b/x.tsx",
            "@@ -1 +1 @@",
            "-const a = 1;",
            "+++counter;",
        ].join("\n");
        expect(changedLinesOfDiff(diff)).toBe("const a = 1;\n++counter;\n");
    });

    it("keeps a removed line that itself starts with dashes", () => {
        const diff = ["@@ -1 +0,0 @@", "--- a separator", "+"].join("\n");
        expect(changedLinesOfDiff(diff)).toBe("-- a separator\n\n");
    });
});

// PR #10390 (issue #9518), replayed in its shape: one `storeSession` call
// moved from the manual game-over dialog's "Next game" handler into the game
// route's switch-game handler. Zero pixels move, yet the dialog's NAME owed a
// walk and the route's closure selected every game surface (issue #10393).
const DIALOG = "src/components/board/manual-game-over-dialog.tsx";
const ROUTE = "src/routes/game.route.tsx";
const DIALOG_BASE = `import { useState } from "react";
import { storeSession } from "../../lib/session";

export default function ManualGameOverDialog({ onSwitchGame }: Props) {
    const [busy, setBusy] = useState(false);
    const handleNextGame = async () => {
        setBusy(true);
        try {
            const next = await continueMatch();
            if (next) {
                storeSession(next.gameId);
                onSwitchGame(next.gameId);
            }
        } finally {
            setBusy(false);
        }
    };
    return <button onClick={handleNextGame}>{busy ? "…" : "Next game"}</button>;
}
`;
const DIALOG_HEAD = DIALOG_BASE.replace(
    'import { storeSession } from "../../lib/session";\n',
    ""
).replace(
    "            if (next) {\n                storeSession(next.gameId);\n                onSwitchGame(next.gameId);\n            }\n",
    "            // `onSwitchGame` persists the session itself (issue #9518).\n            if (next) onSwitchGame(next.gameId);\n"
);
const ROUTE_BASE = `import { useState } from "react";
import { clearSession, getStoredSession } from "../lib/session";
import ManualGameOverDialog from "../components/board/manual-game-over-dialog";

export default function GameRoute() {
    const [session, setSession] = useState(() => getStoredSession());
    const handleLeave = () => clearSession();
    const handleSwitchGame = (gameId: string) => {
        setSession({ gameId });
    };
    return <ManualGameOverDialog onSwitchGame={handleSwitchGame} onLeave={handleLeave} />;
}
`;
const ROUTE_HEAD = ROUTE_BASE.replace(
    "{ clearSession, getStoredSession }",
    "{ clearSession, getStoredSession, storeSession }"
).replace(
    "        setSession({ gameId });\n",
    "        storeSession(gameId);\n        setSession({ gameId });\n"
);
const LOBBY = "src/routes/lobby.route.tsx";
const LOBBY_BASE = `export default function LobbyRoute() {
    return <main className="lobby" />;
}
`;
const GAME_SURFACES: ScopeSurface[] = [
    { id: "lobby", entries: [LOBBY] },
    { id: "game-board", entries: [ROUTE] },
    { id: "dlg-game-over", entries: [ROUTE], mounts: [DIALOG] },
];
const scopeAt = (paths: string[], inert = true) =>
    computeUiScope({
        changed: paths,
        surfaces: GAME_SURFACES,
        graph: createImportGraph({ root: repo }),
        renderInert: inert
            ? inertPaths(renderInertSinceBase(paths, repo, BASE))
            : new Set(),
    });
const landRefuses = (paths: string[], body: string) =>
    skinReceiptInvalidForDiff(
        paths,
        repo,
        body,
        (c) => scopeAt(c),
        (c, r) => landingWalkOwed(c, r, BASE)
    );

describe("PR #10390's diff, replayed: render-inert hunks owe nothing (issue #10393)", () => {
    beforeEach(() => {
        git("checkout", "-q", BASE);
        write("src/lib/session.ts", "export const storeSession = 1;\n");
        write(DIALOG, DIALOG_BASE);
        write(ROUTE, ROUTE_BASE);
        write(LOBBY, LOBBY_BASE);
        commit();
        git("checkout", "-q", "-B", "feature");
    });

    it("prints `walk: not owed` with each file's render-inert reason, and an empty scope", () => {
        write(DIALOG, DIALOG_HEAD);
        write(ROUTE, ROUTE_HEAD);
        commit();
        const paths = [DIALOG, ROUTE];
        const verdict = owed(paths);
        expect(renderWalkOwed(verdict).split("\n")).toEqual([
            expect.stringMatching(/^walk: not owed — /),
            `  · ${DIALOG}: render-inert — an import from ../../lib/session whose changed bindings only handlers read; the handleNextGame handler's body; comments / blank lines`,
            `  · ${ROUTE}: render-inert — an import from ../lib/session whose changed bindings only handlers read; the handleSwitchGame handler's body`,
        ]);
        expect(scopeAt(paths)).toEqual({ kind: "scoped", surfaces: [] });
        // Control: judged by file, the same diff walks both surfaces.
        expect(scopeAt(paths, false)).toEqual({
            kind: "scoped",
            surfaces: ["game-board", "dlg-game-over"],
        });
    });

    it("a mixed diff selects only the render-reaching file's surfaces, and names its hunk", () => {
        write(DIALOG, DIALOG_HEAD);
        write(LOBBY, LOBBY_BASE.replace('"lobby"', '"lobby wide"'));
        commit();
        const paths = [DIALOG, LOBBY];
        expect(scopeAt(paths)).toEqual({ kind: "scoped", surfaces: ["lobby"] });
        expect(scopeAt(paths, false)).toEqual({
            kind: "scoped",
            surfaces: ["lobby", "game-board", "dlg-game-over"],
        });
        // A render-reaching hunk in the dialog keeps its name rule, and the
        // verdict names the hunk.
        write(
            DIALOG,
            DIALOG_HEAD.replace(
                "setBusy(true);",
                "setBusy(true);\n        setBusy(true);"
            )
        );
        commit();
        expect(owed(paths)).toEqual({
            owed: true,
            path: DIALOG,
            rule: expect.stringMatching(
                /^an overlay \/ popover \/ dialog component — src\/components\/board\/manual-game-over-dialog\.tsx:\d+: a line of the handleNextGame handler that sets state/
            ),
        });
    });

    it("land accepts `check:ui: no walk owed (…)` for the render-inert diff and refuses a render-reaching one", () => {
        const line =
            "check:ui: no walk owed (handler-only hunks, render-inert)";
        write(DIALOG, DIALOG_HEAD);
        write(ROUTE, ROUTE_HEAD);
        commit();
        expect(landRefuses([DIALOG, ROUTE], line)).toBe(false);
        write(DIALOG, DIALOG_HEAD.replace('"Next game"', '"Continue"'));
        commit();
        expect(landRefuses([DIALOG, ROUTE], line)).toBe(true);
    });
});
