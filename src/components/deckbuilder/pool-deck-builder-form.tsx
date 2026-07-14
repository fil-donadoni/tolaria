import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { validateDeck } from "@convex/formats";
import { poolFromLimitedPoolCards } from "@convex/limited/poolResolution";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import { computeDeckColors } from "~/lib/deckColors";
import {
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import type { DeckCard } from "~/types/game";
import CardImage from "~/components/cards/card-image";
import DeckPileArea from "~/components/lobby/deck-builder/deck-pile-area";
import DeckLegalityPanel from "~/components/lobby/deck-builder/deck-legality-panel";
import SaveDeckBar from "~/components/lobby/deck-builder/save-deck-bar";
import type {
    CardDragData,
    DropZoneId,
} from "~/components/lobby/deck-builder/dnd-types";
import { isBasicLandCardId, resolveBasicLandCardIds } from "./basicLands";
import PoolBasicLandsBar from "./pool-basic-lands-bar";

const CARD_BASE = "min(7.5rem, 17vw, 9dvh)";
const SAVE_DEBOUNCE_MS = 800;

interface WorkingDeck {
    name: string;
    cards: DeckCard[];
    sideboard: DeckCard[];
}

/** Every opened Pool card (basics included) starts in the Sideboard for a
 *  brand-new deck (PRD #1107 story 19, ADR 0054/0055 — "every unplayed Pool
 *  card kept in the uncapped Sideboard automatically"), empty Maindeck. This
 *  makes AC2 ("Main + Side always equals the Pool") true BY CONSTRUCTION: the
 *  only ops available on a Pool-sourced card are move-to-main / move-to-side,
 *  never delete. */
function defaultWorkingDeck(pool: readonly LimitedPoolCard[]): WorkingDeck {
    return {
        name: "Sealed Pool Deck",
        cards: [],
        sideboard: pool.map((c) => ({
            cardId: c.cardId,
            cardName: c.cardName,
        })),
    };
}

function applySplit(deck: WorkingDeck, split: SideboardSplit): WorkingDeck {
    return { ...deck, cards: split.cards, sideboard: split.sideboard };
}

interface PoolDeckBuilderFormProps {
    eventId: Id<"limitedEvents">;
    seatIndex: number;
    pool: readonly LimitedPoolCard[];
    existingDeck: UserLobbyDeck | null;
}

/**
 * The pool-scoped editor itself (issue #1111) — mounted by `PoolDeckBuilder`
 * only once the Seat/Pool/existing-deck data has resolved, so the working
 * deck seeds via a plain lazy `useState` initializer (mirrors the catalogue
 * `DeckBuilder`'s `initialDeck` prop) rather than an effect-driven `setState`.
 * Reuses the SAME pile rendering (`DeckPileArea`), legality panel
 * (`DeckLegalityPanel`) and save bar (`SaveDeckBar`) as the catalogue-wide
 * builder — only the "what can be added" surface (this seat's Pool + Basics,
 * not the full catalogue search) and the persistence path differ.
 */
export default function PoolDeckBuilderForm({
    eventId,
    seatIndex,
    pool,
    existingDeck,
}: PoolDeckBuilderFormProps) {
    const navigate = useNavigate();
    const { create, update } = useUserDeckMutations();

    const [deck, setDeck] = useState<WorkingDeck>(() =>
        existingDeck
            ? {
                  name: existingDeck.name,
                  cards: existingDeck.cards,
                  sideboard: existingDeck.sideboard ?? [],
              }
            : defaultWorkingDeck(pool)
    );
    const [saving, setSaving] = useState(false);

    const identityRef = useRef<string | null>(existingDeck?.userDeckId ?? null);
    const pendingRef = useRef<WorkingDeck | null>(null);
    const timerRef = useRef<number | null>(null);
    const inflightRef = useRef<Promise<unknown> | null>(null);

    const clearTimer = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const flush = useCallback(async () => {
        clearTimer();
        if (inflightRef.current) {
            try {
                await inflightRef.current;
            } catch {
                // surfaced by the originating call site
            }
        }
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        setSaving(true);
        const colors = computeDeckColors(pending.cards);
        const promise =
            identityRef.current === null
                ? create({
                      name: pending.name,
                      format: "limited",
                      colors,
                      cards: pending.cards,
                      sideboard: pending.sideboard,
                      limitedEventId: eventId,
                      limitedSeatId: String(seatIndex),
                  }).then((id) => id as string)
                : update({
                      id: identityRef.current as Id<"userDecks">,
                      patch: {
                          name: pending.name,
                          colors,
                          cards: pending.cards,
                          sideboard: pending.sideboard,
                      },
                  }).then(() => identityRef.current as string);
        inflightRef.current = promise;
        try {
            identityRef.current = await promise;
        } finally {
            inflightRef.current = null;
            setSaving(false);
        }
    }, [create, update, eventId, seatIndex]);

    const schedule = useCallback(
        (next: WorkingDeck) => {
            pendingRef.current = next;
            clearTimer();
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                void flush();
            }, SAVE_DEBOUNCE_MS);
        },
        [flush]
    );

    useEffect(() => {
        return () => {
            void flush();
        };
    }, [flush]);

    const updateDeck = useCallback(
        (updater: (d: WorkingDeck) => WorkingDeck) => {
            setDeck((current) => {
                const next = updater(current);
                schedule(next);
                return next;
            });
        },
        [schedule]
    );

    const handleSetName = useCallback(
        (name: string) => updateDeck((d) => ({ ...d, name })),
        [updateDeck]
    );

    // Main-zone click: a Basic is freely removed (unlimited add/remove); a
    // Pool-sourced card only ever moves back to the Sideboard — it can never
    // vanish (AC2).
    const handleMainClick = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                if (isBasicLandCardId(cardId)) {
                    const idx = d.cards.findIndex((c) => c.cardId === cardId);
                    if (idx < 0) return d;
                    const next = [...d.cards];
                    next.splice(idx, 1);
                    return { ...d, cards: next };
                }
                const split = moveToSideboard(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId
                );
                return applySplit(d, split);
            });
        },
        [updateDeck]
    );

    // Sideboard-zone click: always moves the card into the Maindeck (Basics
    // never start in the Sideboard, so every card offered here is
    // Pool-sourced).
    const handleSideClick = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                const split = moveToMaindeck(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId
                );
                return applySplit(d, split);
            });
        },
        [updateDeck]
    );

    const handleAddBasic = useCallback(
        (cardId: string, cardName: string) => {
            updateDeck((d) => ({
                ...d,
                cards: [...d.cards, { cardId, cardName }],
            }));
        },
        [updateDeck]
    );

    const handleDone = useCallback(async () => {
        await flush();
        void navigate({ to: "/limited/$eventId", params: { eventId } });
    }, [flush, navigate, eventId]);

    const basicCardIds = useMemo(() => resolveBasicLandCardIds(pool), [pool]);

    // Live legality (issue #1111): the same pure `validateDeck` the server
    // gates on at `createGame`, using the seat's own Pool as the injected
    // `ResolvePool` — no server round-trip needed since the Pool is already
    // in hand.
    const legality = useMemo(
        () =>
            validateDeck(
                {
                    cards: deck.cards,
                    sideboard: deck.sideboard,
                    limitedEventId: eventId,
                    limitedSeatId: String(seatIndex),
                },
                "limited",
                undefined,
                undefined,
                () => poolFromLimitedPoolCards(pool)
            ),
        [deck, eventId, seatIndex, pool]
    );

    const sensors = useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (e: PointerEvent) =>
                    e.pointerType === "touch"
                        ? [
                              new PointerActivationConstraints.Delay({
                                  value: 250,
                                  tolerance: 10,
                              }),
                          ]
                        : [
                              new PointerActivationConstraints.Distance({
                                  value: 8,
                              }),
                          ],
            }),
            KeyboardSensor,
        ],
        []
    );

    const handleDragEnd = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event: any) => {
            if (event.canceled) return;
            const source = event.operation?.source;
            const target = event.operation?.target;
            if (!source || !target) return;
            const data = source.data as CardDragData | undefined;
            if (!data) return;
            const dest = target.id as DropZoneId;
            if (data.kind === "main" && dest === "side") {
                handleMainClick(data.cardId);
            } else if (data.kind === "side" && dest === "main") {
                handleSideClick(data.cardId);
            }
        },
        [handleMainClick, handleSideClick]
    );

    return (
        <div
            className="flex h-dvh flex-col bg-surface-base text-text"
            style={{ "--card-base": CARD_BASE } as React.CSSProperties}
        >
            <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="flex items-center gap-3 border-b border-border-subtle/30 bg-surface/60 px-4 py-3 md:px-6">
                    <button
                        onClick={() => void handleDone()}
                        className="btn-base btn-tone-ghost px-3 py-1.5 text-sm"
                    >
                        ← Back to Event
                    </button>
                    <h1 className="text-lg font-semibold font-beleren tracking-wide text-parchment">
                        Build Limited Deck
                    </h1>
                </div>

                <PoolBasicLandsBar
                    cardIdsBySubtype={basicCardIds}
                    onAdd={handleAddBasic}
                    disabled={saving}
                />

                <div
                    className="grid flex-1 grid-cols-1 divide-x divide-border-subtle/30 overflow-hidden md:grid-cols-2"
                    style={
                        {
                            "--card-w": "var(--card-base)",
                            "--card-h": "calc(var(--card-base) * 7 / 5)",
                        } as React.CSSProperties
                    }
                >
                    <div className="h-full overflow-hidden">
                        <DeckPileArea
                            title="Maindeck"
                            zone="main"
                            grouped
                            cards={deck.cards}
                            onRemove={handleMainClick}
                            emptyMessage="Move Pool cards here (or add Basics above) to build your deck."
                        />
                    </div>
                    <div className="h-full overflow-hidden">
                        <DeckPileArea
                            title="Pool (Sideboard)"
                            zone="side"
                            grouped
                            cards={deck.sideboard}
                            onRemove={handleSideClick}
                            emptyMessage="Every remaining Pool card lives here until moved to the Maindeck."
                        />
                    </div>
                </div>

                <DragOverlay dropAnimation={null}>
                    {(source) => {
                        const d = source.data as CardDragData;
                        return (
                            <div
                                className="aspect-5/7"
                                style={{ width: `calc(${CARD_BASE} * 1.1)` }}
                            >
                                <CardImage card={{ id: d.cardId }} />
                            </div>
                        );
                    }}
                </DragOverlay>
            </DragDropProvider>

            <DeckLegalityPanel
                formatLabel="Limited"
                isLegal={legality.isLegal}
                reasons={legality.reasons}
            />

            <SaveDeckBar
                name={deck.name}
                onChangeName={handleSetName}
                onDone={() => void handleDone()}
                cardCount={deck.cards.length}
            />
        </div>
    );
}
