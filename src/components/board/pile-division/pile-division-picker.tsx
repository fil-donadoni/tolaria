// The Fact-or-Fiction pile-division dialog (ADR 0053, `divide-piles` /
// `pick-pile`). Two modes over ONE 3-zone stage:
//
//   • DIVIDE (`divide-piles`, the divider) — a CANDIDATES row on top and two
//     empty PILE boxes below. Every candidate is dragged down into pile A or B;
//     Done submits pile A's ids (the engine takes the remainder as pile B, so
//     the divide contract is unchanged — see `divideIntoPiles`).
//   • PICK (`pick-pile`, the chooser) — no candidates row; the two completed
//     piles are shown face-up and the chooser takes one.
//
// The drag reuses the HAND / scry mechanism — pointer capture + a stable DOM
// node whose only mutation mid-gesture is its transform — NOT a dnd library, so
// capture is never dropped and the motion stays fluid. Cards are keyed by
// instance id and laid out absolutely from a computed position map; on drop the
// assignment changes and every card springs to its new slot.
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, PendingChoice } from "~/types/game";
import { formatOracleText } from "~/lib/oracle-text";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import MinimizeChoiceButton, {
    MINIMIZE_BUTTON_INSET,
} from "~/components/board/minimize-choice-button";
import PileZone from "./pile-zone";
import PileCard from "./pile-card";
import { CARD_H, STAGE_W, computePileLayout } from "./layout";
import type { PileKey } from "./layout";

const DRAG_START_PX = 6;

type Drag = {
    id: string;
    /** Live pointer position in stage-local px. */
    x: number;
    y: number;
    /** Pointer position (stage-local) at grab time — the drag-threshold anchor. */
    startX: number;
    startY: number;
    /** Pointer − card origin at grab time, so the card tracks the pointer 1:1. */
    grabX: number;
    grabY: number;
    /** True once the pointer has travelled past the drag threshold. */
    moved: boolean;
};

