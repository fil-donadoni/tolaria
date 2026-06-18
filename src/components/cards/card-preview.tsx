import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tryGetCardById } from "@convex/cards";
import {
    ART_CROP_RATIO,
    getArtCropImageUrl,
    resolveCardImageId,
} from "~/lib/images";
import CardImageLoader from "./card-image-loader";
import TokenPlaceholder from "./token-placeholder";
import {
    formatTypeLine,
    getDisplayAbilities,
    manaCostToString,
    resolvePreviewAbilities,
} from "~/lib/card-utils";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { formatOracleText } from "~/lib/oracle-text";
import { GameContext } from "~/hooks/useGameContext";
import { useLongPress } from "~/hooks/useLongPress";
import type { CardInstance } from "~/types/game";
import { getColorOverrideDisplay } from "~/lib/color-override";
import CardPreviewAbilities from "./card-preview-abilities";
import CardPreviewCounters from "./card-preview-counters";
import { getCounterDisplays } from "~/lib/counters";
import { releasePreview, requestOpenPreview } from "./card-preview-singleton";

const ZOOM_WIDTH = 128 * 2;
const GAP = 8;
const VIEWPORT_PAD = 8;
const HOVER_DELAY_MS = 300;

// Clamp the zoom panel so it sits next to the anchored card without ever
// overflowing the viewport. Vertical height varies with oracle text length, so
// it is measured post-mount instead of assuming a fixed aspect.
function clampZoomPosition(
    cardRect: DOMRect,
    zoomWidth: number,
    zoomHeight: number
): { top: number; left: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    const fitsRight = cardRect.right + GAP + zoomWidth <= vw - VIEWPORT_PAD;
    const fitsLeft = cardRect.left - GAP - zoomWidth >= VIEWPORT_PAD;
    if (fitsRight) {
        left = cardRect.right + GAP;
    } else if (fitsLeft) {
        left = cardRect.left - GAP - zoomWidth;
    } else {
        const gapRight = vw - cardRect.right;
        const gapLeft = cardRect.left;
        left =
            gapRight >= gapLeft
                ? cardRect.right + GAP
                : cardRect.left - GAP - zoomWidth;
    }
    left = Math.max(
        VIEWPORT_PAD,
        Math.min(left, vw - VIEWPORT_PAD - zoomWidth)
    );

    const cardCenterY = cardRect.top + cardRect.height / 2;
    let top = cardCenterY - zoomHeight / 2;
    const maxTop = vh - VIEWPORT_PAD - zoomHeight;
    if (maxTop < VIEWPORT_PAD) {
        top = VIEWPORT_PAD;
    } else if (top < VIEWPORT_PAD) {
        top = VIEWPORT_PAD;
    } else if (top > maxTop) {
        top = maxTop;
    }

    return { top, left };
}

type CardPreviewProps = {
    cardId: string;
    cardName: string;
    cardInstance?: CardInstance;
    children: React.ReactNode;
};

