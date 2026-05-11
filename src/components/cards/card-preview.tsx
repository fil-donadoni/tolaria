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
    capitalizeKeyword,
    formatTypeLine,
    getDisplayAbilities,
    manaCostToString,
    type AbilityDisplayState,
} from "~/lib/card-utils";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { formatOracleText } from "~/lib/oracle-text";
import { GameContext } from "~/hooks/useGameContext";
import type { CardInstance } from "~/types/game";

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

const KEYWORD_STATE_CLASS: Record<AbilityDisplayState, string> = {
    native: "text-zinc-100",
    granted: "text-emerald-400",
    lost: "text-zinc-400 line-through opacity-70",
};

function KeywordRow({
    name,
    state,
}: {
    name: string;
    state: AbilityDisplayState;
}) {
    const prefix = state === "granted" ? "[+] " : "";
    return (
        <div className={KEYWORD_STATE_CLASS[state]}>
            {prefix}
            {capitalizeKeyword(name)}
        </div>
    );
}

function AbilityRow({
    text,
    state,
}: {
    text: string;
    state: "native" | "granted";
}) {
    const cls = state === "granted" ? "text-emerald-400" : "text-zinc-100";
    const prefix = state === "granted" ? "[+] " : "";
    return (
        <div className={cls}>
            {prefix}
            {formatOracleText(text)}
        </div>
    );
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

    const openZoom = useCallback(() => {
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

    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current !== null) {
                clearTimeout(hoverTimeoutRef.current);
            }
        };
    }, []);

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

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "z" && isHovered.current) {
                openZoom();
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === "z") {
                setShowZoom(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [openZoom]);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            openZoom();
            const onUp = () => {
                setShowZoom(false);
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
    const isCreatureCard = types.includes("Creature");
    const isSpellCard = types.includes("Instant") || types.includes("Sorcery");
    const hasStructuredAbilities =
        (def?.staticAbilities?.length ?? 0) > 0 ||
        (def?.activatedAbilities?.length ?? 0) > 0 ||
        (def?.triggeredAbilities?.length ?? 0) > 0;
    const showOracleText =
        !!def?.oracleText && (isSpellCard || !hasStructuredAbilities);
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
    const hasBody =
        abilities.keywords.length > 0 ||
        abilities.activated.length > 0 ||
        abilities.triggered.length > 0;
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

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            onMouseEnter={() => {
                isHovered.current = true;
                clearHoverTimeout();
                hoverTimeoutRef.current = setTimeout(() => {
                    if (!isHovered.current) return;
                    openZoom();
                }, HOVER_DELAY_MS);
            }}
            onMouseLeave={() => {
                isHovered.current = false;
                clearHoverTimeout();
                setShowZoom(false);
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
        >
            {children}
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
                                        className="w-full h-full block"
                                        alt={cardName}
                                        style={{ objectFit: "cover" }}
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
                                <div className="border-t border-zinc-700 pt-2 space-y-1.5">
                                    {abilities.keywords.length > 0 && (
                                        <div className="space-y-0.5">
                                            {abilities.keywords.map((k, i) => (
                                                <KeywordRow
                                                    key={`kw-${i}-${k.name}`}
                                                    name={k.name}
                                                    state={k.state}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {abilities.activated.map((a, i) => (
                                        <AbilityRow
                                            key={`act-${i}-${a.id}`}
                                            text={a.oracleText}
                                            state={a.state}
                                        />
                                    ))}
                                    {abilities.triggered.map((t, i) => (
                                        <AbilityRow
                                            key={`tr-${i}-${t.id}`}
                                            text={t.oracleText}
                                            state="native"
                                        />
                                    ))}
                                </div>
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
