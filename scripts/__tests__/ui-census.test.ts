// The `check:ui` coverage census (issue #3420).
//
// The UI gate walks a hand-written list of surfaces. Nothing connected that
// list to the app's real UI inventory, so adding a screen or a modal added no
// coverage and reddened nothing — an expensive gate quietly becoming a partial
// one. This test is the missing third input: `scripts/lib/ui-census.ts`
// enumerates the censused UI elements from the source tree, resolves each
// against what the lane actually MEASURES, and anything neither measured nor
// reviewed reds here — offline, inside `check:all`, with no browser and no
// deployment.
//
// The full rationale, the two censused kinds and the recorded boundary live in
// `scripts/lib/ui-census.ts`; the operator-facing rules in
// `docs/guides/browser-verification.md` § The coverage census.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
    scanCensusElements,
    scanSpecimenFiles,
    resolveCensus,
    SPECIMEN_ROUTE,
    SPECIMEN_SECTION_DIR,
    exemptionFault,
    debtFault,
    type CensusRow,
} from "../lib/ui-census";
import { SURFACES } from "../ui-gate/surfaces";
import { UNWALKED_SURFACES } from "../ui-gate/floors";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * EXEMPT — reviewed, and genuinely owed no measurement.
 *
 * The reason must name WHY the element paints no layout of its own, never
 * where it lives: "it lives on the board" is not an exemption, it is a routing
 * instruction to the design-system specimen page. A locational reason is
 * refused mechanically below.
 */
const EXEMPT: Record<string, string> = {};

/**
 * DEBT — reviewed, DOES owe a measurement, and has none.
 *
 * This is the shape HEAD honestly had when the census shipped: an element the
 * lane cannot photograph today, recorded against the issue that owns closing
 * it. It is frozen and shrink-only — an entry that becomes covered, or whose
 * file disappears, reds as stale. Nothing may be added here to silence a NEW
 * element: give it a specimen on `/admin/design-system`, or a `mounts` line on
 * the surface that measures it.
 */
const DEBT: Record<string, string> = {
    // The one row of issue #4419's nineteen that its slice could not pay. Its
    // cards come from `useQuery(api.game.getManualLibraryTop, { gameId, … })`
    // with no `"skip"` branch once a peek is open, and `useQuery` THROWS on a
    // query error — so a fixture `gameId` takes the whole census page down
    // rather than mounting a specimen. Paying it means a Manual Board surface
    // (a `format: "manual"` deck, the Cockatrice-mode lobby, a live manual
    // game), which is a slice of its own: `docs/findings/`.
    "src/components/board/manual-peek-dialog.tsx":
        "the Manual Game library peek — a live `getManualLibraryTop` on a real manual game, so no fixture-prop specimen mounts it (#4402)",
    "src/components/cards/additional-cost-picker.tsx":
        "the additional-cost picker (#4402)",
    "src/components/cards/alt-cost-picker.tsx":
        "the alternative-cost picker (#4402)",
    "src/components/cards/card-preview-yield-menu.tsx":
        "the Card Preview's yield menu (#4402)",
    "src/components/cards/cast-cost-dialog.tsx": "the cast-cost dialog (#4402)",
    "src/components/cards/mode-picker.tsx": "the single-mode picker (#4402)",
    "src/components/cards/multi-mode-picker.tsx":
        "the multi-mode picker (#4402)",
    "src/components/cards/phyrexian-picker.tsx":
        "the Phyrexian-mana picker (#4402)",
    "src/components/cards/selectable-card.tsx":
        "the card tile's own ActionSheet (#4402)",
    "src/components/deckbuilder/deck-basics-sheet.tsx":
        "the deck-basics BottomSheet (#4402)",
    "src/components/deckbuilder/deck-stats-dialog.tsx":
        "the deck statistics dialog (#4402)",
    "src/components/limited/create-limited-event-dialog.tsx":
        "the create-event form (#4402)",
    "src/components/limited/limited-draft-table.tsx":
        "the Draft table's own dialog (#4402)",
    "src/components/limited/limited-event-detail.tsx":
        "the event page's inline confirm (#4402)",
    "src/components/limited/limited-table-ring.tsx":
        "the Table Ring's seat dialog (#4402)",
    "src/components/lobby/active-game-notice.tsx":
        "the resume/leave notice (#4402)",
    "src/components/lobby/banlist-cards-dialog.tsx":
        "the banlist card list (#4402)",
    "src/components/lobby/deck-builder/deck-banlist-panel.tsx":
        "the deck builder's banlist panel dialog (#4402)",
    "src/components/lobby/deck-builder/deck-builder.tsx":
        "the deck builder's inline confirm — the `deck-builder` surface measures the page, never this layer (#4402)",
    "src/components/lobby/deck-builder/deck-filters-button.tsx":
        "the card-filter BottomSheet (#4402)",
    "src/components/lobby/deck-builder/deck-import-dialog.tsx":
        "the decklist import dialog — the `deck-builder` surface asserts its opener and stops there (#4402)",
    "src/components/lobby/deck-detail.tsx":
        "the deck page's delete confirm — the `deck-detail` surface measures the page, never this layer (#4402)",
    "src/components/lobby/join-by-code-dialog.tsx":
        "the join-by-code form (#4402)",
    "src/components/lobby/lobby.tsx":
        "the lobby's inline confirm — the `lobby` surface measures the page, never this layer (#4402)",
    "src/routes/join.route.tsx": "the join-a-table screen (#4402)",
};

