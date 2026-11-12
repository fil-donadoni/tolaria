import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { TargetArrow } from "~/lib/target-arrow-geometry";
import { ANCHORS_REPOSITION_EVENT } from "~/hooks/anchor-reposition";
import { focusNodeSelectors, veilClipPath } from "~/lib/arrow-focus";
import { visibleRect, type ViewportRect } from "~/lib/visible-rect";
import ArrowDefs from "./board-arrow-defs";
import BoardArrowPath from "./board-arrow-path";

const FOCUS_DEF_IDS = {
    grad: "focus-arrow-grad",
    head: "focus-arrowhead",
    shadow: "focus-arrow-shadow",
};

type Measured = {
    /** Board-root origin in the viewport (arrows are in board coordinates). */
    origin: { x: number; y: number };
    holes: ViewportRect[];
    width: number;
    height: number;
};

/** Measure the lit nodes' VISIBLE boxes (a stack row half scrolled out of the
 *  stack panel lights only its visible slice — never a box spilling outside
 *  the panel) and the board root's viewport origin. */
function measure(
    boardRef: RefObject<Element | null>,
    nodes: ReadonlySet<string>
): Measured | null {
    const board = boardRef.current;
    if (!board) return null;
    const root = board.getBoundingClientRect();
    const holes: ViewportRect[] = [];
    for (const node of nodes) {
        for (const sel of focusNodeSelectors(node)) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
                const r = visibleRect(el);
                if (r) holes.push(r);
            }
        }
    }
    return {
        origin: { x: root.left, y: root.top },
        holes,
        width: window.innerWidth,
        height: window.innerHeight,
    };
}

/**
 * The hover FOCUS of a targeting relationship (issue #9326, variant B): while
 * a stack row, an ability's source permanent, a target arrow or a targeted
 * zone pile is hovered, the rest of the board is veiled — darkened AND
 * blurred, so the overlapping cards of a pile do not read as a glitch — except
 * the relationship's own elements, cut out of the veil. The relationship's
 * arrows are redrawn ABOVE the veil at full strength.
 *
 * Portaled to `<body>` at `z-modal`: mounted on hover, so it lands later in
 * the document than the stack panel (also `z-modal`) and veils its other rows
 * too, and earlier than a card preview that hover then opens (also
 * `z-modal`), which stays sharp. Context menus and popovers sit at
 * `z-modal-peak`, above both. Pointer-transparent: hover keeps reaching the
 * board beneath.
 */
export default function ArrowFocusLayer({
    boardRef,
    nodes,
    arrows,
}: {
    /** An element spanning the board root (the arrow SVG). */
    boardRef: RefObject<Element | null>;
    nodes: ReadonlySet<string>;
    /** The lit arrows, in board-root coordinates. */
    arrows: readonly TargetArrow[];
}) {
    const [measured, setMeasured] = useState<Measured | null>(null);
    useLayoutEffect(() => {
        const update = () => setMeasured(measure(boardRef, nodes));
        update();
        window.addEventListener("resize", update);
        document.addEventListener("scroll", update, true);
        window.addEventListener(ANCHORS_REPOSITION_EVENT, update);
        return () => {
            window.removeEventListener("resize", update);
            document.removeEventListener("scroll", update, true);
            window.removeEventListener(ANCHORS_REPOSITION_EVENT, update);
        };
    }, [boardRef, nodes]);

    if (!measured) return null;
    const clip = veilClipPath(measured.holes, measured.width, measured.height);
    return createPortal(
        <>
            <div
                aria-hidden
                data-testid="arrow-focus-veil"
                className="pointer-events-none fixed inset-0 z-modal"
                style={{
                    background: "rgb(0 0 0 / 0.55)",
                    backdropFilter: "blur(5px) saturate(0.7)",
                    WebkitBackdropFilter: "blur(5px) saturate(0.7)",
                    clipPath: `path(nonzero, "${clip}")`,
                }}
            />
            <svg
                aria-hidden
                data-testid="arrow-focus-arrows"
                className="pointer-events-none fixed inset-0 z-modal h-full w-full overflow-visible"
            >
                <ArrowDefs ids={FOCUS_DEF_IDS} />
                <g
                    transform={`translate(${measured.origin.x} ${measured.origin.y})`}
                >
                    {arrows.map((arrow) => (
                        <BoardArrowPath
                            key={arrow.key}
                            arrow={arrow}
                            strength="emphasized"
                            dimmed={false}
                            dimOpacity={1}
                            ids={FOCUS_DEF_IDS}
                        />
                    ))}
                </g>
            </svg>
        </>,
        document.body
    );
}
