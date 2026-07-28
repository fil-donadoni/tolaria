// The ordered top-of-library drag picker (scry / surveil / ponder) — the real
// UI, folded in from the throwaway `prototype/scry`. Rebuilt on the HAND's
// reorder mechanism (pointer capture + DEFERRED commit) rather than a dnd
// library: the card's DOM node never moves during a drag (it stays keyed by
// INSTANCE id, only its transform changes), so pointer capture is never dropped
// mid-gesture — the same trick that makes the hand smooth.
//
// One continuous strip: [ second zone ][ library mock ][ top zone ]. Which side
// of the library a card is released on decides its destination:
//   • Scry    (`library-bottom`) — second zone = BOTTOM of library (fused fan).
//   • Surveil (`graveyard`)      — second zone = GRAVEYARD (detached dashed box).
//   • Ponder  (`none`)           — no second zone (all kept, order only).
// Rightmost = top of library (drawn first). On confirm the picker submits the
// kept cards topmost-first as `cardInstanceIds` and the rest as `secondZoneIds`.
//
// `distribute` mode (Impulse / Stock Up, `look-distribute`) reuses the same
// strip with different chrome: the RIGHT zone is the HAND (labelled HAND,
// constrained to exactly `keep` cards) and the LEFT zone is the ordered BOTTOM.
// Cards start in the BOTTOM zone; the player pulls exactly `keep` up to the
// hand. On confirm the hand cards go out as `cardInstanceIds`, the bottom cards
// (ordered) as `secondZoneIds`.
import { useCallback, useMemo, useRef, useState } from "react";
import type { LibraryDestination } from "@convex/gre/types";
import {
    canAddCategorizedPick,
    type PickCategory,
} from "@convex/gre/categorizedPick";
import { SLOT_SPRING } from "~/lib/board-motion";
import { Minus, Hand, Layers, Skull } from "lucide-react";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import OrderCard from "./order-card";
import DeckMock, { DECK_W, DECK_H } from "./deck-mock";
import { CARD_W, CARD_H, LIFT, DRAG_START_PX, REVEAL } from "./constants";
import { computeLayout, insertionIndex, type Zone } from "./layout";

/** Zone label chrome (phase 2, winner A): every picker zone declares its name
 *  + ordering hint + icon up front — the fused text labels under the strip are
 *  gone (they were the Narset hand/top confusion). */
type ZoneMeta = {
    title: string;
    hint: string;
    icon: "library" | "hand" | "graveyard";
};

function ZoneLabel({ meta, accent }: { meta: ZoneMeta; accent: boolean }) {
    const Icon =
        meta.icon === "hand"
            ? Hand
            : meta.icon === "graveyard"
              ? Skull
              : Layers;
    return (
        <div
            className={`flex items-center gap-2 rounded-sm border px-2 py-1 ${
                accent
                    ? "border-accent/50 bg-accent-soft/20 text-accent-strong"
                    : "border-border-subtle bg-surface-elevated/40 text-text-muted"
            }`}
        >
            <Icon className="h-4 w-4" />
            <div className="leading-tight">
                <p className="text-[11px] font-bold tracking-wide uppercase">
                    {meta.title}
                </p>
                <p className="text-[10px] opacity-80">{meta.hint}</p>
            </div>
        </div>
    );
}

const META_LIBRARY_TOP: ZoneMeta = {
    title: "Top of library",
    hint: "rightmost = topmost",
    icon: "library",
};
const META_LIBRARY_BOTTOM: ZoneMeta = {
    title: "Bottom of library",
    hint: "ordered — first here ends up deepest",
    icon: "library",
};
const META_HAND: ZoneMeta = {
    title: "Your hand",
    hint: "cards you keep",
    icon: "hand",
};
const META_HAND_POOL: ZoneMeta = {
    title: "Your hand",
    hint: "source pool",
    icon: "hand",
};
const META_GRAVEYARD: ZoneMeta = {
    title: "Graveyard",
    hint: "discarded / milled",
    icon: "graveyard",
};

export type LookedAtCard = { instanceId: string; defId: string };

type Drag = {
    id: string;
    /** Live strip-local pointer x. */
    pointerX: number;
    /** pointer − card center at grab time, so the card tracks the pointer 1:1. */
    grabOffsetX: number;
};

const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

