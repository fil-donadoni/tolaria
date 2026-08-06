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
    findColumnOverrideablePoolIndex,
    pinsByCardId,
    splitPoolByArrangement,
} from "@convex/limited/poolArrangement";
import {
    createColumnLayout,
    parseColumnId,
    type ColumnId,
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

    // The zones' Column Layouts (ADR 0075, issue #1622/#1624). The Maindeck's
    // Card Pins are the seat's Pool Arrangement, read LIVE (not just at seed
    // time) so a persisted column drag reflects back reactively, survives a
    // reload, and carries the draft-phase arrangement straight over (ADR
    // 0060). The Sideboard has no Pins of its own — a drop there means "out
    // of the deck", never a Pin. Rebuilt fresh from `mainView`/`sideView` on
    // every Grouping/Ordering change, so there is no separate "preserve the
    // pins" step to get wrong: `pinsByCardId` is recomputed from the live
    // Pool Arrangement regardless of which Grouping is active.
    const layout = useMemo<DeckColumnLayout>(
        () => ({
            maindeck: createColumnLayout({
                pins: pinsByCardId(pool, poolArrangement),
                grouping: mainView.grouping,
                ordering: mainView.ordering,
            }),
            sideboard: createColumnLayout({
                grouping: sideView.grouping,
                ordering: sideView.ordering,
            }),
        }),
        [pool, poolArrangement, mainView, sideView]
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
    // store + mutation the draft Pool uses, ADR 0060). Resolves the
    // `cardId`-keyed UI action back to a `poolIndex`; a Basic land added from
    // the bar has no `poolIndex`, so its column can't be pinned (no-op).
    //
    // The namespaced Column id travels WHOLE (issue #1624): the mutation's
    // `column` arg speaks the engine's full vocabulary, so a drop onto a
    // `color:`/`type:`/`custom:` Column persists in its own Pin namespace
    // exactly as an `mv:` drop always has. It previously went through the
    // `mv`-only inverse shim (`mvColumnFromPins`), which returned `undefined`
    // for every other namespace — and since this zone's Grouping control can
    // now generate colour/type Columns, that made every one of them a live,
    // highlighting, DEAD drop target.
    const handlePin = useCallback(
        (cardId: string, columnId: ColumnId) => {
            // The Catch-All (and grouping `none`'s single Column) carry no
            // namespace and are never pin targets — the same rule the
            // engine's own `pinCardToColumn` applies.
            if (!parseColumnId(columnId)) return;
            const poolIndex = findColumnOverrideablePoolIndex(
                pool,
                poolArrangement,
                cardId
            );
            if (poolIndex === null) return;
            void setPoolArrangementEntry({
                eventId,
                poolIndex,
                column: columnId,
            }).catch(() => {});
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
