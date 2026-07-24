import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { validateDeck } from "@convex/formats";
import { poolFromLimitedPoolCards } from "@convex/limited/poolResolution";
import {
    columnOverridesByCardId,
    findColumnOverrideablePoolIndex,
    splitPoolByArrangement,
} from "@convex/limited/poolArrangement";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import { computeDeckColors } from "~/lib/deckColors";
import {
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import type { DeckCard } from "~/types/game";
import DeckLegalityPanel from "~/components/lobby/deck-builder/deck-legality-panel";
import SaveDeckBar from "~/components/lobby/deck-builder/save-deck-bar";
import { Button } from "@/components/ui/button";
import { isBasicLandCardId, resolveBasicLandCardIds } from "./basicLands";
import PoolBasicLandsBar from "./pool-basic-lands-bar";
import PoolDeckbuilderSurface from "./pool-deckbuilder-surface";

const SAVE_DEBOUNCE_MS = 800;

interface WorkingDeck {
    name: string;
    cards: DeckCard[];
    sideboard: DeckCard[];
}

/** Every opened Pool card (basics included) starts in the Sideboard for a
 *  brand-new Sealed deck (PRD #1107 story 19, ADR 0054/0055 — "every unplayed
 *  Pool card kept in the uncapped Sideboard automatically"), empty Maindeck.
 *  This makes AC2 ("Main + Side always equals the Pool") true BY
 *  CONSTRUCTION: the only ops available on a Pool-sourced card are
 *  move-to-main / move-to-side, never delete. Sealed-only — a Sealed event
 *  never builds a Pool Arrangement (no draft phase to arrange during), so
 *  this is the one path with no continuous-draft carry-over to seed from
 *  instead (see `continuousWorkingDeck` below). */
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

/** A DRAFT event's working deck, seeded from the Pool Arrangement built
 *  during the draft (ADR 0060, issue #1247) — "the arrangement built during
 *  the draft carries unchanged into deckbuild": every card the player never
 *  explicitly sideboarded is ALREADY in the Maindeck (the continuous
 *  "draft-time Pool IS the working deck" default, `resolvePoolPlacements`),
 *  unlike Sealed's all-Sideboard start above. */
function continuousWorkingDeck(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[]
): WorkingDeck {
    const split = splitPoolByArrangement(pool, arrangement);
    return {
        name: "Draft Pool Deck",
        cards: split.cards,
        sideboard: split.sideboard,
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
    /** Draft vs Sealed — decides the initial working-deck SEED when there's no
     *  saved deck yet: a Draft carries its Pool Arrangement over
     *  (`continuousWorkingDeck`, ADR 0060 issue #1247), a Sealed event has no
     *  draft phase so every card starts in the Sideboard (`defaultWorkingDeck`,
     *  pre-#1247 default). Ignored once `existingDeck` is set. */
    eventType: "draft" | "sealed";
    /** The seat's LIVE Pool Arrangement (ADR 0060, issue #1247/#1575) — the
     *  Maindeck⇄Sideboard split seed AND the per-card manual column overrides.
     *  Read live (not just at seed time) so a column drag persisted via
     *  `setPoolArrangementEntry` reflects back reactively AND survives reload
     *  (issue #1575). Empty for a seat nobody has arranged yet. */
    poolArrangement: PoolArrangementEntry[];
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
    eventType,
    poolArrangement,
}: PoolDeckBuilderFormProps) {
    const navigate = useNavigate();
    const { create, update } = useUserDeckMutations();
    const { setPoolArrangementEntry } = useLimitedEventMutations();

    const [deck, setDeck] = useState<WorkingDeck>(() => {
        if (existingDeck) {
            return {
                name: existingDeck.name,
                cards: existingDeck.cards,
                sideboard: existingDeck.sideboard ?? [],
            };
        }
        return eventType === "draft"
            ? continuousWorkingDeck(pool, poolArrangement)
            : defaultWorkingDeck(pool);
    });
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

    // Per-card manual Mana-Value column overrides (issue #1575), read LIVE
    // from the seat's Pool Arrangement so a persisted column drag reflects
    // back reactively and carries the draft-phase arrangement over.
    const columnOverrides = useMemo(
        () => columnOverridesByCardId(pool, poolArrangement),
        [pool, poolArrangement]
    );
    const columnOf = useCallback(
        (cardId: string) => columnOverrides.get(cardId),
        [columnOverrides]
    );

    // Column drag: persist the override on the seat's Pool Arrangement (the
    // SAME store + mutation the draft Pool uses, ADR 0060). Resolves the
    // `cardId`-keyed UI action back to a `poolIndex`; a Basic land added from
    // the bar has no `poolIndex`, so its column can't be overridden (no-op).
    const handleSetColumn = useCallback(
        (cardId: string, column: number | "lands") => {
            const poolIndex = findColumnOverrideablePoolIndex(
                pool,
                poolArrangement,
                cardId
            );
            if (poolIndex === null) return;
            void setPoolArrangementEntry({ eventId, poolIndex, column }).catch(
                () => {}
            );
        },
        [pool, poolArrangement, setPoolArrangementEntry, eventId]
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

    return (
        <div className="flex h-dvh flex-col bg-surface-base text-text">
            <div className="flex items-center gap-3 border-b border-border-subtle/30 bg-surface/60 px-4 py-3 md:px-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDone()}
                >
                    ← Back to Event
                </Button>
                <h1 className="text-lg font-semibold font-beleren tracking-wide text-parchment">
                    Build Limited Deck
                </h1>
            </div>

            <PoolBasicLandsBar
                cardIdsBySubtype={basicCardIds}
                onAdd={handleAddBasic}
                disabled={saving}
            />

            <PoolDeckbuilderSurface
                mainCards={deck.cards}
                sideCards={deck.sideboard}
                onMoveToSideboard={handleMainClick}
                onMoveToMaindeck={handleSideClick}
                columnOf={columnOf}
                onSetColumn={handleSetColumn}
                mainEmptyMessage="Move Pool cards here (or add Basics above) to build your deck."
                sideEmptyMessage="Every remaining Pool card lives here until moved to the Maindeck."
            />

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