/** Zone chrome per destination (labels/hints/detach flags). */
function chromeFor(destination: LibraryDestination): {
    leftMeta: ZoneMeta | null;
    rightMeta: ZoneMeta;
    hasSecond: boolean;
    detached: boolean;
} {
    switch (destination) {
        case "library-bottom":
            return {
                leftMeta: META_LIBRARY_BOTTOM,
                rightMeta: META_LIBRARY_TOP,
                hasSecond: true,
                detached: false,
            };
        case "graveyard":
            return {
                leftMeta: META_GRAVEYARD,
                rightMeta: META_LIBRARY_TOP,
                hasSecond: true,
                detached: true,
            };
        case "none":
            return {
                leftMeta: null,
                rightMeta: META_LIBRARY_TOP,
                hasSecond: false,
                detached: false,
            };
    }
}

export default function LibraryOrderPicker({
    lookedAt,
    destination,
    prompt,
    submitting,
    distribute,
    putBack,
    onConfirm,
}: {
    lookedAt: LookedAtCard[];
    destination: LibraryDestination;
    prompt: string;
    submitting: boolean;
    /** `look-distribute` mode (Impulse / Stock Up): the RIGHT zone is the HAND
     *  (up to `keep` cards), the LEFT zone the ordered bottom. Omit for the
     *  scry/surveil/ponder order-top modes. `min` (default = `keep`) is the
     *  floor: for an OPTIONAL "you may" dig (Narset, min 0) the player can
     *  submit with fewer than `keep` in hand. `eligibleIds`, when present,
     *  restricts which looked-at cards may enter the HAND zone (Narset's
     *  "noncreature, nonland" filter) — a non-eligible card is bounced back to
     *  the BOTTOM if dragged onto the hand side. `categories` (issue #1364,
     *  Atraxa) is the CATEGORIZED keep: at most one card per category and each
     *  card claimable by only one of them, so a drag onto the hand that would
     *  leave no injective card → category assignment is bounced back to the
     *  BOTTOM. Legality runs through the shared `categorizedPick` matching the
     *  server validates the submit with, never a re-derived client rule. */
    distribute?: {
        keep: number;
        min?: number;
        eligibleIds?: string[];
        categories?: PickCategory[];
    };
    /** `putBack` mode (Brainstorm, CR 401.4): the LEFT zone is the HAND (source
     *  pool), the RIGHT zone the TOP OF LIBRARY — pull up to `keep` cards onto
     *  the top and order them (right = topmost). The top zone is HARD-CAPPED at
     *  `keep`; leftover hand cards move nowhere (`onConfirm`'s second array is
     *  ignored by the caller). `min` (default = `keep`, the exact Brainstorm
     *  shape) is the FLOOR: a RANGED put-back (Sylvan Library's `rangedTopdeck`,
     *  CR 118.4 — put back or pay life per kept card, issue #1691) passes
     *  `min` 0 so the player may put none back, or the CR 119.4 floor when they
     *  cannot pay for every kept card. Mutually exclusive with `distribute`. */
    putBack?: { keep: number; min?: number };
    /** `topTopmostFirst` = kept cards, topmost first (or the HAND cards in
     *  `distribute` mode / the cards put on top in `putBack` mode); `secondIds`
     *  = the rest, ordered, sent to the destination (empty for `none` and
     *  ignored by the `putBack` caller). Both are INSTANCE ids. */
    onConfirm: (topTopmostFirst: string[], secondIds: string[]) => void;
}) {
    // Issue #315 — collapse this full-screen picker to the board indicator so
    // the chooser can inspect the battlefield mid-order, then restore. Hidden
    // via `display:none` (not unmounted) so the drag-ordering state survives a
    // minimize/restore cycle; the Pending Choice (CR 608.2) stays active.
    const { isMinimized, minimize } = useMinimizedChoice();

    // `distribute` mode's LEFT zone follows `destination` (issue #1101,
    // Reviving Vapors): `library-bottom` (Impulse / Stock Up / Narset) reads
    // BOTTOM, fused with the library fan like scry's own bottom leg;
    // `graveyard` reads GRAVEYARD and detaches, mirroring Surveil's own
    // graveyard leg in the non-distribute `chromeFor` branch below.
    const chrome = distribute
        ? {
              leftMeta:
                  destination === "graveyard"
                      ? META_GRAVEYARD
                      : META_LIBRARY_BOTTOM,
              rightMeta: META_HAND,
              hasSecond: true,
              detached: destination === "graveyard",
          }
        : putBack
          ? {
                leftMeta: META_HAND_POOL,
                rightMeta: META_LIBRARY_TOP,
                hasSecond: true,
                // Detached so the HAND pool reads as its own zone, set apart
                // from the library with the wider gap (GAP_DETACHED).
                detached: true,
            }
          : chromeFor(destination);
    const { leftMeta, rightMeta, hasSecond, detached } = chrome;
    // The distribute HAND (right zone) is DETACHED from the library mock (QA
    // Narset): a real gap + an accent panel instead of the fused under-deck
    // tuck, so "drag right = into your hand" never reads as "top of library".
    const detachRight = distribute !== undefined;

    // Both `distribute` and `putBack` are "pool" modes: every card starts in the
    // LEFT (`second`) zone and the player pulls exactly `keep` into the RIGHT
    // (`top`) zone. `putBack` additionally HARD-CAPS the top zone at `keep`.
    const poolMode = distribute !== undefined || putBack !== undefined;
    const keep = distribute?.keep ?? putBack?.keep;
    const topCap = putBack ? putBack.keep : undefined;
    // Optional-dig floor (Narset): the hand may hold as few as `min`. The
    // mandatory dig and Brainstorm's put-back keep the exact-`keep` requirement
    // (min === keep); a RANGED put-back (Sylvan Library, issue #1691) passes its
    // own `min` — 0 at a healthy life total, the CR 119.4 floor otherwise.
    const minKeep = distribute
        ? (distribute.min ?? distribute.keep)
        : (putBack?.min ?? keep);
    // Hand-eligible allow-list (Narset's "noncreature, nonland"): a card outside
    // it can never sit in the HAND (top) zone. Undefined = every card eligible.
    // The array ref is stable across renders (from the projected choice), so the
    // drop-resolution memo below keys on it directly and builds the Set inside.
    const eligibleIds = distribute?.eligibleIds;
    const categories = distribute?.categories;

    const defById = useMemo(
        () => Object.fromEntries(lookedAt.map((c) => [c.instanceId, c.defId])),
        [lookedAt]
    );

    // Committed order (instance ids), stored LEFT→RIGHT with rightmost = top of
    // library. In order-top mode `lookedAt` arrives top-to-bottom (index 0 =
    // current top) and is REVERSED into the fan so the current top card sits
    // rightmost — confirming without any drag reproduces the original order
    // exactly. In `distribute` mode every card starts in the BOTTOM (left) zone
    // in look order; the player pulls exactly `keep` up to the HAND (right)
    // zone. Dragging moves cards between the two arrays ON RELEASE only
    // (deferred commit).
    const [top, setTop] = useState<string[]>(() =>
        poolMode ? [] : [...lookedAt].reverse().map((c) => c.instanceId)
    );
    const [second, setSecond] = useState<string[]>(() =>
        poolMode ? lookedAt.map((c) => c.instanceId) : []
    );
    const [drag, setDrag] = useState<Drag | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const press = useRef<{
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
        grabOffsetX: number;
        active: boolean;
    } | null>(null);

    const localX = useCallback((clientX: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        return clientX - (rect?.left ?? 0);
    }, []);

    // ---- Live drop resolution (pure; recomputed each render while dragging) ----
    const view = useMemo(() => {
        if (!drag) {
            const layout = computeLayout(
                second.length,
                top.length,
                hasSecond,
                detached,
                detachRight
            );
            const place = new Map<string, { x: number; z: number }>();
            second.forEach((id, i) =>
                place.set(id, { x: layout.center("second", i), z: 10 + i })
            );
            top.forEach((id, i) =>
                place.set(id, { x: layout.center("top", i), z: 200 + i })
            );
            return {
                layout,
                place,
                dragX: 0,
                _commit: null as null | {
                    destZone: Zone;
                    dropIndex: number;
                },
            };
        }

        const top0 = top.filter((id) => id !== drag.id);
        const second0 = second.filter((id) => id !== drag.id);

        const hit = computeLayout(
            second0.length,
            top0.length,
            hasSecond,
            detached,
            detachRight
        );
        let destZone: Zone =
            hasSecond && drag.pointerX < hit.libCenter ? "second" : "top";
        // putBack cap (CR 401.4, exactly `keep` on top): the top zone holds at
        // most `topCap` cards. A HAND→top drag into an already-full top is
        // rejected (the card stays in HAND); a within-top reorder still works
        // because `top0` excludes the dragged card, so its length is under cap.
        if (
            topCap !== undefined &&
            destZone === "top" &&
            top0.length >= topCap
        ) {
            destZone = "second";
        }
        // Hand-eligibility (Narset): a non-eligible card dragged onto the HAND
        // (top) side is bounced back to the BOTTOM — it can only be bottomed.
        if (
            destZone === "top" &&
            eligibleIds !== undefined &&
            !eligibleIds.includes(drag.id)
        ) {
            destZone = "second";
        }
        // Categorized keep (Atraxa, issue #1364): a card whose addition would
        // leave the hand pile unmatchable (a second creature with nothing else
        // to seat it) is bounced back to the BOTTOM. `top0` already excludes
        // the dragged card, so a within-hand reorder is never blocked.
        if (
            destZone === "top" &&
            categories !== undefined &&
            !canAddCategorizedPick(categories, top0, drag.id)
        ) {
            destZone = "second";
        }
        const destArr = destZone === "second" ? second0 : top0;
        const dropIndex = insertionIndex(
            hit,
            destZone,
            destArr.length,
            drag.pointerX
        );

        const nextTop = [...top0];
        const nextSecond = [...second0];
        (destZone === "second" ? nextSecond : nextTop).splice(
            dropIndex,
            0,
            drag.id
        );

        const layout = computeLayout(
            nextSecond.length,
            nextTop.length,
            hasSecond,
            detached,
            detachRight
        );
        const place = new Map<string, { x: number; z: number }>();
        nextSecond.forEach((id, i) =>
            place.set(id, { x: layout.center("second", i), z: 10 + i })
        );
        nextTop.forEach((id, i) =>
            place.set(id, { x: layout.center("top", i), z: 200 + i })
        );

        const dragX = clamp(
            drag.pointerX - drag.grabOffsetX,
            CARD_W / 2,
            layout.stripW - CARD_W / 2
        );

        return {
            layout,
            place,
            dragX,
            _commit: { destZone, dropIndex } as null | {
                destZone: Zone;
                dropIndex: number;
            },
        };
    }, [
        drag,
        top,
        second,
        hasSecond,
        detached,
        detachRight,
        topCap,
        eligibleIds,
        categories,
    ]);

    // ---- Gesture (mirrors the hand's activation feel; no cast branch) ----
    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, id: string) => {
            if (e.button !== 0 || submitting) return;
            const zone = top.includes(id) ? "top" : "second";
            const idx = (zone === "top" ? top : second).indexOf(id);
            const layout = computeLayout(
                second.length,
                top.length,
                hasSecond,
                detached,
                detachRight
            );
            const center = layout.center(zone, idx);
            press.current = {
                id,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                grabOffsetX: localX(e.clientX) - center,
                active: false,
            };
        },
        [top, second, hasSecond, detached, detachRight, localX, submitting]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const p = press.current;
            if (!p) return;
            if (!p.active) {
                if (
                    Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <
                    DRAG_START_PX
                )
                    return;
                p.active = true;
                e.currentTarget.setPointerCapture(p.pointerId);
            }
            setDrag({
                id: p.id,
                pointerX: localX(e.clientX),
                grabOffsetX: p.grabOffsetX,
            });
        },
        [localX]
    );

    const commit = useCallback(() => {
        const p = press.current;
        press.current = null;
        if (!p || !p.active) {
            setDrag(null);
            return;
        }
        const c = view._commit;
        setDrag(null);
        if (!c) return;
        const top0 = top.filter((id) => id !== p.id);
        const second0 = second.filter((id) => id !== p.id);
        if (c.destZone === "second") {
            second0.splice(c.dropIndex, 0, p.id);
        } else {
            top0.splice(c.dropIndex, 0, p.id);
        }
        setTop(top0);
        setSecond(second0);
    }, [view, top, second]);

    const onPointerUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (
                press.current &&
                e.currentTarget.hasPointerCapture(press.current.pointerId)
            ) {
                e.currentTarget.releasePointerCapture(press.current.pointerId);
            }
            commit();
        },
        [commit]
    );

    const onLostPointerCapture = useCallback(() => {
        if (press.current) commit();
    }, [commit]);

    // `distribute` / `putBack` require the HAND (right) zone to hold between
    // `minKeep` and `keep` cards before Done is legal (the engine enforces the
    // same count; gating here avoids a rejected submit). A mandatory dig and
    // `putBack` pin min === keep (exact); an optional dig (Narset) sets minKeep 0
    // so the player may decline. order-top modes accept any split.
    const confirmDisabled =
        submitting ||
        (keep !== undefined
            ? top.length > keep || top.length < (minKeep ?? keep)
            : false);

    const handleConfirm = () => {
        if (confirmDisabled) return;
        // Rightmost = topmost, so reverse the left→right `top` array.
        const topTopmostFirst = [...top].reverse();
        onConfirm(topTopmostFirst, hasSecond ? second : []);
    };

    const containerH = CARD_H + LIFT;

    return (
        <div
            className={`fixed inset-0 z-modal items-center justify-center bg-scrim p-6 ${
                isMinimized ? "hidden" : "flex"
            }`}
        >
            <div className="flex max-w-full flex-col gap-4">
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={minimize}
                        aria-label="Minimize choice dialog"
                        title="Minimize — inspect the battlefield"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-accent bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
                    >
                        <Minus className="h-4 w-4" />
                    </button>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                    {prompt}
                </p>

                {/* Zone labels ABOVE the strip (phase 2, winner A): every zone
                    declares name + ordering hint + icon before you drag. The
                    right zone is the accent one when it's YOURS (hand). */}
                <div className="flex items-start justify-between gap-4 px-2">
                    {leftMeta ? (
                        <ZoneLabel meta={leftMeta} accent={false} />
                    ) : (
                        <span />
                    )}
                    <ZoneLabel meta={rightMeta} accent={detachRight} />
                </div>

                {/* overflow-hidden (not auto): a dragged card lifted to the edge
                    must never spawn a scrollbar. Horizontal padding gives the
                    scaled edge cards + their drop-shadow room to breathe. */}
                <div className="flex justify-center overflow-hidden px-10 py-8">
                    <div
                        ref={containerRef}
                        className="relative shrink-0 touch-none select-none"
                        style={{
                            width: view.layout.stripW,
                            height: containerH,
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onLostPointerCapture={onLostPointerCapture}
                    >
                        {detached && (
                            <div
                                className="absolute rounded-xl border-2 border-dashed border-secondary-accent/60 bg-secondary-accent/5"
                                style={{
                                    left: view.layout.secondStart - 10,
                                    top: LIFT - 6,
                                    width: view.layout.secondSlotW + 20,
                                    height: CARD_H + 12,
                                    zIndex: 0,
                                }}
                            />
                        )}
                        {/* The distribute HAND zone's accent panel (QA Narset):
                            a solid accent frame set apart from the library —
                            "yours", never confusable with the top of it. */}
                        {detachRight && (
                            <div
                                className="absolute rounded-xl border border-accent/60 bg-accent-soft/10"
                                style={{
                                    left: view.layout.topStart - 10,
                                    top: LIFT - 6,
                                    width:
                                        Math.max(
                                            (top.length - 1) * REVEAL + CARD_W,
                                            CARD_W
                                        ) + 20,
                                    height: CARD_H + 12,
                                    zIndex: 0,
                                }}
                            />
                        )}

                        <div
                            className="absolute"
                            style={{
                                left: view.layout.libStart,
                                top: LIFT,
                                width: DECK_W,
                                height: DECK_H,
                                zIndex: 100,
                            }}
                        >
                            <DeckMock />
                        </div>

                        {lookedAt.map((c) => {
                            const p = view.place.get(c.instanceId);
                            const isDrag = drag?.id === c.instanceId;
                            const x = isDrag ? view.dragX : (p?.x ?? 0);
                            const z = isDrag ? 999 : (p?.z ?? 1);
                            return (
                                <div
                                    key={c.instanceId}
                                    className={
                                        submitting
                                            ? "absolute"
                                            : "absolute cursor-grab active:cursor-grabbing"
                                    }
                                    onPointerDown={(e) =>
                                        onPointerDown(e, c.instanceId)
                                    }
                                    style={{
                                        left: 0,
                                        top: LIFT,
                                        width: CARD_W,
                                        zIndex: z,
                                        transform: `translate(${x - CARD_W / 2}px, ${
                                            isDrag ? -LIFT : 0
                                        }px) scale(${isDrag ? 1.05 : 1})`,
                                        transition: isDrag
                                            ? "none"
                                            : `transform ${SLOT_SPRING.cssDuration} ${SLOT_SPRING.cssEasing}`,
                                        filter: isDrag
                                            ? "drop-shadow(0 12px 18px rgba(0,0,0,0.5))"
                                            : undefined,
                                    }}
                                >
                                    <OrderCard defId={defById[c.instanceId]} />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex justify-center">
                    <button
                        type="button"
                        disabled={confirmDisabled}
                        onClick={handleConfirm}
                        className="rounded-full border border-accent bg-accent/10 px-10 py-2 font-beleren text-base tracking-wide text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
