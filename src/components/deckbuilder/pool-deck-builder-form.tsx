import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { DragDropManager } from "@dnd-kit/dom";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { FORMAT_RULES, validateDeck } from "@convex/formats";
import { poolFromLimitedPoolCards } from "@convex/limited/poolResolution";
import {
    assignPoolCopies,
    pinsByPoolIndex,
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
import type { DeckCard, ZoneCard } from "~/types/game";
import { computeDeckColors } from "~/lib/deckColors";
import {
    moveToMaindeck,
    moveToSideboard,
    type SideboardSplit,
} from "~/lib/deckSideboard";
import { cardBase } from "~/lib/cardSizing";
import {
    applyBasicLandArtPreference,
    basicLandSubtypeOf,
    countBasicLandCopies,
    findBasicLandRemovalIndex,
    recordBasicLandArtChoice,
    resolveBasicLandCardIds,
    rewriteBasicLandArtInDeck,
    seededBasicLandArt,
    type BasicLandSubtype,
} from "./basicLands";
import DeckBuilderShell from "./deck-builder-shell";
import DeckStatsButton from "./deck-stats-button";
import type { DeckBuilderViewSpec, WorkingDeck } from "./deckBuilderVariant";
import {
    recordGroupingChange,
    recordOrderingChange,
    seededColumnView,
} from "./deckZoneColumnView";
import PoolBasicLandsBar from "./pool-basic-lands-bar";
import { toZoneCards } from "./poolZoneCards";
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
    return {
        name: "Sealed Pool Deck",
        format: "limited",
        cards: [],
        sideboard: toZoneCards(
            pool.map((c, poolIndex) => ({
                cardId: c.cardId,
                cardName: c.cardName,
                poolIndex,
            }))
        ),
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
        cards: toZoneCards(split.cards),
        sideboard: toZoneCards(split.sideboard),
    };
}

/** A SAVED deck's working state (issue #1626, PR #2318 review B1). The deck
 *  row stores card ids only, so which physical Pool copy sits in which Zone is
 *  rebuilt here — once, at mount — by `assignPoolCopies`, which puts the
 *  PINNED copies in the Maindeck so every recorded Pin is still visible after
 *  a reload. */
function savedWorkingDeck(
    existingDeck: UserLobbyDeck,
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[]
): WorkingDeck {
    const identified = assignPoolCopies(pool, arrangement, {
        cards: existingDeck.cards,
        sideboard: existingDeck.sideboard ?? [],
    });
    return {
        name: existingDeck.name,
        format: "limited",
        cards: toZoneCards(identified.cards),
        sideboard: toZoneCards(identified.sideboard),
        // The manual Columns saved with this seat's deck (issue #1626).
        // Absent for a deck saved before the slice, which rehydrates as the
        // plain default.
        layout: existingDeck.layout,
    };
}

function applySplit(deck: WorkingDeck, split: SideboardSplit): WorkingDeck {
    return { ...deck, cards: split.cards, sideboard: split.sideboard };
}

/** One zone entry as the DECK ROW stores it — `{ cardId, cardName }` and
 *  nothing else. See the save sink below for why the per-copy `pinKey` must
 *  not travel. */
