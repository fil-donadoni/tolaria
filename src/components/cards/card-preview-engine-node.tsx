import type { EngineNode, EngineNodeKind } from "~/lib/engine-view-tree";

/**
 * One row of the Engine View tree (issue #2704): a kind badge, the construct's
 * label, its parameter chips, and its children nested beneath a hairline rule.
 *
 * Recursive, and deliberately the ONLY component that knows the tree is a
 * tree — `CardPreviewEngineTree` renders a flat list of roots and never
 * reaches into a node's children.
 */

/** Tone per node kind. Four roles, not nine colours: the eye should read
 *  "this is data / this is a target / this is an effect / this is CODE" at a
 *  glance, and nine hues in a 300px-wide overlay column reads as confetti.
 *
 *  `RES` reuses the Protocol badge's `signal-pending` on purpose
 *  (`card-preview-engine-view-badge.tsx`): a hand-written body is exactly what
 *  the Protocol chip in the header is claiming, and the same colour is what
 *  connects the two. */
const KIND_TONE: Record<EngineNodeKind, string> = {
    KW: "bg-signal-self/15 text-signal-self-strong",
    STA: "bg-signal-self/15 text-signal-self-strong",
    TGT: "bg-signal-target/15 text-signal-target-strong",
    EFF: "bg-secondary-accent/15 text-secondary-accent-strong",
    MOD: "bg-accent/15 text-accent-strong",
    TRG: "bg-accent/15 text-accent-strong",
    ACT: "bg-accent/15 text-accent-strong",
    FACE: "bg-accent/15 text-accent-strong",
    RES: "bg-signal-pending/15 text-signal-pending-strong",
    CARD: "bg-signal-self/15 text-signal-self-strong",
};

export default function CardPreviewEngineNode({ node }: { node: EngineNode }) {
    return (
        <li className="space-y-1">
            <div className="flex items-baseline gap-1.5">
                <span
                    className={`shrink-0 rounded-sm px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${KIND_TONE[node.kind]}`}
                >
                    {node.kind}
                </span>
                <span className="min-w-0 break-words text-[11px] font-medium text-text">
                    {node.label}
                </span>
            </div>
            {node.chips.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {node.chips.map((chip) => (
                        <span
                            key={chip.key}
                            className="rounded-sm bg-surface-elevated px-1 py-px text-[10px] text-text-muted"
                        >
                            <span className="text-text-disabled">
                                {chip.key}
                            </span>{" "}
                            {chip.value}
                        </span>
                    ))}
                </div>
            )}
            {node.children.length > 0 && (
                <ul className="ml-1.5 space-y-1 border-l border-border-subtle pl-2">
                    {node.children.map((child) => (
                        <CardPreviewEngineNode key={child.path} node={child} />
                    ))}
                </ul>
            )}
        </li>
    );
}
