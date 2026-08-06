import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { DragDropManager } from "@dnd-kit/dom";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { validateDeck } from "@convex/formats";
import { poolFromLimitedPoolCards } from "@convex/limited/poolResolution";
import {
    pinsByPoolIndex,
    poolIndexForCopy,
    splitPoolByArrangement,
} from "@convex/limited/poolArrangement";
import {
    addManualColumn,
    fromStoredDeckColumnLayout,
    manualColumnIdForLabel,
    normalizeManualColumnLabel,
    parseColumnId,
    removeColumn,
    renameManualColumn,
    storeZoneLayout,
    type ColumnId,
    type ColumnLayout,
    type DeckColumnLayout,
    type GroupingKind,
    type OrderingKind,
} from "@convex/deckLayout";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import { computeDeckColors } from "~/lib/deckColors";
import {
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import { cardBase } from "~/lib/cardSizing";
import { isBasicLandCardId, resolveBasicLandCardIds } from "./basicLands";
import DeckBuilderShell from "./deck-builder-shell";
import type { DeckBuilderViewSpec, WorkingDeck } from "./deckBuilderVariant";
import {
    recordGroupingChange,
    recordOrderingChange,
    seededColumnView,
} from "./deckZoneColumnView";
import PoolBasicLandsBar from "./pool-basic-lands-bar";
import { useDeckWorkspace, type DeckSaveSink } from "./useDeckWorkspace";

// Floored at CARD_MIN_W (issue #2056) so a short-and-wide viewport (landscape
// phone, split-screen tablet) can't collapse the `9dvh` term past legibility.
const CARD_BASE = cardBase("7.5rem", "17vw", "9dvh");

/** This variant's declared view spec: its OWN `localStorage` namespaces, kept
 *  distinct from the Constructed builder's so the two persist independent
 *  split and zoom (issue #1622). */
const VIEW: DeckBuilderViewSpec = {
    cardBase: CARD_BASE,
    splitZone: "pool",
    splitDefault: 2 / 3,
    mainZoomZone: "pool-main",
    sideZoomZone: "pool-side",
    zoomInitial: 1.0,
};

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
    const sideboard = pool.map((c) => ({
        cardId: c.cardId,
        cardName: c.cardName,
    }));
    return {
        name: "Sealed Pool Deck",
        format: "limited",
        cards: [],
        sideboard,
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
        format: "limited",
        cards: split.cards,
        sideboard: split.sideboard,
    };
}

function applySplit(deck: WorkingDeck, split: SideboardSplit): WorkingDeck {
    return { ...deck, cards: split.cards, sideboard: split.sideboard };
}

/** The Card Pin key of one COPY (issue #1626): the Pool's own `poolIndex`,
 *  stringified — the key `pinsByPoolIndex` records Pins under. A card the Pool
 *  doesn't hold (a Basic land added from the bar) gets a deliberately
 *  NON-numeric key: it has no Pin, can never collide with a real `poolIndex`,
 *  and `handlePin` rejects it rather than pinning some other card's copy. */
function poolPinKey(
    pool: readonly LimitedPoolCard[],
    cardId: string,
    copyIndex: number
): string {
    const poolIndex = poolIndexForCopy(pool, cardId, copyIndex);
    return poolIndex === null ? `unpooled:${cardId}` : String(poolIndex);
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
    /** dnd-kit manager, forwarded to the shell. Omitted in the app (the
     *  provider makes its own); the mounted drag tests inject one so they can
     *  drive REAL drag operations against the REAL droppable registry — jsdom
     *  has no layout, so a pointer-driven drag can never resolve a drop target
     *  there. Same escape hatch `DeckBuilder` carries. */
    manager?: DragDropManager;
}