/** What to do about an uncensused element, in the terms of its own kind. */
/**
 * What `DEBT` holds. Pinned, not a ceiling: paying debt down lowers it, and
 * GROWING it is a two-line edit with a number going UP — which is what a
 * reviewer can see. A row quietly added to a 55-row dictionary is not, and
 * "frozen, shrink-only" was prose until this line.
 *
 * 55 when the census shipped; 47 since issue #4418 walked the eight unwalked
 * `/admin` and `/settings` SCREENS, the first slice of issue #4402; 29 since
 * issue #4419 gave the board's own dialogs seventeen live specimens on
 * `/admin/design-system` and the pregame gate a walk of its own; 25 since
 * issue #4423 gave the four cross-cutting overlays (disclaimer, bug report,
 * Inspect, the Scenarios active-game confirm) walked specimens. The
 * remaining slices are that issue's other children, one per area — when the
 * last one lands, this constant, `DEBT` and the tests below go with it.
 */
const DEBT_AT_LANDING = 25;

function fix(row: CensusRow): string {
    if (row.kind === "route") {
        return "a screen with no measurement at any viewport. Add a surface to `scripts/ui-gate/surfaces.ts` declaring it in `entries`, or — if it is not a screen a user reaches — say why in EXEMPT";
    }
    return "an overlay with no measurement at any viewport. Give it a live specimen on /admin/design-system (`sections-panels-dialogs.tsx`), or declare it in the `mounts` of the walked surface whose probe photographs it, or — only if it paints no layout of its own — add it to EXEMPT with why";
}

function census(): CensusRow[] {
    const unwalked = new Set(UNWALKED_SURFACES.map((u) => u.surface));
    return resolveCensus({
        elements: scanCensusElements(REPO_ROOT),
        surfaces: SURFACES.map((s) => ({
            id: s.id,
            entries: s.entries,
            mounts: s.mounts,
            walked: !unwalked.has(s.id),
        })),
        specimens: scanSpecimenFiles(REPO_ROOT),
        exempt: EXEMPT,
        debt: DEBT,
    });
}

