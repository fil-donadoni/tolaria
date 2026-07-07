import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tryGetDefinition } from "@convex/cards";
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
import { useRightPressPreview } from "~/hooks/useRightPressPreview";
import type { CardInstance } from "~/types/game";
import { getColorOverrideDisplay } from "~/lib/color-override";
import { getCounterDisplays } from "~/lib/counters";
import { releasePreview, requestOpenPreview } from "./card-preview-singleton";
import CardPreviewBody from "./card-preview-body";
import CardPreviewDock from "./card-preview-dock";
import CardPreviewAnchored from "./card-preview-anchored";

const OVERLAY_WIDTH = 128 * 2;

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
    // Desktop preview is CLICK-driven (Arena model, #332). The RIGHT button
    // owns it — left-click stays a gameplay action. A quick right-click toggles
    // an anchored preview beside the card (board + lobby alike); holding the
    // right button past the threshold shows the big preview in the board's
    // right-column dock while held. Mobile long-press overlay (`showOverlay`) is
    // a separate, untouched surface.
    const gameCtx = useContext(GameContext);
    const [showAnchored, setShowAnchored] = useState(false);
    const [showZoomDock, setShowZoomDock] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);
    // Mirrors `showAnchored` for synchronous reads inside event handlers (the
    // quick-click toggle and the outside-click listener run before React has
    // committed the state update).
    const anchoredOpenRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const longPress = useLongPress({});
    // Preview is visible during the peek window and once locked; only `idle`
    // and `pressing` keep it hidden (ADR 0009 peek/lock).
    const showOverlay =
        longPress.phase === "longPressed" || longPress.phase === "locked";
    const sawTouchRef = useRef(false);

    // Latest close handle, read by the singleton (one-open-at-a-time) from a
    // stable identity so open/close don't need it in their dep arrays.
    const closeRef = useRef<() => void>(() => {});

    const closeAnchored = useCallback(() => {
        anchoredOpenRef.current = false;
        setShowAnchored(false);
        releasePreview(closeRef.current);
    }, []);
    useEffect(() => {
        closeRef.current = closeAnchored;
    }, [closeAnchored]);

    const openAnchored = useCallback(() => {
        requestOpenPreview(closeRef.current);
        anchoredOpenRef.current = true;
        setImgLoaded(false);
        setShowAnchored(true);
    }, []);

    // While the anchored preview is open, a document pointerdown that lands
    // OUTSIDE this card closes it, and Escape closes it. A pointerdown INSIDE
    // the card is ignored here so the quick-click toggle (below) can shut it —
    // otherwise a second right-click would close then immediately re-open.
    useEffect(() => {
        if (!showAnchored) return;
        const onPointerDown = (e: PointerEvent) => {
            const el = containerRef.current;
            if (el && e.target instanceof Node && el.contains(e.target)) return;
            closeAnchored();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeAnchored();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [showAnchored, closeAnchored]);

    // Release the singleton handle on unmount so a card that leaves the tree
    // (zone change, cleanup) never leaves a dangling open handle.
    useEffect(() => {
        return () => releasePreview(closeRef.current);
    }, []);

    const rightPress = useRightPressPreview({
        onQuickClick: () => {
            if (anchoredOpenRef.current) closeAnchored();
            else openAnchored();
        },
        // Hold-zoom is a board feature (needs the right-column dock). In the
        // lobby/deck-builder there is no dock, so the hold does nothing extra.
        onZoomStart: () => {
            if (!gameCtx) return;
            if (anchoredOpenRef.current) closeAnchored();
            setImgLoaded(false);
            setShowZoomDock(true);
        },
        onZoomEnd: () => setShowZoomDock(false),
    });

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const def = tryGetDefinition(cardId);
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
        notedMana: cardInstance?.notedMana,
        colorName: colorDisplay?.name ?? null,
        ownerName,
    };

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={longPress.scaleStyle}
            onMouseDown={(e) => {
                // Right-button preview is a desktop-only gesture; a touch device
                // (ghost mouse events) must never trigger it.
                if (sawTouchRef.current) return;
                rightPress.handlers.onMouseDown(e);
            }}
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
                            className="flex flex-col rounded-2xl shadow-2xl bg-surface overflow-hidden max-h-[90vh] max-w-[90vw]"
                            style={{ width: OVERLAY_WIDTH * 1.5 }}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <CardPreviewBody {...sharedBody} size="md" />
                        </div>
                    </div>,
                    document.body
                )}
            {/* Desktop hold-zoom (board only): the big preview in the fixed
                right-column dock while the right button is held. It supersedes
                the anchored preview — only one desktop surface shows at a time. */}
            {showZoomDock && gameCtx && (
                <CardPreviewDock
                    {...sharedBody}
                    size="md"
                    imageLoaded={imageSrc ? imgLoaded : true}
                    onImageLoaded={() => setImgLoaded(true)}
                />
            )}
            {/* Desktop quick-click preview: anchored beside the card, board and
                lobby alike, clamped fully inside the viewport. Hidden while the
                hold-zoom dock is up. */}
            {showAnchored && !showZoomDock && (
                <CardPreviewAnchored
                    {...sharedBody}
                    size="sm"
                    imageLoaded={imageSrc ? imgLoaded : true}
                    onImageLoaded={() => setImgLoaded(true)}
                    anchorRef={containerRef}
                />
            )}
        </div>
    );
}
