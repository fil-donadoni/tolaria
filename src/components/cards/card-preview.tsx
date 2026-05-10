import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tryGetCardById } from "@convex/cards";
import { ART_CROP_RATIO, getArtCropImageUrl, getImageUrl } from "~/lib/images";
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
const ZOOM_ASPECT = 7 / 5;
const ZOOM_HEIGHT = ZOOM_WIDTH * ZOOM_ASPECT;
const GAP = 8;
const VIEWPORT_PAD = 8;

function computeZoomPosition(cardRect: DOMRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    if (cardRect.right + GAP + ZOOM_WIDTH <= vw) {
        left = cardRect.right + GAP;
    } else {
        left = cardRect.left - GAP - ZOOM_WIDTH;
    }

    const cardCenterY = cardRect.top + cardRect.height / 2;
    let top = cardCenterY - ZOOM_HEIGHT / 2;

    if (top < VIEWPORT_PAD) {
        top = VIEWPORT_PAD;
    } else if (top + ZOOM_HEIGHT > vh - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - ZOOM_HEIGHT);
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
    const isHovered = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const updatePosition = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setPosition(computeZoomPosition(rect));
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "z" && isHovered.current) {
                updatePosition();
                setShowZoom(true);
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
    }, [updatePosition]);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            updatePosition();
            setShowZoom(true);
            const onUp = () => {
                setShowZoom(false);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mouseup", onUp);
        },
        [updatePosition]
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
    // Zoom variants per zone: hand hides the text panel (player should
    // only see the printed face), battlefield swaps the full card art for
    // the Scryfall art_crop (since the printed type/rules are already
    // implied by board state and the art crop reads better at zoom size).
    const isHand = cardInstance?.zone === "hand";
    const isBattlefield = cardInstance?.zone === "battlefield";
    const imageSrc = isBattlefield
        ? getArtCropImageUrl(cardId)
        : getImageUrl(cardId);
    const showTextPanel = !isHand;

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            onMouseEnter={() => {
                isHovered.current = true;
            }}
            onMouseLeave={() => {
                isHovered.current = false;
                setShowZoom(false);
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
        >
            {children}
            {showZoom &&
                createPortal(
                    <div
                        className="pointer-events-none fixed z-100 flex flex-col rounded-2xl shadow-2xl bg-zinc-900/95 backdrop-blur-sm overflow-hidden"
                        style={{
                            top: position.top,
                            left: position.left,
                            width: ZOOM_WIDTH,
                            maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
                        }}
                    >
                        <img
                            src={imageSrc}
                            className="w-full block"
                            alt={cardName}
                            style={
                                isBattlefield
                                    ? {
                                          aspectRatio: ART_CROP_RATIO,
                                          objectFit: "cover",
                                      }
                                    : undefined
                            }
                        />
                        {showTextPanel && (
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
                                {hasBody && (
                                    <div className="border-t border-zinc-700 pt-2 space-y-1.5">
                                        {abilities.keywords.length > 0 && (
                                            <div className="space-y-0.5">
                                                {abilities.keywords.map(
                                                    (k, i) => (
                                                        <KeywordRow
                                                            key={`kw-${i}-${k.name}`}
                                                            name={k.name}
                                                            state={k.state}
                                                        />
                                                    )
                                                )}
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
                            </div>
                        )}
                    </div>,
                    document.body
                )}
        </div>
    );
}