export default function PileDivisionPicker({
    choice,
    cards,
    playerId,
    gameId,
}: {
    choice: PendingChoice;
    /** The divided cards, resolved to face-up instances (candidateIds for
     *  divide; pileA∪pileB for pick). */
    cards: CardInstance[];
    playerId: string;
    gameId: Id<"games">;
}) {
    const submitChoice = useMutation(api.game.submitResolutionChoice);
    const [busy, setBusy] = useState(false);
    // Shared positioning (issue #1762 review) — this dialog used to hardcode
    // its own `absolute top-1/2 left-1/2` + `useDraggable` recipe (the same
    // dead-board-center bug the small prompt banners had). Desktop stays
    // centered and draggable via the header handle below; portrait pins it
    // to the safe-area strip instead, with dragging disabled.
    const { outerClassName, outerStyle, dragHandlers } =
        usePromptBannerPosition();

    const isPick = choice.kind === "pick-pile";

    // divide: all candidates start in the CANDIDATES zone. pick: cards are
    // pre-split into A / B and never move (read-only).
    const initialAssignment = useMemo(() => {
        const m: Record<string, PileKey> = {};
        if (isPick) {
            const inA = new Set(choice.pileA ?? []);
            for (const c of cards) m[c.id] = inA.has(c.id) ? "A" : "B";
        } else {
            for (const c of cards) m[c.id] = "candidates";
        }
        return m;
    }, [cards, isPick, choice.pileA]);

    const [assignment, setAssignment] =
        useState<Record<string, PileKey>>(initialAssignment);
    const [drag, setDrag] = useState<Drag | null>(null);

    const stageRef = useRef<HTMLDivElement>(null);
    const zoneRefs = useRef<Record<PileKey, HTMLDivElement | null>>({
        candidates: null,
        A: null,
        B: null,
    });

    const layout = useMemo(
        () => computePileLayout(cards, assignment),
        [cards, assignment]
    );

    // Which zone contains the pointer, by hit-testing the three zone boxes.
    const zoneAtPoint = useCallback(
        (clientX: number, clientY: number): PileKey | null => {
            for (const key of ["A", "B", "candidates"] as PileKey[]) {
                const el = zoneRefs.current[key];
                if (!el) continue;
                const r = el.getBoundingClientRect();
                if (
                    clientX >= r.left &&
                    clientX <= r.right &&
                    clientY >= r.top &&
                    clientY <= r.bottom
                )
                    return key;
            }
            return null;
        },
        []
    );

    const onPointerDown = useCallback(
        (e: React.PointerEvent, id: string) => {
            if (isPick || busy) return; // pick mode: cards are read-only
            const stage = stageRef.current;
            if (!stage) return;
            const stageRect = stage.getBoundingClientRect();
            const pos = layout.get(id);
            if (!pos) return;
            // Card origin in stage-local px; pointer offset within the card.
            const px = e.clientX - stageRect.left;
            const py = e.clientY - stageRect.top;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({
                id,
                x: px,
                y: py,
                startX: px,
                startY: py,
                grabX: px - pos.x,
                grabY: py - pos.y,
                moved: false,
            });
        },
        [isPick, busy, layout]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!drag) return;
            const stage = stageRef.current;
            if (!stage) return;
            const stageRect = stage.getBoundingClientRect();
            const px = e.clientX - stageRect.left;
            const py = e.clientY - stageRect.top;
            const moved =
                drag.moved ||
                Math.hypot(px - drag.startX, py - drag.startY) > DRAG_START_PX;
            setDrag({ ...drag, x: px, y: py, moved });
        },
        [drag]
    );

    const onPointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (!drag) return;
            const id = drag.id;
            const target = zoneAtPoint(e.clientX, e.clientY);
            setDrag(null);
            if (drag.moved && target && target !== assignment[id]) {
                setAssignment((a) => ({ ...a, [id]: target }));
            }
        },
        [drag, assignment, zoneAtPoint]
    );

    const remaining = cards.filter(
        (c) => assignment[c.id] === "candidates"
    ).length;
    const canConfirm = !isPick && remaining === 0 && !busy;

    const submitDivide = useCallback(async () => {
        if (!canConfirm) return;
        setBusy(true);
        try {
            const pileA = cards
                .filter((c) => assignment[c.id] === "A")
                .map((c) => c.id);
            await submitChoice({
                gameId,
                playerId,
                stackItemId: choice.stackItemId,
                step: choice.step,
                choiceId: choice.choiceId,
                cardInstanceIds: pileA,
            });
        } finally {
            setBusy(false);
        }
    }, [canConfirm, cards, assignment, submitChoice, gameId, playerId, choice]);

    const takePile = useCallback(
        async (pile: "A" | "B") => {
            if (busy) return;
            setBusy(true);
            try {
                await submitChoice({
                    gameId,
                    playerId,
                    stackItemId: choice.stackItemId,
                    step: choice.step,
                    choiceId: choice.choiceId,
                    cardInstanceIds: [pile],
                });
            } finally {
                setBusy(false);
            }
        },
        [busy, submitChoice, gameId, playerId, choice]
    );

    return (
        <div className={outerClassName} style={outerStyle}>
            <Panel
                density="compact"
                size="wide"
                className="flex flex-col items-center gap-2 px-5 py-3 pointer-events-auto"
            >
                {/* {@link MINIMIZE_BUTTON_INSET} (`top-2.5 right-2.5`, 10px)
                    — not `top-1.5 right-1.5` (6px, #1770 review): the
                    button's own `before:-inset-2.5` pseudo-hit overhangs 10px
                    past the visible glyph — a 6px inset clipped 4px of that
                    hit box against the panel edge, shrinking the delivered
                    target to ~40px. Same pairing as the `PendingChoicePrompt`
                    mount (`pending-choice-prompt.tsx`) — the inset must be
                    >= the overhang for the full 44px target to survive. */}
                <MinimizeChoiceButton
                    className={`absolute ${MINIMIZE_BUTTON_INSET}`}
                />

                {/* Header — draggable handle for the whole dialog. */}
                <div
                    {...dragHandlers}
                    className="flex flex-col items-center text-center gap-1 cursor-move w-full"
                >
                    <p className="font-beleren text-sm tracking-wide text-parchment">
                        {isPick ? "Choose a Pile" : "Divide into Two Piles"}
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-border-accent/40 to-transparent" />
                    <p className="text-text-muted text-xs">
                        {formatOracleText(choice.prompt)}
                    </p>
                </div>

                {/* The 3-zone stage, in its own horizontal-scroll viewport
                    (issue #1762 review) — `STAGE_W` (560px) is a fixed
                    geometry constant the drop-zone hit-testing and card fan
                    math (`layout.ts`) are built around, and re-deriving it
                    per breakpoint would ripple through every zone box /
                    card-position calculation for no real gain. Capping/
                    scrolling the VIEWPORT around the stage instead is the
                    smallest correct fix: `getBoundingClientRect()` (used by
                    both the pointer-drag math and `zoneAtPoint` below)
                    reports the stage's actual on-screen position regardless
                    of how far this wrapper has scrolled it, so the drag/drop
                    math needs no changes — a portrait player just scrolls
                    sideways to reach a card past the fold instead of the
                    stage overflowing the panel (or the whole board). */}
                <div className="max-w-full overflow-x-auto">
                    <div
                        ref={stageRef}
                        className="relative"
                        style={{ width: STAGE_W, height: CARD_H * 2 + 96 }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                    >
                        {!isPick && (
                            <PileZone
                                label="Revealed"
                                variant="candidates"
                                zoneRef={(el) =>
                                    (zoneRefs.current.candidates = el)
                                }
                            />
                        )}
                        <PileZone
                            label={
                                isPick
                                    ? `Pile A (${choice.pileA?.length ?? 0})`
                                    : "Pile A"
                            }
                            variant="pileA"
                            zoneRef={(el) => (zoneRefs.current.A = el)}
                        />
                        <PileZone
                            label={
                                isPick
                                    ? `Pile B (${choice.pileB?.length ?? 0})`
                                    : "Pile B"
                            }
                            variant="pileB"
                            zoneRef={(el) => (zoneRefs.current.B = el)}
                        />

                        {cards.map((card) => {
                            const pos = layout.get(card.id)!;
                            const isDragging =
                                drag?.id === card.id && drag.moved;
                            const x = isDragging
                                ? drag!.x - drag!.grabX
                                : pos.x;
                            const y = isDragging
                                ? drag!.y - drag!.grabY
                                : pos.y;
                            return (
                                <PileCard
                                    key={card.id}
                                    card={card}
                                    x={x}
                                    y={y}
                                    dragging={isDragging}
                                    interactive={!isPick && !busy}
                                    onPointerDown={(e) =>
                                        onPointerDown(e, card.id)
                                    }
                                />
                            );
                        })}
                    </div>
                </div>

                {/* Footer actions. */}
                {isPick ? (
                    <div className="flex gap-2 mt-1">
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={busy}
                            onClick={() => takePile("A")}
                        >
                            Take Pile A
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={busy}
                            onClick={() => takePile("B")}
                        >
                            Take Pile B
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-1 mt-1">
                        {remaining > 0 && (
                            <p className="text-text-disabled text-xs">
                                {remaining} card{remaining === 1 ? "" : "s"}{" "}
                                left — drag {remaining === 1 ? "it" : "each"}{" "}
                                into a pile
                            </p>
                        )}
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={!canConfirm}
                            onClick={submitDivide}
                        >
                            Done
                        </Button>
                    </div>
                )}
            </Panel>
        </div>
    );
}
