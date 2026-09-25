// Cross-cutting overlay specimens — the census's live mounts for the four
// overlays that belong to no one page (issue #4423, slice of the `check:ui`
// coverage census debt issue #4402).
//
// WHY THIS SECTION EXISTS. The legal disclaimer (every new account is shown
// it), the bug-report form (reachable from every screen), the modal Inspect
// overlay (opened from a Peek rail and from the Draft table) and the Scenarios
// page's "a game is already running" confirm were measured at no viewport. None
// of them is a page a walk can land on: each sits behind an opener on some
// other surface, and two of those openers need state the lane does not have (a
// fresh account; an active game at the moment a scenario is launched). All four
// render from plain props, which is what this section hands them.
//
// ONE AT A TIME, BY DESIGN — the same rule as § 16 Board dialogs
// (`sections-board-dialogs.tsx`): each of these is a portal overlay at
// `position: fixed`, so the page mounts exactly the one its opener selected,
// and `scripts/ui-gate/surfaces.ts` walks one `dlg-*` surface per opener.
//
// THE PROPS ARE FIXTURES. The bug-report form reads the signed-in account
// (the lane is signed in) and only spends a mutation on Submit, which no walk
// presses; the scenario confirm's `activeGame` is a specimen row whose ids go
// nowhere, because its two buttons only close the specimen here.
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { ActiveGameInfo } from "~/hooks/useScenarioTestGame";
import BugReportDialog from "~/components/bug-report/bug-report-dialog";
import DisclaimerDialog from "~/components/legal/disclaimer-dialog";
import InspectOverlay from "~/components/editing/inspect-overlay";
import ScenarioActiveGameDialog from "~/components/admin/scenario-active-game-dialog";
import { Section, Specimen, Where } from "./lib";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

/** Lightning Bolt's registry id (`convex/cards/sets/lea/red.ts`) — a real
 *  definition with art on every deployment the lane walks, so the overlay
 *  measures the real face and oracle text, not a fallback name. */
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/** A specimen active game: the shape `api.game.myActiveGame` returns. A
 *  2-player game with a named opponent, so the confirm's subtitle is its
 *  longest variant — the one worth photographing on a phone. */
const ACTIVE_GAME: ActiveGameInfo = {
    gameId: "specimen-game" as unknown as Id<"games">,
    matchId: "specimen-match" as unknown as Id<"matches">,
    name: "Specimen game",
    status: "playing",
    matchStatus: "playing",
    solo: false,
    vsAi: false,
    mode: null,
    opponentName: "Rival",
};

/* ── The specimen table ───────────────────────────────────────────────── */

type OverlaySpecimen = {
    /** Opener seam and `dlg-<slug>` surface id. */
    slug: string;
    label: string;
    /** Repo-relative module the census row is keyed on. */
    file: string;
    render: (close: () => void) => React.ReactNode;
};

const SPECIMENS: OverlaySpecimen[] = [
    {
        slug: "disclaimer",
        label: "Legal & Disclaimer",
        file: "legal/disclaimer-dialog.tsx",
        render: (close) => (
            <DisclaimerDialog
                open
                onOpenChange={(next) => {
                    if (!next) close();
                }}
            />
        ),
    },
    {
        slug: "bug-report",
        label: "Report a bug",
        file: "bug-report/bug-report-dialog.tsx",
        render: (close) => (
            <BugReportDialog
                open
                onOpenChange={(next) => {
                    if (!next) close();
                }}
            />
        ),
    },
    {
        slug: "inspect-overlay",
        label: "Inspect overlay",
        file: "editing/inspect-overlay.tsx",
        // The Draft table's shape: a primary Pick CTA and both step arrows,
        // so the header row and the action row are both on the photograph.
        render: (close) => (
            <InspectOverlay
                cardId={BOLT}
                actions={[
                    { label: "Pick", onSelect: close, primary: true },
                    { label: "Move to…", onSelect: () => {} },
                ]}
                onStep={{ previous: () => {}, next: () => {} }}
                onClose={close}
            />
        ),
    },
    {
        slug: "scenario-active-game",
        label: "Concede active game?",
        file: "admin/scenario-active-game-dialog.tsx",
        render: (close) => (
            <ScenarioActiveGameDialog
                activeGame={ACTIVE_GAME}
                busy={false}
                onCancel={close}
                onConfirm={close}
            />
        ),
    },
];

export function OverlaysSection() {
    const [open, setOpen] = useState<string | null>(null);
    const close = () => setOpen(null);
    const mounted = SPECIMENS.find((s) => s.slug === open);

    return (
        <Section
            id="overlays"
            index="17"
            title="Cross-cutting overlays"
            blurb={
                <>
                    The overlays that belong to no one page — the legal
                    disclaimer, the bug-report form, the Inspect overlay and the
                    Scenarios page&apos;s active-game confirm — mounted from
                    fixture props (issue #4423). One at a time, as § 16:
                    <code>check:ui</code> walks one <code>dlg-*</code> surface
                    per opener.
                </>
            }
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {SPECIMENS.map((s) => (
                    <Specimen key={s.slug} label={s.label} tone="plain">
                        <button
                            type="button"
                            data-overlay-specimen={s.slug}
                            className="btn-base btn-tone-secondary w-full px-3 py-1.5 text-xs"
                            onClick={() => setOpen(s.slug)}
                        >
                            Open {s.label}
                        </button>
                        <Where>{s.file}</Where>
                    </Specimen>
                ))}
            </div>
            {mounted?.render(close)}
        </Section>
    );
}
