import EngineViewBadgeChip from "./card-preview-engine-view-badge";
import CardPreviewEngineTree from "./card-preview-engine-tree";
import type { EngineViewBadge } from "~/lib/preview-body";
import type { EngineViewTree } from "~/lib/engine-view-tree";
import type { EngineViewReportContext } from "~/lib/engine-view-report";

// The "Engine view" slot (ADR 0103 §9, issue #2728), now carrying issue
// #2704's tree. Two things are rendered from the same real `CardDefinition`:
//
//  - the BADGE — what the definition IS (a DSL-first Effect Script vs a
//    hand-written `resolve()` / mana-ability closure, ADR 0045) plus, for a
//    script, a rough Op-count chip. A definition with no resolution body at
//    all renders NO chip (`EngineViewBadgeChip`) — there is no script to claim.
//  - the TREE (`[data-engine-view-tree]`) — HOW it read it: keyword / static /
//    target / effect / triggered / activated nodes with parameter chips, a
//    declarative-coverage bar, and a "Report a problem" draft.
//
// `compact` is the desktop lateral zoom (`CardPreviewDock`, ADR 0103 issue
// body: "carries an Alt: engine view affordance") — no room there for the
// header + tree well, so it renders just the badge and a discoverability
// hint instead. The full slot (mobile long-press overlay, the anchored pin,
// the editing surfaces' `InspectOverlay`) renders the eyebrow header and the
// tree beneath it.
export default function CardPreviewEngineView({
    badge,
    tree,
    reportContext,
    compact = false,
}: {
    /** `null`/`undefined` — no `CardDefinition` to read (an emblem/
     *  designation face, or an unresolved id) — renders nothing. */
    badge?: EngineViewBadge | null;
    /** The tree for the same definition (`buildEngineViewTree`). Null exactly
     *  when `badge` is; optional so the hand-built `PreviewBodyContent`
     *  fixtures predating issue #2704 keep compiling, in which case the slot
     *  degrades to its issue-#2728 form — header, badge, empty well. */
    tree?: EngineViewTree | null;
    reportContext?: EngineViewReportContext;
    compact?: boolean;
}) {
    if (!badge) return null;

    if (compact) {
        return (
            <div className="flex items-center gap-2 border-t border-border-subtle pt-2 text-xs">
                <EngineViewBadgeChip badge={badge} />
                <span className="text-text-muted">Alt: engine view</span>
            </div>
        );
    }

    return (
        <div
            data-engine-view-slot
            className="border-t border-border-subtle pt-2 space-y-1.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-label">Engine view</span>
                <EngineViewBadgeChip badge={badge} />
            </div>
            <div data-engine-view-tree>
                {tree && (
                    <CardPreviewEngineTree
                        tree={tree}
                        reportContext={reportContext}
                    />
                )}
            </div>
        </div>
    );
}
