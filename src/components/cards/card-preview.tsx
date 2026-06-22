import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tryGetCardById } from "@convex/cards";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import {
    formatTypeLine,
    getDisplayAbilities,
    manaCostToString,
    resolvePreviewAbilities,
} from "~/lib/card-utils";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { GameContext } from "~/hooks/useGameContext";
import { useLongPress } from "~/hooks/useLongPress";
import type { CardInstance } from "~/types/game";
import { getColorOverrideDisplay } from "~/lib/color-override";
import { getCounterDisplays } from "~/lib/counters";
import { releasePreview, requestOpenPreview } from "./card-preview-singleton";
import CardPreviewBody from "./card-preview-body";
import CardPreviewDock from "./card-preview-dock";

const OVERLAY_WIDTH = 128 * 2;
export const HOVER_DELAY_MS = 300;

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
    // Desktop hover preview (fixed center-left dock, #332). Mobile long-press
    // overlay is a separate surface (`showOverlay`) and is unaffected.
    const [showDock, setShowDock] = useState(false);
    const [dockImgLoaded, setDockImgLoaded] = useState(false);
    const isHovered = useRef(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const longPress = useLongPress({});
    // Preview is visible during the peek window and once locked; only `idle`
    // and `pressing` keep it hidden (ADR 0009 peek/lock).
    const showOverlay =
        longPress.phase === "longPressed" || longPress.phase === "locked";
    const sawTouchRef = useRef(false);

    // Latest closePreview, read by the singleton from a stable identity so
    // openDock/cleanup don't need closePreview in their dep arrays.
    const closeRef = useRef<() => void>(() => {});

    const openDock = useCallback(() => {
        requestOpenPreview(closeRef.current);
        setDockImgLoaded(false);
        setShowDock(true);
    }, []);

    const clearHoverTimeout = useCallback(() => {
        if (hoverTimeoutRef.current !== null) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    }, []);

    // While hovered, a document-level pointer watcher closes the preview the
    // instant the pointer leaves the card's CURRENT (tilt-shifted) rect. This is
    // the reliable close signal: a card under a live 3D tilt (board
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
        setShowDock(false);
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

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            openDock();
            const onUp = () => {
                closeRef.current();
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mouseup", onUp);
        },
        [openDock]
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
    // in the preview — Scryfall has no entry for synthesized `token:` ids
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

    // Shared content props for both preview surfaces (desktop dock + mobile
    // overlay) — same art + rules text, only the framing differs.
    const sharedBody = {
        cardName,
        displayName,
        imageSrc,
        types,
        subtypes,
        staticAbilities:
            cardInstance?.staticAbilities ?? def?.staticAbilities ?? [],
        manaCost,
        typeLine,
        oracleParagraphs,
        bodyAbilities,
        hasBody,
        hasPT,
        effPower,
        effToughness,
        basePower,
        baseToughness,
        ptModified,
        counterDisplays,
        colorName: colorDisplay?.name ?? null,
        ownerName,
    };

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={longPress.scaleStyle}
            onMouseEnter={() => {
                if (sawTouchRef.current) return;
                // Skip only when an open is already in flight (timer pending) or
                // the dock is already shown — this still defeats tilt-transform
                // re-enter churn (the timer is pending throughout the 300ms, so
                // churn enters are ignored). Do NOT gate on `isHovered` alone: a
                // mouseleave swallowed by a distorted/animating rect (e.g. a card
                // that grows on :hover) leaves `isHovered` stuck true with no
                // timer and no dock, which would suppress the next genuine hover
                // ("preview doesn't open on the first try").
                if (hoverTimeoutRef.current !== null || showDock) return;
                isHovered.current = true;
                clearHoverTimeout();
                hoverTimeoutRef.current = setTimeout(() => {
                    hoverTimeoutRef.current = null;
                    if (!isHovered.current) return;
                    openDock();
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
            {/* Mobile long-press centered overlay (ADR 0009) — UNCHANGED. */}
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
                            style={{ width: OVERLAY_WIDTH * 1.5 }}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <CardPreviewBody {...sharedBody} size="md" />
                        </div>
                    </div>,
                    document.body
                )}
            {/* Desktop hover preview — fixed center-left dock (#332). */}
            {showDock && (
                <CardPreviewDock
                    {...sharedBody}
                    size="sm"
                    imageLoaded={imageSrc ? dockImgLoaded : true}
                    onImageLoaded={() => setDockImgLoaded(true)}
                />
            )}
        </div>
    );
}