function strippedCard(card: ZoneCard): DeckCard {
    return { cardId: card.cardId, cardName: card.cardName };
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
            // The per-copy `pinKey` is a WORKING-STATE identity, not deck data
            // (issue #1626): the Pins themselves live on the seat's Pool
            // Arrangement, and `userDecks`' card validator declares exactly
            // `{ cardId, cardName }` — Convex rejects any argument a validator
            // doesn't declare, so an unstripped entry would fail the save at
            // runtime with a fully green suite.
            const cards = pending.cards.map(strippedCard);
            const sideboard = pending.sideboard.map(strippedCard);
            if (identity === null) {
                const id = await create({
                    name: pending.name,
                    format: "limited",
                    colors,
                    cards,
                    sideboard,
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
                    cards,
                    sideboard,
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
                return savedWorkingDeck(existingDeck, pool, poolArrangement);
            }
            return eventType === "draft"
                ? continuousWorkingDeck(pool, poolArrangement)
                : defaultWorkingDeck(pool);
        },
    });

    /** Removes exactly one copy of a Basic land SUBTYPE from the Maindeck
     *  (issue #1627, PR #2320 review B1/NB1) — shared by a direct tap on a
     *  Maindeck tile (`handleMainClick` below, pre-existing) and the
     *  Add-Basic bar's remove gesture (shift-click/right-click/the dedicated
     *  `−` button). Which copy leaves is `findBasicLandRemovalIndex`'s
     *  decision, the exact inverse of the counter the bar renders: by subtype
     *  (so a Pool printing and the catalogue printing are the same
     *  "Mountain"), honouring an explicitly tapped `pinKey`, and otherwise
     *  preferring an unpinned bar-added copy over a pinned Pool one. */
    const handleRemoveBasic = useCallback(
        (subtype: BasicLandSubtype, pinKey?: string) => {
            updateDeck((d) => {
                const idx = findBasicLandRemovalIndex(d.cards, subtype, pinKey);
                if (idx < 0) return d;
                const next = [...d.cards];
                next.splice(idx, 1);
                return { ...d, cards: next };
            });
        },
        [updateDeck]
    );

    // Main-zone click/drop: a Basic is freely removed (unlimited add/remove);
    // a Pool-sourced card only ever moves back to the Sideboard — it can never
    // vanish (AC2).
    //
    // `pinKey` names the COPY that was tapped or dragged (issue #1626). Two
    // identical Pool cards can sit in different Columns, so "a Lightning Bolt
    // left the Maindeck" is not enough information: without it the first
    // matching entry moves, which is routinely a card the player did not touch
    // and strands its Column (PR #2318 review B1).
    const handleMainClick = useCallback(
        (cardId: string, pinKey?: string) => {
            // A tap names a physical copy, so the `pinKey` travels: the tile
            // the player touched is the one that leaves, Basic or not (issue
            // #1626 / PR #2320 review NB1).
            const basicSubtype = basicLandSubtypeOf(cardId);
            if (basicSubtype !== null) {
                handleRemoveBasic(basicSubtype, pinKey);
                return;
            }
            updateDeck((d) => {
                const split = moveToSideboard(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId,
                    pinKey
                );
                return applySplit(d, split);
            });
        },
        [updateDeck, handleRemoveBasic]
    );

    // Sideboard-zone click/drop: always moves the card into the Maindeck
    // (Basics never start in the Sideboard, so every card offered here is
    // Pool-sourced). Copy-aware for the same reason as above.
    const handleSideClick = useCallback(
        (cardId: string, pinKey?: string) => {
            updateDeck((d) => {
                const split = moveToMaindeck(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId,
                    pinKey
                );
                return applySplit(d, split);
            });
        },
        [updateDeck]
    );

    /** Adds `count` copies (1 for a plain click, 5 for the `+5` step, issue
     *  #1627) of a Basic to the Maindeck. A Basic added here carries no
     *  `pinKey` — unlike a Pool card it was never assigned a `poolIndex`, so
     *  it can never be pinned to a manual Column (see `toZoneCards` above). */
    const handleAddBasic = useCallback(
        (cardId: string, cardName: string, count: number) => {
            updateDeck((d) => ({
                ...d,
                cards: [
                    ...d.cards,
                    ...Array.from({ length: count }, () => ({
                        cardId,
                        cardName,
                    })),
                ],
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

    // The Stats toolbar action (issue #1631): the header's full-size copy
    // and SaveDeckBar's short-viewport-only compact twin (issue #1631
    // fixup R-F6 — a `short-viewport:` className override so the twin
    // matches the row's other controls, Delete/Done, instead of being the
    // row's tallest item). It is passed through the header's
    // `foldableActions` slot rather than `headerActions` (issue #2056
    // fixup): this builder's header carries nothing else, so #2056 hid it
    // entirely under `short-viewport:` to hand its ~39px back to the card
    // zones — a real `headerActions` entry would flip `carriesControls` and
    // keep the band on screen, reopening that regression. Two separate JSX
    // elements (rather than one reused) mount two independent component
    // instances, each managing its own dialog open state — the same
    // mounting behaviour either way (React mounts once per JSX usage site).
    const statsAction = <DeckStatsButton mainCards={deck.cards} />;
    const compactStatsAction = (
        <DeckStatsButton
            mainCards={deck.cards}
            className="short-viewport:px-2 short-viewport:py-1 short-viewport:text-xs"
        />
    );

    // The user's basic-land art preference (issue #1629, ADR 0075 § "Basic-
    // land art") — seeded from `localStorage` on mount, updated on every
    // pick (mirrors `mainView`/`sideView`'s `seededColumnView`/
    // `recordGroupingChange` split above). Layered on top of the Pool/
    // catalogue resolution by `applyBasicLandArtPreference`, which leaves a
    // subtype untouched when its stored printing is stale or now-illegal
    // (AC8) — with `allowedSets: null` for `limited` (Pool-scoped legality
    // never restricts by set), every printing is always legal here, so the
    // only way a stored choice is skipped is if it no longer exists at all.
    const [basicLandArt, setBasicLandArt] = useState(() =>
        seededBasicLandArt()
    );
    const basicCardIds = useMemo(
        () =>
            applyBasicLandArtPreference(
                resolveBasicLandCardIds(pool),
                basicLandArt,
                FORMAT_RULES.limited.allowedSets
            ),
        [pool, basicLandArt]
    );
    // The bar's per-subtype counter (issue #1627) — read straight off the
    // live Maindeck, so it updates on every add/remove exactly like every
    // other zone count already does.
    const basicCounts = useMemo(
        () => countBasicLandCopies(deck.cards),
        [deck.cards]
    );

    /** A printing was picked from a subtype's art grid (issue #1629): persist
     *  the preference, hold it so the bar/picker reflect it immediately, and
     *  rewrite every copy already in the open deck — Maindeck AND Sideboard
     *  (here, "the Pool") — to the new printing. Never touches any other
     *  saved deck or the Pool's own membership: this only edits the
     *  in-memory working deck's `cardId`s, which ride the same debounced
     *  autosave as any other card edit.
     *
     *  Unlike Constructed, no Pin remap is needed HERE (review of PR #2325,
     *  finding F1 vs F2): a Pool-sourced entry's Pin key is its `poolIndex`
     *  (`toZoneCards`'s explicit `pinKey`), which this rewrite never touches
     *  — only `cardId` changes — so the Pin recorded on the seat's Pool
     *  Arrangement keeps applying in-session by construction. The gap is one
     *  step later, at RELOAD: `assignPoolCopies` re-attaches a saved entry to
     *  a physical Pool copy, and does so basic-aware (matching by subtype,
     *  not raw `cardId`) precisely so a re-arted Basic still finds its
     *  `poolIndex` back — see `convex/limited/poolArrangement.ts`. */
    const handlePickBasicArt = useCallback(
        (subtype: BasicLandSubtype, printId: string) => {
            recordBasicLandArtChoice(subtype, printId);
            setBasicLandArt((prev) => ({ ...prev, [subtype]: printId }));
            const rewritten = rewriteBasicLandArtInDeck(deck, subtype, printId);
            if (
                rewritten.cards === deck.cards &&
                rewritten.sideboard === deck.sideboard
            ) {
                // N1 (review of PR #2325): nothing to rewrite — skip
                // `updateDeck` entirely rather than scheduling a debounced
                // save of byte-identical content.
                return;
            }
            updateDeck((d) => ({
                ...d,
                ...rewriteBasicLandArtInDeck(d, subtype, printId),
            }));
        },
        [updateDeck, deck]
    );

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
                    counts={basicCounts}
                    onAdd={handleAddBasic}
                    onRemove={handleRemoveBasic}
                    allowedSets={FORMAT_RULES.limited.allowedSets}
                    onPickArt={handlePickBasicArt}
                    disabled={saving}
                />
            }
            headerFoldableActions={statsAction}
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
                // The clicked ENTRY carries its own copy key (issue #1626),
                // so a tap moves exactly the card that was tapped.
                onMainCardClick: (card) =>
                    handleMainClick(card.cardId, card.pinKey),
                onSideCardClick: (card) =>
                    handleSideClick(card.cardId, card.pinKey),
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
                foldableActions: compactStatsAction,
            }}
        />
    );
}