/**
 * The **Limited** entry point of the unified deckbuilder (ADR 0075 §1, issue
 * #1623) — one of the shell's three declared variants, and a thin wrapper by
 * construction. It supplies exactly what is Limited about building from a
 * sealed Pool:
 *
 *  - **no source panel** — the Pool zone IS the card source, so cards only
 *    ever move between the two zones (`onAddTo*` deliberately unwired, which
 *    makes an add-from-elsewhere drag a no-op rather than a special case);
 *  - **its persistence sinks** — the deck row through `userDecks`, and Card
 *    Pins through the seat's Pool Arrangement (`setPoolArrangementEntry`, the
 *    SAME store the draft Pool writes, ADR 0060);
 *  - **its legality** — `validateDeck` against `limited`, with the seat's own
 *    Pool injected as the `ResolvePool`;
 *  - plus the basics bar and the uncapped Sideboard's copy.
 *
 * Everything else — toolbar, zones, split, drag context, legality panel, save
 * bar, autosave — is the shell's and `useDeckWorkspace`'s.
 */
export default function PoolDeckBuilderForm({
    eventId,
    seatIndex,
    pool,
    existingDeck,
    eventType,
    poolArrangement,
    manager,
}: PoolDeckBuilderFormProps) {
    const navigate = useNavigate();
    const { create, update } = useUserDeckMutations();
    const { setPoolArrangementEntry } = useLimitedEventMutations();

    // The persistence sink: create the seat's deck row on the first write,
    // patch it by id afterwards. `limitedEventId`/`limitedSeatId` bind the row
    // to this seat so its legality can resolve the Pool.
    const save = useCallback<DeckSaveSink>(
        async (pending, identity) => {
            // A Pool only ever holds registry cards, so the deck's colour
            // identity derives registry-only (no Full Catalogue resolver).
            const colors = computeDeckColors(pending.cards);
            if (identity === null) {
                const id = await create({
                    name: pending.name,
                    format: "limited",
                    colors,
                    cards: pending.cards,
                    sideboard: pending.sideboard,
                    limitedEventId: eventId,
                    limitedSeatId: String(seatIndex),
                    // Manual/deleted Columns only (issue #1626): this deck's
                    // Card Pins live on the seat's Pool Arrangement, keyed by
                    // `poolIndex`, so they are never copied onto the deck row
                    // — see `storeZoneLayout(..., includePins = false)` below.
                    layout: pending.layout,
                });
                return id as string;
            }
            await update({
                id: identity as Id<"userDecks">,
                patch: {
                    name: pending.name,
                    colors,
                    cards: pending.cards,
                    sideboard: pending.sideboard,
                    layout: pending.layout,
                },
            });
            return identity;
        },
        [create, update, eventId, seatIndex]
    );

    const { deck, saving, updateDeck, setName, flush } = useDeckWorkspace({
        initialIdentity: existingDeck?.userDeckId ?? null,
        save,
        initial: () => {
            if (existingDeck) {
                return {
                    name: existingDeck.name,
                    format: "limited",
                    cards: existingDeck.cards,
                    sideboard: existingDeck.sideboard ?? [],
                    // The manual Columns saved with this seat's deck (issue
                    // #1626). Absent for a deck saved before the slice, which
                    // rehydrates as the plain default.
                    layout: existingDeck.layout,
                };
            }
            return eventType === "draft"
                ? continuousWorkingDeck(pool, poolArrangement)
                : defaultWorkingDeck(pool);
        },
    });

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

    // Per-zone Grouping/Ordering (issue #1624), seeded from the user's
    // per-zone view preference (issue #1620's `deckViewPrefs` seam, bridged by
    // `deckZoneColumnView.ts`) — the SAME seam the Constructed builder reads,
    // so a choice made in either builder is remembered for the user
    // everywhere (PRD #1617 § "Persistence: view preferences on the user").
    const [mainView, setMainView] = useState(() =>
        seededColumnView("maindeck")
    );
    const [sideView, setSideView] = useState(() =>
        seededColumnView("sideboard")
    );

    // The zones' Column Layouts (ADR 0075, issue #1622/#1624/#1626), assembled
    // from THREE homes — this variant is the one that shows why ADR 0075 §4
    // splits them:
    //
    //  - Grouping/Ordering: per-user view preference (`mainView`/`sideView`);
    //  - manual + deleted Columns: deck data on the seat's deck row
    //    (`deck.layout`), so the workspace follows the deck;
    //  - Card Pins: the seat's Pool Arrangement, keyed by `poolIndex` and read
    //    LIVE (not just at seed time) so a persisted column drag reflects back
    //    reactively, survives a reload, and carries the draft-phase
    //    arrangement straight over (ADR 0060). Per COPY, so two physical
    //    copies of one card stay individually placeable.
    //
    // The Sideboard has no Pins of its own — a drop there means "out of the
    // deck", never a Pin. Rebuilt on every change, so there is no separate
    // "preserve the pins" step to get wrong.
    const layout = useMemo<DeckColumnLayout>(() => {
        const base = fromStoredDeckColumnLayout(deck.layout, {
            maindeck: mainView,
            sideboard: sideView,
        });
        return {
            ...base,
            maindeck: {
                ...base.maindeck,
                pins: pinsByPoolIndex(pool, poolArrangement),
            },
        };
    }, [deck.layout, pool, poolArrangement, mainView, sideView]);

    // Per-copy Card Pin keys (ADR 0075 §4, issue #1626). The shared zones
    // render `cardId`-keyed `DeckCard`s, which have no per-copy identity of
    // their own; these resolvers put it back by mapping "the Nth copy of this
    // card in this Zone" onto the Pool's own `poolIndex` — the key the Pool
    // Arrangement stores Pins under.
    //
    // The two Zones are numbered CONSECUTIVELY (the Sideboard's ordinals
    // continue where the Maindeck's stop) so a Maindeck copy and a Sideboard
    // copy of the same card can never resolve to the same `poolIndex` — which
    // would make moving the Sideboard copy into a column re-pin the copy
    // already sitting there. A card the Pool does not hold (a Basic added from
    // the bar) resolves to a deliberately NON-numeric key, so it simply has no
    // Pin and `handlePin` no-ops on it.
    const mainCopyCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const card of deck.cards)
            counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1);
        return counts;
    }, [deck.cards]);

    const pinKeys = useMemo(
        () => ({
            maindeck: (card: { cardId: string }, copyIndex: number) =>
                poolPinKey(pool, card.cardId, copyIndex),
            sideboard: (card: { cardId: string }, copyIndex: number) =>
                poolPinKey(
                    pool,
                    card.cardId,
                    (mainCopyCounts.get(card.cardId) ?? 0) + copyIndex
                ),
        }),
        [pool, mainCopyCounts]
    );

    const handleMainGroupingChange = useCallback((grouping: GroupingKind) => {
        recordGroupingChange("maindeck", grouping);
        setMainView((v) => ({ ...v, grouping }));
    }, []);
    const handleSideGroupingChange = useCallback((grouping: GroupingKind) => {
        recordGroupingChange("sideboard", grouping);
        setSideView((v) => ({ ...v, grouping }));
    }, []);
    const handleMainOrderingChange = useCallback((ordering: OrderingKind) => {
        recordOrderingChange("maindeck", ordering);
        setMainView((v) => ({ ...v, ordering }));
    }, []);
    const handleSideOrderingChange = useCallback((ordering: OrderingKind) => {
        recordOrderingChange("sideboard", ordering);
        setSideView((v) => ({ ...v, ordering }));
    }, []);

    // Column drag: persist the Pin on the seat's Pool Arrangement (the SAME
    // store + mutation the draft Pool uses, ADR 0060), for the COPY that was
    // dragged. The `poolIndex` arrives on the drag payload as the pin key
    // (issue #1626) rather than being re-derived from the card id — the old
    // `findColumnOverrideablePoolIndex` shim had to GUESS which copy moved
    // ("prefer one in the Maindeck, else any"), which meant two copies of one
    // card could never be filed in different columns. A Basic land added from
    // the bar has no `poolIndex`, so its key is non-numeric and the drag is a
    // no-op.
    //
    // The namespaced Column id travels WHOLE (issue #1624): the mutation's
    // `column` arg speaks the engine's full vocabulary, so a drop onto a
    // `color:`/`type:`/`custom:` Column persists in its own Pin namespace
    // exactly as an `mv:` drop always has.
    const handlePin = useCallback(
        (_cardId: string, columnId: ColumnId, pinKey: string) => {
            // The Catch-All (and grouping `none`'s single Column) carry no
            // namespace and are never pin targets — the same rule the
            // engine's own `pinCardToColumn` applies.
            if (!parseColumnId(columnId)) return;
            const poolIndex = Number(pinKey);
            if (!Number.isInteger(poolIndex)) return;
            void setPoolArrangementEntry({
                eventId,
                poolIndex,
                column: columnId,
            }).catch(() => {});
        },
        [setPoolArrangementEntry, eventId]
    );

    // Manual Columns (ADR 0075 §2, issue #1626). They persist on the SEAT'S
    // DECK ROW, not on the Pool Arrangement: the Arrangement is a per-card
    // record and a Column is not a card. `includePins: false` is what keeps
    // the two homes from both claiming the Pins — this zone's Pins are the
    // Arrangement's, merged in at render time only.
    const updateMaindeckLayout = useCallback(
        (edit: (layout: ColumnLayout) => ColumnLayout) => {
            updateDeck((d) => {
                const current = fromStoredDeckColumnLayout(d.layout, {
                    maindeck: mainView,
                    sideboard: sideView,
                }).maindeck;
                const next = edit(current);
                if (next === current) return d;
                return {
                    ...d,
                    layout: storeZoneLayout(d.layout, "maindeck", next, false),
                };
            });
        },
        [updateDeck, mainView, sideView]
    );

    const handleAddColumn = useCallback(
        (rawLabel: string) => {
            const label = normalizeManualColumnLabel(rawLabel);
            if (label === null) return;
            updateMaindeckLayout((current) =>
                addManualColumn(current, {
                    id: manualColumnIdForLabel(current, label),
                    label,
                })
            );
        },
        [updateMaindeckLayout]
    );
    const handleRenameColumn = useCallback(
        (columnId: ColumnId, label: string) => {
            updateMaindeckLayout((current) =>
                renameManualColumn(current, columnId, label)
            );
        },
        [updateMaindeckLayout]
    );
    const handleDeleteColumn = useCallback(
        (columnId: ColumnId) => {
            updateMaindeckLayout((current) => removeColumn(current, columnId));
        },
        [updateMaindeckLayout]
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
        [deck.cards, deck.sideboard, eventId, seatIndex, pool]
    );

    return (
        <DeckBuilderShell
            title="Build Limited Deck"
            backLabel="← Back to Event"
            onDone={() => void handleDone()}
            manager={manager}
            basicsBar={
                <PoolBasicLandsBar
                    cardIdsBySubtype={basicCardIds}
                    onAdd={handleAddBasic}
                    disabled={saving}
                />
            }
            mainCards={deck.cards}
            sideCards={deck.sideboard}
            layout={layout}
            pinKeys={pinKeys}
            view={VIEW}
            zones={{
                sideTitle: "Pool (Sideboard)",
                mainEmptyMessage:
                    "Move Pool cards here (or add Basics above) to build your deck.",
                sideEmptyMessage:
                    "Every remaining Pool card lives here until moved to the Maindeck.",
            }}
            actions={{
                onMoveToSideboard: handleMainClick,
                onMoveToMaindeck: handleSideClick,
                onPin: handlePin,
                onMainCardClick: (card) => handleMainClick(card.cardId),
                onSideCardClick: (card) => handleSideClick(card.cardId),
                onMainGroupingChange: handleMainGroupingChange,
                onSideGroupingChange: handleSideGroupingChange,
                onMainOrderingChange: handleMainOrderingChange,
                onSideOrderingChange: handleSideOrderingChange,
                onAddColumn: handleAddColumn,
                onRenameColumn: handleRenameColumn,
                onDeleteColumn: handleDeleteColumn,
            }}
            legality={{
                formatLabel: "Limited",
                isLegal: legality.isLegal,
                reasons: legality.reasons,
            }}
            saveBar={{
                name: deck.name,
                cardCount: deck.cards.length,
                onChangeName: setName,
            }}
        />
    );
}