export default function CardPreview({
    cardId,
    cardName,
    cardInstance,
    children,
}: CardPreviewProps) {
    const [showZoom, setShowZoom] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [measured, setMeasured] = useState(false);
    const [zoomImgLoaded, setZoomImgLoaded] = useState(false);
    const isHovered = useRef(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef<HTMLDivElement>(null);

    const longPress = useLongPress({});
    // Preview is visible during the peek window and once locked; only `idle`
    // and `pressing` keep it hidden (ADR 0009 peek/lock).
    const showOverlay =
        longPress.phase === "longPressed" || longPress.phase === "locked";
    const sawTouchRef = useRef(false);

    // Latest closePreview, read by the singleton from a stable identity so
    // openZoom/cleanup don't need closePreview in their dep arrays.
    const closeRef = useRef<() => void>(() => {});

    const openZoom = useCallback(() => {
        requestOpenPreview(closeRef.current);
        setMeasured(false);
        setZoomImgLoaded(false);
        setShowZoom(true);
    }, []);

    const recomputePosition = useCallback(() => {
        const anchor = containerRef.current;
        const zoom = zoomRef.current;
        if (!anchor || !zoom) return;
        const cardRect = anchor.getBoundingClientRect();
        const zoomRect = zoom.getBoundingClientRect();
        setPosition(
            clampZoomPosition(cardRect, zoomRect.width, zoomRect.height)
        );
        setMeasured(true);
    }, []);

    // Callback ref measures synchronously when the zoom div mounts, so the
    // first paint already has the correct (clamped) position. Variable-height
    // oracle text never overflows the viewport.
    const zoomCallbackRef = useCallback((node: HTMLDivElement | null) => {
        zoomRef.current = node;
        if (!node) return;
        const anchor = containerRef.current;
        if (!anchor) return;
        const cardRect = anchor.getBoundingClientRect();
        const zoomRect = node.getBoundingClientRect();
        setPosition(
            clampZoomPosition(cardRect, zoomRect.width, zoomRect.height)
        );
        setMeasured(true);
    }, []);

    const clearHoverTimeout = useCallback(() => {
        if (hoverTimeoutRef.current !== null) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    }, []);

    // While hovered, a document-level pointer watcher closes the preview the
    // instant the pointer leaves the card's CURRENT (tilt-shifted) rect. This is
    // the reliable close signal: a card under a live 3D tilt (board-next
    // CardTilt3D) rewrites its transform on every move, so the element's own
    // mouseleave fires spuriously (pointer still inside the moved rect) AND, once
    // ignored, never fires again — leaving stale previews that overlap. Sampling
    // the live geometry instead closes exactly when the cursor is truly outside.
    const exitTeardownRef = useRef<(() => void) | null>(null);

    const stopExitWatch = useCallback(() => {
        exitTeardownRef.current?.();
        exitTeardownRef.current = null;
    }, []);

    const closePreview = useCallback(() => {
        isHovered.current = false;
        clearHoverTimeout();
        setShowZoom(false);
        stopExitWatch();
        releasePreview(closeRef.current);
    }, [clearHoverTimeout, stopExitWatch]);
    useEffect(() => {
        closeRef.current = closePreview;
    }, [closePreview]);

    const startExitWatch = useCallback(() => {
        stopExitWatch();
        const onMove = (e: PointerEvent) => {
            const r = containerRef.current?.getBoundingClientRect();
            if (
                !r ||
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
            ) {
                closePreview();
            }
        };
        // The pointer can leave the card WITHOUT a sampled move landing outside
        // the rect: the cursor exits the window, the tab loses focus, or the
        // tilt churn swallows the mouseleave. These backstops guarantee the
        // preview never gets stuck open in those gaps.
        const onWindowLeave = () => closePreview();
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerleave", onWindowLeave);
        window.addEventListener("blur", onWindowLeave);
        exitTeardownRef.current = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerleave", onWindowLeave);
            window.removeEventListener("blur", onWindowLeave);
        };
    }, [closePreview, stopExitWatch]);

    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current !== null) {
                clearTimeout(hoverTimeoutRef.current);
            }
            stopExitWatch();
            releasePreview(closeRef.current);
        };
    }, [stopExitWatch]);

    useEffect(() => {
        if (!showZoom) return;
        const handler = () => recomputePosition();
        window.addEventListener("resize", handler);
        window.addEventListener("scroll", handler, true);
        return () => {
            window.removeEventListener("resize", handler);
            window.removeEventListener("scroll", handler, true);
        };
    }, [showZoom, recomputePosition]);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            openZoom();
            const onUp = () => {
                closeRef.current();
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mouseup", onUp);
        },
        [openZoom]
    );

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const def = tryGetCardById(cardId);
    const abilities = def
        ? getDisplayAbilities(cardId, cardInstance)
        : { keywords: [], activated: [], triggered: [] };
    const manaCost = manaCostToString(def?.manaCost);
    const typeLine = formatTypeLine(
        cardInstance?.types ?? def?.types,
        cardInstance?.subtypes ?? def?.subtypes,
        def?.supertypes
    );
    const types = cardInstance?.types ?? def?.types ?? [];
    const subtypes = cardInstance?.subtypes ?? def?.subtypes ?? [];
    const isCreatureCard = types.includes("Creature");
    const isSpellCard = types.includes("Instant") || types.includes("Sorcery");
    // CR 303.4 auras grant clauses to their host via `staticEffects`
    // (keyword-grant / pt-buff). That static grant text never lands on the
    // aura's own `staticAbilities`, so the structured ability view would
    // hide it from the preview. Show the printed Oracle text for auras
    // instead — it always covers the static + activated + triggered rules
    // collectively, and the structured render is suppressed below so we
    // don't double-print the activated/triggered lines.
    const isAura = subtypes.includes("Aura");
    const hasStructuredAbilities =
        (def?.staticAbilities?.length ?? 0) > 0 ||
        (def?.activatedAbilities?.length ?? 0) > 0 ||
        (def?.triggeredAbilities?.length ?? 0) > 0;
    // staticEffects (pt-cda, pt-buff, keyword-grant, etc.) are not rendered
    // by the structured abilities view — their printed text only lives in
    // oracleText. Force oracleText display when the card carries any so
    // mixed cards like Nightmare ("Flying" keyword + Swamps-count CDA) keep
    // the CDA clause visible. The structured render is suppressed below to
    // avoid double-printing the keywords already covered by Oracle text.
    const hasStaticEffectText = (def?.staticEffects?.length ?? 0) > 0;
    const showOracleText =
        !!def?.oracleText &&
        (isSpellCard ||
            isAura ||
            !hasStructuredAbilities ||
            hasStaticEffectText);
    const oracleParagraphs = showOracleText
        ? def!.oracleText!.split("\n").filter((p) => p.length > 0)
        : null;
    const basePower = def?.power;
    const baseToughness = def?.toughness;
    const gameCtx = useContext(GameContext);
    // Effective P/T (CR 611, 613 — layer 7c static buffs + counters) only
    // computable when the preview is mounted under a game context with the
    // full battlefield. Outside (deck builder), fall back to printed P/T.
    const effPower =
        cardInstance && gameCtx
            ? effectivePower(gameCtx.allPlayers, cardInstance)
            : (cardInstance?.power ?? basePower);
    const effToughness =
        cardInstance && gameCtx
            ? effectiveToughness(gameCtx.allPlayers, cardInstance)
            : (cardInstance?.toughness ?? baseToughness);
    const ptModified =
        basePower !== undefined &&
        baseToughness !== undefined &&
        (effPower !== basePower || effToughness !== baseToughness);
    const hasPT =
        isCreatureCard &&
        (effPower !== undefined || effToughness !== undefined);
    // When Oracle text is shown it covers native abilities; only runtime-grant
    // deltas (granted/lost keywords, granted activated abilities) need to be
    // surfaced alongside it (#156). When it isn't, render the full set.
    const bodyAbilities = resolvePreviewAbilities(abilities, showOracleText);
    const hasBody =
        bodyAbilities.keywords.length > 0 ||
        bodyAbilities.activated.length > 0 ||
        bodyAbilities.triggered.length > 0;
    const displayName = def?.name ?? cardName;
    // Tokens (CR 111) without a printed art id render an in-app placeholder
    // in the zoom panel — Scryfall has no entry for synthesized `token:` ids
    // and would 404. `resolveCardImageId` returns null in that case.
    const imageId = resolveCardImageId(cardId);
    const imageSrc = imageId ? getArtCropImageUrl(imageId) : null;
    const showOwner =
        !!cardInstance &&
        !!gameCtx &&
        cardInstance.zone === "battlefield" &&
        cardInstance.controllerId !== gameCtx.playerId;
    const ownerName = showOwner
        ? (gameCtx.allPlayers.find((p) => p.id === cardInstance.ownerId)
              ?.name ?? null)
        : null;

    const colorDisplay = cardInstance?.colorOverride?.length
        ? getColorOverrideDisplay(cardInstance.colorOverride)
        : null;

    const counterDisplays = cardInstance
        ? getCounterDisplays(cardInstance)
        : [];

    const dismissOverlay = useCallback(() => {
        longPress.dismiss();
    }, [longPress]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={longPress.scaleStyle}
            onMouseEnter={() => {
                if (sawTouchRef.current) return;
                // Already hovering (a re-enter from tilt-transform churn) — do
                // NOT restart the open timer, or the churn would forever defer
                // the zoom past HOVER_DELAY_MS.
                if (isHovered.current) return;
                isHovered.current = true;
                clearHoverTimeout();
                hoverTimeoutRef.current = setTimeout(() => {
                    if (!isHovered.current) return;
                    openZoom();
                }, HOVER_DELAY_MS);
                // The document watcher owns the close — it samples live geometry
                // and is immune to the tilt's spurious mouseleave churn.
                startExitWatch();
            }}
            onMouseLeave={(e) => {
                if (sawTouchRef.current) return;
                // Backstop for the pointer leaving the window (no further
                // pointermove for the watcher to sample): close only when the
                // pointer is genuinely outside the card's current rect; otherwise
                // a spurious tilt-churn leave is left to the watcher.
                const r = containerRef.current?.getBoundingClientRect();
                if (
                    r &&
                    e.clientX >= r.left &&
                    e.clientX <= r.right &&
                    e.clientY >= r.top &&
                    e.clientY <= r.bottom
                ) {
                    return;
                }
                closePreview();
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            {...longPress.handlers}
            onTouchStart={(e) => {
                sawTouchRef.current = true;
                longPress.handlers.onTouchStart(e);
            }}
        >
            {children}
            {showOverlay &&
                createPortal(
                    <div
                        className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => {
                            e.preventDefault();
                            dismissOverlay();
                        }}
                        onClick={dismissOverlay}
                    >
                        <div
                            className="flex flex-col rounded-2xl shadow-2xl bg-zinc-900/95 overflow-hidden max-h-[90vh] max-w-[90vw]"
                            style={{ width: ZOOM_WIDTH * 1.5 }}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className="relative w-full"
                                style={{ aspectRatio: ART_CROP_RATIO }}
                            >
                                {imageSrc ? (
                                    <img
                                        src={imageSrc}
                                        className="w-full h-full block select-none"
                                        alt={cardName}
                                        style={{
                                            objectFit: "cover",
                                            WebkitTouchCallout: "none",
                                        }}
                                    />
                                ) : (
                                    <TokenPlaceholder
                                        name={displayName}
                                        types={types}
                                        subtypes={
                                            cardInstance?.subtypes ??
                                            def?.subtypes ??
                                            []
                                        }
                                        power={effPower ?? basePower}
                                        toughness={
                                            effToughness ?? baseToughness
                                        }
                                        staticAbilities={
                                            cardInstance?.staticAbilities ??
                                            def?.staticAbilities ??
                                            []
                                        }
                                    />
                                )}
                            </div>
                            <div className="p-4 text-sm text-white space-y-2 overflow-y-auto">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-semibold text-base">
                                        {displayName}
                                    </span>
                                    {manaCost && (
                                        <span className="shrink-0 text-base leading-none">
                                            {formatOracleText(manaCost)}
                                        </span>
                                    )}
                                </div>
                                <div className="text-zinc-300">{typeLine}</div>
                                {oracleParagraphs && (
                                    <div className="border-t border-zinc-700 pt-2 space-y-1.5 text-zinc-100">
                                        {oracleParagraphs.map((p, i) => (
                                            <div key={`oracle-${i}`}>
                                                {formatOracleText(p)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {hasBody && (
                                    <CardPreviewAbilities
                                        abilities={bodyAbilities}
                                    />
                                )}
                                {hasPT && (
                                    <div className="text-right font-semibold text-base border-t border-zinc-700 pt-2 flex justify-end items-baseline gap-2">
                                        <span
                                            className={
                                                ptModified
                                                    ? "text-emerald-400"
                                                    : "text-white"
                                            }
                                        >
                                            {effPower ?? 0}/{effToughness ?? 0}
                                        </span>
                                        {ptModified && (
                                            <span className="text-red-400 text-sm font-normal">
                                                ({basePower}/{baseToughness})
                                            </span>
                                        )}
                                    </div>
                                )}
                                <CardPreviewCounters
                                    counters={counterDisplays}
                                />
                                {colorDisplay && (
                                    <div className="border-t border-zinc-700 pt-2 text-sm font-semibold text-[var(--color-accent-strong)]">
                                        Color: {colorDisplay.name}
                                    </div>
                                )}
                                {ownerName && (
                                    <div className="text-zinc-400 border-t pt-2 text-sm italic">
                                        Owner: {ownerName}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            {showZoom &&
                createPortal(
                    <div
                        ref={zoomCallbackRef}
                        className="pointer-events-none fixed z-100 flex flex-col rounded-2xl shadow-2xl bg-zinc-900/95 backdrop-blur-sm overflow-hidden"
                        style={{
                            top: position.top,
                            left: position.left,
                            width: ZOOM_WIDTH,
                            maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
                            opacity: measured ? 1 : 0,
                        }}
                    >
                        <div
                            className="relative w-full"
                            style={{ aspectRatio: ART_CROP_RATIO }}
                        >
                            {imageSrc ? (
                                <>
                                    <img
                                        src={imageSrc}
                                        className="w-full h-full block select-none"
                                        alt={cardName}
                                        style={{
                                            objectFit: "cover",
                                            WebkitTouchCallout: "none",
                                        }}
                                        onLoad={() => setZoomImgLoaded(true)}
                                        onError={() => setZoomImgLoaded(true)}
                                    />
                                    {!zoomImgLoaded && <CardImageLoader />}
                                </>
                            ) : (
                                <TokenPlaceholder
                                    name={displayName}
                                    types={types}
                                    subtypes={
                                        cardInstance?.subtypes ??
                                        def?.subtypes ??
                                        []
                                    }
                                    power={effPower ?? basePower}
                                    toughness={effToughness ?? baseToughness}
                                    staticAbilities={
                                        cardInstance?.staticAbilities ??
                                        def?.staticAbilities ??
                                        []
                                    }
                                />
                            )}
                        </div>
                        <div className="p-3 text-xs text-white space-y-2 overflow-y-auto">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="font-semibold truncate">
                                    {displayName}
                                </span>
                                {manaCost && (
                                    <span className="shrink-0 text-sm leading-none">
                                        {formatOracleText(manaCost)}
                                    </span>
                                )}
                            </div>
                            <div className="text-zinc-300">{typeLine}</div>
                            {oracleParagraphs && (
                                <div className="border-t border-zinc-700 pt-2 space-y-1.5 text-zinc-100">
                                    {oracleParagraphs.map((p, i) => (
                                        <div key={`oracle-${i}`}>
                                            {formatOracleText(p)}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {hasBody && (
                                <CardPreviewAbilities
                                    abilities={bodyAbilities}
                                />
                            )}
                            {hasPT && (
                                <div className="text-right font-semibold text-sm border-t border-zinc-700 pt-2 flex justify-end items-baseline gap-2">
                                    <span
                                        className={
                                            ptModified
                                                ? "text-emerald-400"
                                                : "text-white"
                                        }
                                    >
                                        {effPower ?? 0}/{effToughness ?? 0}
                                    </span>
                                    {ptModified && (
                                        <span className="text-red-400 text-xs font-normal">
                                            ({basePower}/{baseToughness})
                                        </span>
                                    )}
                                </div>
                            )}
                            <CardPreviewCounters counters={counterDisplays} />
                            {colorDisplay && (
                                <div className="border-t border-zinc-700 pt-2 text-xs font-semibold text-[var(--color-accent-strong)]">
                                    Color: {colorDisplay.name}
                                </div>
                            )}
                            {ownerName && (
                                <div className="text-zinc-400 border-t pt-2 text-xs italic">
                                    Owner: {ownerName}
                                </div>
                            )}
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    );
}