describe("check:ui coverage census (issue #3420)", () => {
    it("every censused UI element is measured, exempt or recorded debt", () => {
        const open = census().filter((r) => r.status === "uncensused");
        expect(
            open.map((r) => `${r.file} (${r.kind})`),
            open.map((r) => `${r.file} — ${fix(r)}`).join("\n")
        ).toEqual([]);
    });

    it("no EXEMPT entry is stale (the element still exists and is still uncovered)", () => {
        const rows = census();
        const exempted = new Set(
            rows.filter((r) => r.status === "exempt").map((r) => r.file)
        );
        const stale = Object.keys(EXEMPT).filter((f) => !exempted.has(f));
        expect(
            stale,
            stale
                .map((f) => `${f} — EXEMPT entry matches nothing: remove it`)
                .join("\n")
        ).toEqual([]);
    });

    it("DEBT has not grown — a NEW uncovered element may not be recorded as debt", () => {
        expect(
            Object.keys(DEBT).length,
            "DEBT changed size. Shrinking it? Lower DEBT_AT_LANDING to match. Growing it? A new element does not belong here — give it a specimen or a `mounts` claim"
        ).toBe(DEBT_AT_LANDING);
    });

    it("no DEBT entry is stale — a covered element must lose its row", () => {
        const rows = census();
        const owed = new Set(
            rows.filter((r) => r.status === "debt").map((r) => r.file)
        );
        const stale = Object.keys(DEBT).filter((f) => !owed.has(f));
        expect(
            stale,
            stale
                .map(
                    (f) =>
                        `${f} — DEBT entry matches nothing: it is measured now, or the file is gone. Delete the row`
                )
                .join("\n")
        ).toEqual([]);
    });

    it("every EXEMPT reason is admissible — non-empty, and WHY rather than where", () => {
        const faults = Object.entries(EXEMPT)
            .map(([file, reason]) => exemptionFault(file, reason))
            .filter((f): f is string => f !== null);
        expect(faults, faults.join("\n")).toEqual([]);
    });

    it("every DEBT reason is admissible — non-empty, and names its owning issue", () => {
        const faults = Object.entries(DEBT)
            .map(([file, reason]) => debtFault(file, reason))
            .filter((f): f is string => f !== null);
        expect(faults, faults.join("\n")).toEqual([]);
    });

    it("every surface `mounts` entry is a real, censused overlay", () => {
        const overlays = new Set(
            scanCensusElements(REPO_ROOT)
                .filter((e) => e.kind === "overlay")
                .map((e) => e.file)
        );
        for (const surface of SURFACES) {
            for (const mount of surface.mounts ?? []) {
                expect(
                    fs.existsSync(path.join(REPO_ROOT, mount)),
                    `${surface.id}: mounts ${mount}, which does not exist`
                ).toBe(true);
                expect(
                    overlays.has(mount),
                    `${surface.id}: mounts ${mount}, which the census does not see as an overlay — it renders no censused layer, so the claim measures nothing`
                ).toBe(true);
            }
        }
    });

    it("an unwalked surface covers nothing it claims", () => {
        const unwalked = new Set(UNWALKED_SURFACES.map((u) => u.surface));
        const claimed = SURFACES.filter((s) => unwalked.has(s.id)).flatMap(
            (s) => s.mounts ?? []
        );
        const covered = new Set(
            census()
                .filter((r) => r.status === "walked")
                .map((r) => r.file)
        );
        // An unwalked surface's claim may coincide with a walked surface's —
        // what must never happen is the unwalked one being the ONLY reason a
        // file reads as covered.
        const byUnwalked = claimed
            .filter((file) => covered.has(file))
            .map((file) => ({
                file,
                by: census().find((r) => r.file === file)?.by ?? "",
            }))
            .filter(({ by }) => unwalked.has(by))
            .map(
                ({ file, by }) =>
                    `${file} reads as covered by ${by}, a surface declared UNWALKED`
            );
        expect(byUnwalked).toEqual([]);
    });
});

/**
 * The rules, exercised on inputs of their own rather than on whatever shape
 * HEAD happens to have. A rule that only ever sees the tree it was written
 * against is a rule nobody has watched work: `EXEMPT` is empty today, so
 * every assertion about an exemption above passes vacuously.
 */
