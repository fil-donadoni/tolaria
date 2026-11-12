import CardPreviewEngineNode from "./card-preview-engine-node";
import type { EngineViewTree } from "~/lib/engine-view-tree";

/**
 * The Engine View tree (issue #2704, PRD #2693, ADR 0103 §9) — how the engine
 * read this card, mounted inside the slot's `[data-engine-view-tree]` well
 * (`card-preview-engine-view.tsx`, shipped empty by issue #2728).
 *
 * Purely a renderer: every derivation lives in `~/lib/engine-view-tree.ts`
 * and the preview-body builder, so nothing here can become a second reading of a
 * card that drifts from the engine's.
 *
 * The well SCROLLS at a fixed max height rather than growing with the card.
 * Ojutai's Command's tree is four modes deep; letting it size the overlay
 * pushes the card art off a 390px-tall phone screen, which is precisely the
 * class of bug `.claude/rules/chrome-debug.md` exists for.
 */
export default function CardPreviewEngineTree({
    tree,
}: {
    tree: EngineViewTree;
}) {
    const { declarative, total } = tree.coverage;
    const complete = total > 0 && declarative === total;

    return (
        <div className="space-y-1.5">
            {total > 0 && (
                <div className="space-y-0.5">
                    <div
                        className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
                        role="img"
                        aria-label={`${declarative} of ${total} resolution bodies are declarative`}
                    >
                        <div
                            className={`h-full rounded-full ${complete ? "bg-success-strong" : "bg-signal-pending-strong"}`}
                            style={{
                                width: `${Math.round((declarative / total) * 100)}%`,
                            }}
                        />
                    </div>
                    <div className="text-[10px] text-text-muted">
                        {declarative}/{total} declarative
                    </div>
                </div>
            )}

            {tree.nodes.length > 0 ? (
                <ul
                    data-engine-view-nodes
                    className="max-h-48 space-y-1 overflow-y-auto pr-1"
                >
                    {tree.nodes.map((node) => (
                        <CardPreviewEngineNode key={node.path} node={node} />
                    ))}
                </ul>
            ) : (
                // A vanilla creature or a basic land: nothing the engine has to
                // read. Said out loud, because an empty well next to an "Engine
                // view" header reads as a component that failed to render.
                <div className="text-[10px] text-text-muted">
                    Nothing to interpret — this card has no abilities the engine
                    reads.
                </div>
            )}
        </div>
    );
}