describe("ui-census — the coverage rules themselves", () => {
    const overlay = {
        file: "src/components/board/x-dialog.tsx",
        kind: "overlay" as const,
        evidence: "<GameDialog>",
    };
    const route = {
        file: "src/routes/x.route.tsx",
        kind: "route" as const,
        evidence: "route module",
    };
    const base = {
        specimens: new Set<string>(),
        exempt: {},
        debt: {},
    };

    it("an element whose ONLY home is an UNWALKED surface is uncensused, never covered", () => {
        const [row] = resolveCensus({
            ...base,
            elements: [overlay],
            surfaces: [
                {
                    id: "game-stress",
                    entries: ["src/routes/game.route.tsx"],
                    mounts: [overlay.file],
                    walked: false,
                },
            ],
        });
        expect(row.status).toBe("uncensused");
        expect(row.by).toBe("");
    });

    it("the same claim from a WALKED surface covers it", () => {
        const [row] = resolveCensus({
            ...base,
            elements: [overlay],
            surfaces: [
                {
                    id: "game-board",
                    entries: ["src/routes/game.route.tsx"],
                    mounts: [overlay.file],
                    walked: true,
                },
            ],
        });
        expect(row).toMatchObject({ status: "walked", by: "game-board" });
    });

    it("a route that renders its own overlay yields BOTH rows — the route's coverage cannot hide the layer", () => {
        const rows = resolveCensus({
            ...base,
            elements: [route, { ...overlay, file: route.file }],
            surfaces: [{ id: "s", entries: [route.file], walked: true }],
        });
        expect(rows.map((r) => [r.kind, r.status])).toEqual([
            ["route", "walked"],
            ["overlay", "uncensused"],
        ]);
    });

    it("a route in a walked surface's entries is covered; an overlay in them is not", () => {
        const rows = resolveCensus({
            ...base,
            elements: [
                route,
                {
                    ...overlay,
                    file: route.file.replace(".route.tsx", "-dialog.tsx"),
                },
            ],
            surfaces: [{ id: "s", entries: [route.file], walked: true }],
        });
        expect(rows[0]).toMatchObject({ status: "walked", by: "s" });
        expect(rows[1].status).toBe("uncensused");
    });

    it("a file the design-system census page mounts is covered by its specimen", () => {
        const [row] = resolveCensus({
            ...base,
            elements: [overlay],
            surfaces: [],
            specimens: new Set([overlay.file]),
        });
        expect(row.status).toBe("specimen");
    });

    it("EXEMPT and DEBT are read only when nothing measures the element", () => {
        const [exempt] = resolveCensus({
            ...base,
            elements: [overlay],
            surfaces: [],
            exempt: { [overlay.file]: "renders no layout of its own" },
        });
        expect(exempt.status).toBe("exempt");
        const [debt] = resolveCensus({
            ...base,
            elements: [overlay],
            surfaces: [],
            debt: { [overlay.file]: "owed a specimen (#4402)" },
        });
        expect(debt.status).toBe("debt");
    });

    it("the SCAN itself emits both rows for a route module that renders its own dialog", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-census-"));
        try {
            fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
            fs.writeFileSync(
                path.join(root, "src", "routes", "x.route.tsx"),
                "export default () => <GameDialog open />;\n"
            );
            expect(
                scanCensusElements(root).map((e) => [e.kind, e.evidence])
            ).toEqual([
                ["route", "route module"],
                ["overlay", "<GameDialog>"],
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(["~/", "@/"])(
        "a specimen imported through the %s alias registers — both tsconfig aliases resolve",
        (alias) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-census-"));
            try {
                fs.mkdirSync(
                    path.join(root, "src", "routes", "design-system"),
                    { recursive: true }
                );
                fs.mkdirSync(path.join(root, "src", "components"), {
                    recursive: true,
                });
                fs.writeFileSync(
                    path.join(root, SPECIMEN_ROUTE),
                    'import { S } from "./design-system/sections-x";\n'
                );
                fs.writeFileSync(
                    path.join(root, SPECIMEN_SECTION_DIR, "sections-x.tsx"),
                    `import X from "${alias}components/x-dialog";\nexport const S = X;\n`
                );
                fs.writeFileSync(
                    path.join(root, "src", "components", "x-dialog.tsx"),
                    "export default () => <GameDialog open />;\n"
                );
                expect(
                    scanSpecimenFiles(root).has("src/components/x-dialog.tsx")
                ).toBe(true);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it("an EXEMPT reason that is empty, or that says where rather than why, is refused", () => {
        expect(exemptionFault("a.tsx", "   ")).toMatch(/empty EXEMPT reason/);
        expect(exemptionFault("a.tsx", "it lives on the board")).toMatch(
            /says where the element lives/
        );
        expect(
            exemptionFault("a.tsx", "board-only, opened from a tile")
        ).toMatch(/says where the element lives/);
        expect(
            exemptionFault(
                "a.tsx",
                "a pure wrapper — it renders no layout of its own"
            )
        ).toBeNull();
    });

    it("a DEBT reason that is empty, or that names no owning issue, is refused", () => {
        expect(debtFault("a.tsx", "")).toMatch(/empty DEBT reason/);
        expect(debtFault("a.tsx", "owed a specimen")).toMatch(
            /names no owning issue/
        );
        expect(debtFault("a.tsx", "owed a specimen (#4402)")).toBeNull();
    });
});
