import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragDropManager } from "@dnd-kit/dom";
import {
    addManualColumn,
    fromStoredDeckColumnLayout,
    manualColumnIdForLabel,
    normalizeManualColumnLabel,
    pinCardToColumn,
    remapPinKeys,
    removeColumn,
    renameManualColumn,
    storeZoneLayout,
    type ColumnId,
    type ColumnLayout,
    type DeckColumnLayout,
    type GroupingKind,
    type OrderingKind,
} from "@convex/deckLayout";
import { effectiveFeatured, toggleFeatured } from "~/lib/featuredPicker";
import { computeDeckColors } from "~/lib/deckColors";
import { deckCardLookup, makeDeckCardShapeResolver } from "~/lib/deckCardShape";
import {
    applyBasicLandArtPreference,
    basicLandArtCardIdsToRemap,
    countBasicLandCopies,
    findBasicLandRemovalIndex,
    recordBasicLandArtChoice,
    resolveCanonicalBasicLandCardIds,
    rewriteBasicLandArtInDeck,
    seededBasicLandArt,
    type BasicLandSubtype,
} from "~/components/deckbuilder/basicLands";
import PoolBasicLandsBar from "~/components/deckbuilder/pool-basic-lands-bar";
import DeckStatsButton from "~/components/deckbuilder/deck-stats-button";
import DeckBuilderShell from "~/components/deckbuilder/deck-builder-shell";
import type { DeckBuilderViewSpec } from "~/components/deckbuilder/deckBuilderVariant";
import {
    recordGroupingChange,
    recordOrderingChange,
    seededColumnView,
} from "~/components/deckbuilder/deckZoneColumnView";
import {
    useDeckWorkspace,
    type DeckSaveSink,
} from "~/components/deckbuilder/useDeckWorkspace";
import { useBanlistOverride } from "~/hooks/useBanlistOverride";
import { FORMAT_RULES, type FormatId, validateDeck } from "@convex/formats";
import { type LobbyDeck } from "~/lib/deckTypes";
import {
    type DeckBuilderKind,
    type DeckBuilderMode,
    type DeckBuilderSinks,
    dispatchDeckSave,
} from "~/lib/deckBuilderDispatch";
import { nextDeckName } from "~/lib/userDecks";
import {
    SIDEBOARD_LIMIT,
    moveToMaindeck,
    moveToSideboard,
} from "~/lib/deckSideboard";
import type { ParsedDecklist } from "~/lib/deckImport";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import CardZoomSlider from "./card-zoom-slider";
import ColorFilter from "./color-filter";
import DeckExportButton from "./deck-export-button";
import DeckImportDialog from "./deck-import-dialog";
import ManaValueFilter from "./mana-value-filter";
import ResultsGrid from "./results-grid";
import SearchBar from "./search-bar";
import FormatSelect from "./format-select";
import DeckBanlistPanel from "./deck-banlist-panel";
import SetFilter from "./set-filter";
import TypeFilter from "./type-filter";
import CubeFilter from "./cube-filter";
import SortSelect from "./sort-select";
import { type SortDirection, type SortKey } from "./cardSort";
import { useCardZoom } from "./useCardZoom";
import { useFilterSearchParams } from "./useFilterSearchParams";
import { type ColorMode, type MatchMode, useCardSearch } from "./useCardSearch";
import { useDebouncedValue } from "~/hooks/useDebouncedValue";
import {
    makeCatalogueNameResolver,
    type FullCatalogueResult,
} from "~/lib/fullCatalogue";
import { cardBase } from "~/lib/cardSizing";

// Responsive base card width; per-zone zoom multiplies it. Floored at
// CARD_MIN_W (issue #2056) so a short-and-wide viewport can't collapse it.
const CARD_BASE = cardBase("8rem", "18vw", "9.5dvh");

/** This variant's declared view spec. The `localStorage` namespaces are the
 *  Constructed builder's own — never the Limited builder's `pool` ones, which
 *  would silently merge two independent saved layouts (issue #1622). */
const VIEW: DeckBuilderViewSpec = {
    cardBase: CARD_BASE,
    splitZone: "deckbuilder",
    splitDefault: 3 / 4,
    mainZoomZone: "main",
    sideZoomZone: "side",
    zoomInitial: 1.25,
};

// Per-zone CSS vars driving `--card-w` / `--card-h` from a zoom multiplier.
function zoomVars(mult: number): React.CSSProperties {
    return {
        "--card-w": `calc(${CARD_BASE} * ${mult})`,
        "--card-h": `calc(${CARD_BASE} * ${mult} * 7 / 5)`,
    } as React.CSSProperties;
}

interface DeckBuilderProps {
    // The kind of deck being edited: a user's own deck or an admin-curated
    // preset (PRD #466, ADR 0033). Drives the save dispatch and the read-only
    // slug display in preset mode.
    kind: DeckBuilderKind;
    // Whether the editor is creating a brand-new deck or editing an existing
    // one. Drives the save dispatch: a preset in create mode persists via
    // `createPreset` on first flush, then patches by the derived slug.
    mode?: DeckBuilderMode;
    // Format to seed a brand-new deck with (create mode, `initialDeck === null`).
    // Carries the lobby's selected format filter through the New Deck action so
    // it isn't reset to Freeform. Ignored when editing an existing deck.
    defaultFormat?: FormatId;
    initialDeck: LobbyDeck | null;
    // Stable identity of the deck being edited: a `userDeckId` for an existing
    // user deck, the slug for a preset, or null for a brand-new user deck.
    initialIdentity: string | null;
    initialDeckList: LobbyDeck[];
    // Mutation sinks for both kinds; the editor never branches on `kind` —
    // `dispatchDeckSave` does.
    sinks: DeckBuilderSinks;
    // Full Catalogue result for manual/real mode merging. When absent (catalogue
    // not yet loaded or failed), the builder falls back to index-only search.
    fullCatalogue?: FullCatalogueResult;
    onClose: (savedDeckId: string | null) => void;
    onDelete?: () => Promise<void>;
    // dnd-kit manager, forwarded to the shell. Omitted in the app (the provider
    // makes its own); the mounted tests inject one so they can drive REAL drag
    // operations against the REAL droppable registry.
    manager?: DragDropManager;
}

// Trailing-edge delay before a search keystroke feeds the filter pass + URL
// (PRD #501, issue #503). Tuned for feel; the input itself stays responsive.
const SEARCH_DEBOUNCE_MS = 180;
const DEFAULT_FORMAT: FormatId = "freeform";

/**
 * The **Constructed** entry point of the unified deckbuilder (ADR 0075 §1,
 * issue #1623) — one of the shell's three declared variants. It supplies
 * exactly what is Constructed about building from the whole catalogue:
 *
 *  - **the source panel** — the card-search grid, plus the header controls
 *    that scope it (search box, Format select, cube filter, banlist panel,
 *    deck import/export) and the filter row beneath;
 *  - **its persistence sinks** — `dispatchDeckSave`, which maps `kind` +
 *    `mode` + the current identity onto the user-deck or preset mutation pair;
 *  - **its legality** — `validateDeck` against the deck's own Format, with the
 *    DB banlist override threaded in;
 *  - plus the Featured Card affordance and the Sideboard's `0–15` cap.
 *
 * Everything else — toolbar band, zones, split, drag context, legality panel,
 * save bar, autosave — is the shell's and `useDeckWorkspace`'s, shared
 * verbatim with the Limited variant.
 */
export default function DeckBuilder({
    kind,
    mode = "edit",
    defaultFormat = DEFAULT_FORMAT,
    initialDeck,
    initialIdentity,
    initialDeckList,
    sinks,
    fullCatalogue,
    onClose,
    onDelete,
    manager,
}: DeckBuilderProps) {
    const isPreset = kind === "preset";
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const { filters, setFilters, setUrlFormat, updateSearch } =
        useFilterSearchParams();

    // The search box is a responsive local value; only its debounced form feeds
    // the filter pass + URL encoding, so neither runs per keystroke (issue #503).
    // Seeded once from the URL so a shared link's query pre-fills the box.
    const [rawText, setRawText] = useState(() => filters.text);
    const debouncedText = useDebouncedValue(rawText, SEARCH_DEBOUNCE_MS);

    // The persistence sink: `dispatchDeckSave` maps `kind` + current identity
    // to the correct mutation pair (userDecks create-then-update vs
    // decks.updatePreset by slug) and returns the resulting identity. The
    // editor never branches on `kind` itself.
    //
    // Colour identity is derived HERE, at write time, off the deck being
    // written — a Tabletop deck's cards may be absent from the card registry
    // (ADR 0080), so they resolve through the Full Catalogue instead.
    const save = useCallback<DeckSaveSink>(
        (pending, identity) =>
            dispatchDeckSave(
                kind,
                sinks,
                identity,
                mode
            )({
                name: pending.name,
                format: pending.format,
                colors: computeDeckColors(
                    pending.cards,
                    makeDeckCardShapeResolver(
                        pending.format === "manual"
                            ? fullCatalogue?.rows
                            : undefined
                    )
                ),
                cards: pending.cards,
                sideboard: pending.sideboard,
                featuredCardId: pending.featuredCardId,
                // The deck's Column Layout (ADR 0075 §4, issue #1626) — it
                // rides the SAME debounced autosave as the cards, because it
                // is deck data. `undefined` (a deck whose arrangement was
                // never touched) is dropped by the sinks, so editing a deck
                // saved before this slice never writes a layout onto it; the
                // preset sinks strip it entirely (`presetDecks` stores none).
                layout: pending.layout,
            }),
        [kind, mode, sinks, fullCatalogue?.rows]
    );

    const { deck, saving, updateDeck, setName, flush } = useDeckWorkspace({
        initialIdentity,
        save,
        initial: () =>
            initialDeck
                ? {
                      name: initialDeck.name,
                      format: initialDeck.format,
                      cards: initialDeck.cards,
                      sideboard: initialDeck.sideboard ?? [],
                      // The override is seeded `undefined` so an unchanged save
                      // leaves the stored value untouched (the update mutation
                      // skips an absent `featuredCardId`). The currently-featured
                      // card is still shown via the resolved
                      // `initialDeck.featuredCardId` (see
                      // `effectiveFeaturedCardId`), so it survives reloads.
                      featuredCardId: undefined,
                      // The stored Column Layout (issue #1626), seeded whole
                      // — unlike `featuredCardId` above it is NOT seeded
                      // `undefined`, because it is the complete value rather
                      // than an override: re-sending it unchanged is a no-op,
                      // while seeding `undefined` would make the FIRST column
                      // edit overwrite the other Zone's stored arrangement
                      // with nothing.
                      layout: initialDeck.layout,
                  }
                : {
                      name: nextDeckName(initialDeckList),
                      format: defaultFormat,
                      cards: [],
                      sideboard: [],
                      featuredCardId: undefined,
                      layout: undefined,
                  },
    });

    // The card search is pre-filtered to the deck's Format allowed sets (issue
    // #514): the builder only surfaces legally-includable prints. Discovery
    // only — the authoritative legality check is `validateDeck`.
    const { entries, idle } = useCardSearch(
        filters,
        deck.format,
        fullCatalogue
    );

    // The deck's Column Layout (ADR 0075, issue #1622/#1624/#1626), assembled
    // from its TWO homes — the split is the whole point of ADR 0075 §4:
    //
    //  - Grouping and Ordering are per-USER view preferences, held here in
    //    component state and mirrored to `localStorage` (issue #1620's
    //    `deckViewPrefs` seam, bridged by `deckZoneColumnView.ts`), so they
    //    apply to every deck the user opens;
    //  - manual Columns, deleted Columns and Card Pins are DECK data, held in
    //    the working deck (`deck.layout`) and persisted on the deck row by the
    //    same debounced autosave as the cards, so they follow the deck across
    //    devices.
    //
    // A deck saved before #1626 has no stored layout, and
    // `fromStoredDeckColumnLayout` rehydrates that as the plain default —
    // which is what makes "it behaves exactly as it does today" structural
    // rather than a migration.
    const [mainView, setMainView] = useState(() =>
        seededColumnView("maindeck")
    );
    const [sideView, setSideView] = useState(() =>
        seededColumnView("sideboard")
    );
    const layout = useMemo<DeckColumnLayout>(
        () =>
            fromStoredDeckColumnLayout(deck.layout, {
                maindeck: mainView,
                sideboard: sideView,
            }),
        [deck.layout, mainView, sideView]
    );

    // Grouping/Ordering change handlers (issue #1624). They touch ONLY the
    // view preference — never `pins` — which is the guarantee that flipping to
    // colour and back restores every Pin exactly (ADR 0075 §3): a Pin lives in
    // the persisted half, which these never write.
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

    /** Folds one engine edit of the MAINDECK Layout back into the working
     *  deck, which schedules the autosave. Every column gesture below goes
     *  through here, so "a layout edit persists exactly like a card edit" has
     *  one implementation rather than four. */
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
                    layout: storeZoneLayout(d.layout, "maindeck", next),
                };
            });
        },
        [updateDeck, mainView, sideView]
    );

    // Manual Columns (ADR 0075 §2, issue #1626). The engine mints the
    // collision-free `custom:` id from the label and rejects a blank one, so
    // this handler carries no id or validation logic of its own.
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
    // Deletion is gated in the surface by the engine's own `canDeleteColumn`
    // over the UNFILTERED columns — a non-empty column's control is rendered
    // disabled with its reason, never wired to this.
    const handleDeleteColumn = useCallback(
        (columnId: ColumnId) => {
            updateMaindeckLayout((current) => removeColumn(current, columnId));
        },
        [updateMaindeckLayout]
    );

    // Deck-side card resolution (ADR 0080). A Tabletop deck's pool is the whole
    // Full Catalogue, so its cards may be absent from the card registry — the
    // Column Layout engine must resolve them off the catalogue row instead of
    // throwing `Card not found`. Every other format only ever holds implemented
    // cards, so it stays registry-only.
    const resolveShape = useMemo(
        () =>
            makeDeckCardShapeResolver(
                deck.format === "manual" ? fullCatalogue?.rows : undefined
            ),
        [deck.format, fullCatalogue?.rows]
    );

    // Same split for a pasted decklist: in Tabletop a name the GRE doesn't
    // implement is a legitimate import, not a skipped line.
    const resolveCatalogueName = useMemo(
        () =>
            makeCatalogueNameResolver(
                deck.format === "manual" ? fullCatalogue?.rows : undefined
            ),
        [deck.format, fullCatalogue?.rows]
    );

    // Pick the Featured Card (PRD #589, issue #599). Stores the Card ID as the
    // override on the working deck; the debounced autosave persists it through
    // the existing deck update mutation (admin-gated for presets, ADR 0033).
    // A re-pick of the already-featured card clears the override, reverting to
    // the first-Maindeck-card default (User Story 13) — and so does an explicit
    // `null`, which is what the deck-detail picker's `Auto` option sends (issue
    // #2584): a `<select>` fires no change when you re-choose the value it is
    // already showing, so the toggle alone could never get back to Auto there.
    const handleSetFeatured = useCallback(
        (cardId: string | null) => {
            updateDeck((d) => ({
                ...d,
                featuredCardId: toggleFeatured(d.featuredCardId, cardId),
            }));
        },
        [updateDeck]
    );

    // The card currently supplying the deck's art (pure `effectiveFeatured`):
    // the override picked this session, or the value loaded with the deck so the
    // indicator survives reloads — resolved against the live Maindeck so a
    // removed featured card falls back to the first remaining one.
    const effectiveFeaturedCardId = useMemo(
        () =>
            effectiveFeatured(
                deck.featuredCardId,
                initialDeck?.featuredCardId,
                deck.cards
            ),
        [deck.featuredCardId, deck.cards, initialDeck]
    );

    // Format is chosen at creation and immutable (ADR 0036): the select only
    // exists in create mode, so this handler is wired only when editable.
    const handleSetFormat = useCallback(
        (format: FormatId) => {
            updateDeck((d) => ({ ...d, format }));
            // Mirror it into the URL so a reload / shared link reopens on the
            // same Format — the working deck is component state, the URL is the
            // only thing that survives a remount.
            setUrlFormat(format);
        },
        [updateDeck, setUrlFormat]
    );

    // Read-only once the deck exists — editing an existing user deck or preset
    // never changes its Format (ADR 0036).
    const formatReadOnly = initialDeck !== null;

    // Cube ⇄ Format mutual exclusion. An active cube locks the Format select
    // (pinned to Freeform); a fixed non-Freeform Format (edit mode) disables the
    // cube selector — the two never apply together.
    const cubeActive = filters.cube !== "";
    const cubeDisabled = formatReadOnly && deck.format !== "freeform";

    // Defensive clear: if a fixed non-Freeform Format disables the cube (e.g. a
    // shared URL carried `?cube=` into the edit of a non-Freeform deck), drop the
    // stale cube so the search pool isn't silently restricted by a hidden filter.
    useEffect(() => {
        if (cubeDisabled && filters.cube) {
            setFilters((f) => ({ ...f, cube: "" }));
        }
    }, [cubeDisabled, filters.cube, setFilters]);

    // DB banlist override for the deck's Format (PRD #1138, issue #1144). The
    // shared `useBanlistOverride` hook skips the query for a Format with no
    // DB-backed banlist (Freeform, Alpha 40) and resolves to `undefined` while
    // loading — which `validateDeck`'s own code-const fallback below treats as
    // "no override", so nothing regresses before the query resolves or before
    // the first DB sync.
    const banlistOverride = useBanlistOverride(deck.format);

    // Live deck legality (ADR 0036, issue #512): the same pure `validateDeck`
    // the server gates on, recomputed as the working deck changes. Advisory in
    // the builder; authoritative at game start. Threads the injected DB
    // banlist override (PRD #1138, issue #1144) so a card banned via the
    // admin Scryfall sync is flagged illegal here reactively, not just at
    // game start.
    const legality = useMemo(
        () =>
            validateDeck(
                { cards: deck.cards, sideboard: deck.sideboard },
                deck.format,
                undefined,
                banlistOverride
            ),
        [deck.cards, deck.sideboard, deck.format, banlistOverride]
    );

    // `count` defaults to 1 for every EXISTING caller (the search grid's
    // one-card-at-a-time `onAdd`) and is passed explicitly by the basics bar
    // (issue #1627) so a `+5` click appends five copies in one working-deck
    // update rather than five separate ones.
    const handleAdd = useCallback(
        (cardId: string, cardName: string, count = 1) => {
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

    const handleAddSideboard = useCallback(
        (cardId: string, cardName: string) => {
            updateDeck((d) => ({
                ...d,
                sideboard: [...d.sideboard, { cardId, cardName }],
            }));
        },
        [updateDeck]
    );

    const handleRemove = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                const idx = d.cards.findIndex((c) => c.cardId === cardId);
                if (idx < 0) return d;
                const next = [...d.cards];
                next.splice(idx, 1);
                return { ...d, cards: next };
            });
        },
        [updateDeck]
    );

    /** The Add-Basic bar's remove gesture (issue #1627, PR #2320 review B1) —
     *  deliberately NOT `handleRemove` above. `handleRemove` serves the
     *  Maindeck tile click, where the user pointed at one specific card and
     *  its `cardId` is exactly right; the bar points at a SUBTYPE, and its
     *  counter counts by subtype. Constructed is where that gap bites hardest:
     *  the search grid adds by PRINT id (the edition dropdown's value), so a
     *  deck built from any printing but the catalogue's canonical one was
     *  counted by the bar and untouchable by it. */
    const handleRemoveBasic = useCallback(
        (subtype: BasicLandSubtype) => {
            updateDeck((d) => {
                const idx = findBasicLandRemovalIndex(d.cards, subtype);
                if (idx < 0) return d;
                const next = [...d.cards];
                next.splice(idx, 1);
                return { ...d, cards: next };
            });
        },
        [updateDeck]
    );

    const handleRemoveSideboard = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                const idx = d.sideboard.findIndex((c) => c.cardId === cardId);
                if (idx < 0) return d;
                const next = [...d.sideboard];
                next.splice(idx, 1);
                return { ...d, sideboard: next };
            });
        },
        [updateDeck]
    );

    const handleMoveToSideboard = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                const split = moveToSideboard(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId
                );
                return { ...d, cards: split.cards, sideboard: split.sideboard };
            });
        },
        [updateDeck]
    );

    const handleMoveToMaindeck = useCallback(
        (cardId: string) => {
            updateDeck((d) => {
                const split = moveToMaindeck(
                    { cards: d.cards, sideboard: d.sideboard },
                    cardId
                );
                return { ...d, cards: split.cards, sideboard: split.sideboard };
            });
        },
        [updateDeck]
    );

    // A Maindeck column drag records a Card Pin on the Maindeck's Layout
    // (ADR 0075 §3), which now persists with the deck (issue #1626). Pins are
    // keyed by Card ID here — four Lightning Bolts pin together, which is
    // always what a Constructed builder wants (ADR 0075 §4) — so no entry
    // carries a `pinKey` and the surface falls back to the card id.
    //
    // Withheld for a PRESET for the same reason add/rename/delete are (issue
    // #1626, PR #2318 review NB1): `presetDecks` stores no `layout`, so
    // `toPresetPayload` strips the whole thing at save. Without this the drag
    // moved the card, re-rendered it in its new Column and scheduled a save
    // that silently discarded the Pin — the one preset entry point still able
    // to record work that cannot survive the round trip. A no-op drag is a
    // visible nothing; a drag that appears to work and is thrown away is not.
    const handlePin = useCallback(
        (_cardId: string, columnId: ColumnId, pinKey: string) => {
            if (isPreset) return;
            updateMaindeckLayout((current) =>
                pinCardToColumn(current, pinKey, columnId)
            );
        },
        [updateMaindeckLayout, isPreset]
    );

    // Append an imported decklist to the working deck. Import is additive
    // (per design): resolved copies are pushed onto the existing Maindeck and
    // Sideboard; unresolved lines were already surfaced by the dialog.
    const handleImport = useCallback(
        (parsed: ParsedDecklist) => {
            updateDeck((d) => ({
                ...d,
                cards: [...d.cards, ...parsed.cards],
                sideboard: [...d.sideboard, ...parsed.sideboard],
            }));
        },
        [updateDeck]
    );

    const handleDone = useCallback(async () => {
        const identity = await flush();
        onClose(identity);
    }, [flush, onClose]);

    const toggleColor = useCallback(
        (color: string) => {
            setFilters((f) => ({
                ...f,
                colors: f.colors.includes(color)
                    ? f.colors.filter((c) => c !== color)
                    : [...f.colors, color],
            }));
        },
        [setFilters]
    );

    const toggleColorless = useCallback(() => {
        setFilters((f) => ({ ...f, includeColorless: !f.includeColorless }));
    }, [setFilters]);

    const setColorMode = useCallback(
        (colorMode: ColorMode) => {
            setFilters((f) => ({ ...f, colorMode }));
        },
        [setFilters]
    );

    const toggleType = useCallback(
        (type: string) => {
            setFilters((f) => ({
                ...f,
                types: f.types.includes(type)
                    ? f.types.filter((t) => t !== type)
                    : [...f.types, type],
            }));
        },
        [setFilters]
    );

    const setTypeMode = useCallback(
        (typeMode: MatchMode) => {
            setFilters((f) => ({ ...f, typeMode }));
        },
        [setFilters]
    );

    const toggleManaValue = useCallback(
        (value: number) => {
            setFilters((f) => ({
                ...f,
                manaValues: f.manaValues.includes(value)
                    ? f.manaValues.filter((v) => v !== value)
                    : [...f.manaValues, value],
            }));
        },
        [setFilters]
    );

    const toggleSet = useCallback(
        (setCode: string) => {
            setFilters((f) => ({
                ...f,
                sets: f.sets.includes(setCode)
                    ? f.sets.filter((s) => s !== setCode)
                    : [...f.sets, setCode],
            }));
        },
        [setFilters]
    );

    const setSetMode = useCallback(
        (setMode: MatchMode) => {
            setFilters((f) => ({ ...f, setMode }));
        },
        [setFilters]
    );

    // Cube and Format are mutually exclusive discovery scopes (they sit side by
    // side above). Selecting a cube pins the deck's Format to Freeform so the
    // cube is the sole search scope with no set/legality constraint layered on
    // top; clearing the cube frees the Format select again. The `freeform` guard
    // keeps this a no-op for an already-Freeform deck, so it never mutates an
    // immutable non-Freeform Format in edit mode (that path is unreachable — the
    // selector is disabled there — but the guard makes it safe by construction).
    const handleSetCube = useCallback(
        (cube: string) => {
            // One write: the cube and the forced Format land in the same
            // navigation, so neither clobbers the other.
            updateSearch({
                filters: (f) => ({ ...f, cube }),
                format: cube ? "freeform" : undefined,
            });
            if (cube) {
                updateDeck((d) =>
                    d.format === "freeform" ? d : { ...d, format: "freeform" }
                );
            }
        },
        [updateSearch, updateDeck]
    );

    const setSort = useCallback(
        (sort: SortKey) => {
            setFilters((f) => ({ ...f, sort }));
        },
        [setFilters]
    );

    const setSortDirection = useCallback(
        (sortDirection: SortDirection) => {
            setFilters((f) => ({ ...f, sortDirection }));
        },
        [setFilters]
    );

    const toggleHideUnavailable = useCallback(() => {
        setFilters((f) => ({
            ...f,
            hideUnavailable: !f.hideUnavailable,
        }));
    }, [setFilters]);

    const toggleShowTokens = useCallback(() => {
        setFilters((f) => ({
            ...f,
            showTokens: !f.showTokens,
        }));
    }, [setFilters]);

    // Typing only touches local state — the box never stutters. The debounced
    // value is the one that reaches the filter/URL (effect below).
    const setText = useCallback((text: string) => {
        setRawText(text);
    }, []);

    // Propagate the settled (debounced) query into the URL-backed filter set,
    // which in turn drives the filter pass and `encodeFilters`. Guarded so an
    // unchanged value doesn't re-navigate.
    useEffect(() => {
        setFilters((f) =>
            f.text === debouncedText ? f : { ...f, text: debouncedText }
        );
    }, [debouncedText, setFilters]);

    // Per-zone card zoom (MTGO-style). Each zone's current density is its floor;
    // the default sits slightly above so cards start a touch larger.
    // The Maindeck/Sideboard zoom zones ("main"/"side") live inside the shell's
    // `DeckZonesSurface` — one slider per zone, same localStorage keys.
    const resultsZoom = useCardZoom({
        zone: "results",
        min: 0.75,
        max: 1.8,
        initial: 0.95,
    });

    // The Column Layout engine's catalogue lookup. A Tabletop deck's
    // catalogue-only cards (ADR 0080) resolve through the shape resolver into a
    // synthetic definition, so they still bucket by Mana Value instead of
    // falling into the Catch-All; `nameOf` keeps the deck row's own name as the
    // in-column sort key, exactly as the retired pile grouping did.
    const cardLookup = useMemo(() => {
        const names = new Map<string, string>();
        for (const card of deck.cards) names.set(card.cardId, card.cardName);
        for (const card of deck.sideboard)
            names.set(card.cardId, card.cardName);
        return deckCardLookup(resolveShape, (id) => names.get(id));
    }, [resolveShape, deck.cards, deck.sideboard]);

    // The basics bar, shared with the Limited builder (ADR 0075, issue
    // #1627 — "the basics bar ships in BOTH builders"). Constructed has no
    // Pool, so every subtype resolves straight to the catalogue's canonical
    // printing rather than through a Pool-preference tier; the count is read
    // off the live Maindeck exactly like the Limited variant's.
    //
    // The user's basic-land art preference (issue #1629, ADR 0075 § "Basic-
    // land art") is held here, seeded from `localStorage` on mount and
    // updated on every pick — mirrors `mainView`/`sideView`'s
    // `seededColumnView`/`recordGroupingChange` split above. Layered on top
    // of the base resolution by `applyBasicLandArtPreference`, which silently
    // ignores a stale or now-illegal stored printing (AC8).
    const [basicLandArt, setBasicLandArt] = useState(() =>
        seededBasicLandArt()
    );
    const basicCardIds = useMemo(
        () =>
            applyBasicLandArtPreference(
                resolveCanonicalBasicLandCardIds(),
                basicLandArt,
                FORMAT_RULES[deck.format].allowedSets
            ),
        [basicLandArt, deck.format]
    );
    const basicCounts = useMemo(
        () => countBasicLandCopies(deck.cards),
        [deck.cards]
    );

    /** A printing was picked from a subtype's art grid (issue #1629): persist
     *  the preference, hold it so the bar/picker reflect it immediately, and
     *  rewrite every copy already in the open deck — Maindeck AND Sideboard
     *  — to the new printing. Never touches any other saved deck: this only
     *  edits the in-memory working deck, which rides the same debounced
     *  autosave as any other card edit.
     *
     *  A Card Pin recorded against one of the rewritten copies rides along in
     *  the SAME edit (review of PR #2325, finding F1): Constructed pins by
     *  `cardId` (`deck-zone-surface.tsx`'s `card.pinKey ?? card.cardId`), and
     *  a Basic land entry carries no `pinKey` of its own, so its Pin key IS
     *  its `cardId` — changing that id therefore changes the Pin's key, not
     *  just its content. `basicLandArtCardIdsToRemap` names every OLD id
     *  about to disappear; `remapPinKeys` re-homes any Pin recorded under one
     *  of them onto the new `printId`, in both Zones' Layouts, so the deck
     *  row never persists an orphaned key. */
    const handlePickBasicArt = useCallback(
        (subtype: BasicLandSubtype, printId: string) => {
            recordBasicLandArtChoice(subtype, printId);
            setBasicLandArt((prev) => ({ ...prev, [subtype]: printId }));
            const rewritten = rewriteBasicLandArtInDeck(deck, subtype, printId);
            if (
                rewritten.cards === deck.cards &&
                rewritten.sideboard === deck.sideboard
            ) {
                // N1 (review of PR #2325): re-picking the art already in
                // effect, or picking art for a subtype this deck holds zero
                // copies of — nothing to rewrite, so skip `updateDeck`
                // entirely rather than scheduling a debounced save of
                // byte-identical content (`useDeckWorkspace`'s `schedule` has
                // no no-op guard of its own — it fires on every call). This
                // pre-check has to read the render-closure `deck` — it is
                // what decides whether `updateDeck` runs at all, so there is
                // no `d` yet to read instead.
                return;
            }
            // Everything from here on reads ONLY the updater's `d` (review of
            // PR #2325, note N4) — never the render-closure `deck` above —
            // so the edit is self-consistent under a concurrent update,
            // matching `updateMaindeckLayout`'s own pattern.
            updateDeck((d) => {
                const staleCardIds = basicLandArtCardIdsToRemap(
                    [...d.cards, ...d.sideboard],
                    subtype,
                    printId
                );
                const currentLayout = fromStoredDeckColumnLayout(d.layout, {
                    maindeck: mainView,
                    sideboard: sideView,
                });
                const remappedMaindeck = remapPinKeys(
                    currentLayout.maindeck,
                    staleCardIds,
                    printId
                );
                const remappedSideboard = remapPinKeys(
                    currentLayout.sideboard,
                    staleCardIds,
                    printId
                );
                // N3 (review of PR #2325): only touch `d.layout` for a Zone
                // whose remap actually changed something (`remapPinKeys`
                // returns the SAME reference when no stale key carried a
                // Pin) — otherwise `storeZoneLayout`'s own "always an
                // object, `{}` included" contract would materialise an empty
                // arrangement onto a deck that was never arranged.
                let layout = d.layout;
                if (remappedMaindeck !== currentLayout.maindeck) {
                    layout = storeZoneLayout(
                        layout,
                        "maindeck",
                        remappedMaindeck
                    );
                }
                if (remappedSideboard !== currentLayout.sideboard) {
                    layout = storeZoneLayout(
                        layout,
                        "sideboard",
                        remappedSideboard
                    );
                }
                return {
                    ...d,
                    ...rewriteBasicLandArtInDeck(d, subtype, printId),
                    layout,
                };
            });
        },
        [updateDeck, deck, mainView, sideView]
    );

    return (
        <DeckBuilderShell
            title={
                isPreset
                    ? mode === "create"
                        ? "New Preset"
                        : "Edit Preset"
                    : initialDeck
                      ? "Edit Deck"
                      : "New Deck"
            }
            onDone={() => void handleDone()}
            manager={manager}
            basicsBar={
                <PoolBasicLandsBar
                    cardIdsBySubtype={basicCardIds}
                    counts={basicCounts}
                    onAdd={handleAdd}
                    onRemove={handleRemoveBasic}
                    allowedSets={FORMAT_RULES[deck.format].allowedSets}
                    onPickArt={handlePickBasicArt}
                    disabled={saving}
                />
            }
            headerActions={
                <>
                    {isPreset && initialIdentity && (
                        <span
                            className="rounded-sm border border-border-subtle/40 bg-surface/60 px-2 py-1 font-mono text-xs text-text-muted"
                            title="Slug is read-only and never changes on rename"
                        >
                            slug: {initialIdentity}
                        </span>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImportOpen(true)}
                    >
                        Import
                    </Button>
                    <DeckExportButton
                        deck={{
                            cards: deck.cards,
                            sideboard: deck.sideboard,
                        }}
                    />
                    <FormatSelect
                        value={deck.format}
                        readOnly={formatReadOnly || cubeActive}
                        lockedReason={
                            cubeActive && !formatReadOnly
                                ? "Format is forced to Freeform while a cube is selected"
                                : undefined
                        }
                        onChange={handleSetFormat}
                    />
                    <CubeFilter
                        value={filters.cube}
                        onChange={handleSetCube}
                        disabled={cubeDisabled}
                    />
                    <DeckBanlistPanel format={deck.format} />
                    <SearchBar value={rawText} onChange={setText} />
                    <DeckStatsButton mainCards={deck.cards} />
                </>
            }
            headerFilters={
                <>
                    <ColorFilter
                        selectedColors={filters.colors}
                        includeColorless={filters.includeColorless}
                        mode={filters.colorMode}
                        onToggleColor={toggleColor}
                        onToggleColorless={toggleColorless}
                        onChangeMode={setColorMode}
                    />
                    <TypeFilter
                        selected={filters.types}
                        onToggle={toggleType}
                        mode={filters.typeMode}
                        onChangeMode={setTypeMode}
                    />
                    <SetFilter
                        selected={filters.sets}
                        onToggle={toggleSet}
                        mode={filters.setMode}
                        onChangeMode={setSetMode}
                    />
                    <ManaValueFilter
                        selected={filters.manaValues}
                        onToggle={toggleManaValue}
                    />
                    <SortSelect
                        value={filters.sort}
                        onChange={setSort}
                        direction={filters.sortDirection}
                        onDirectionChange={setSortDirection}
                    />
                    {deck.format !== "manual" && fullCatalogue?.rows && (
                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={filters.hideUnavailable}
                                onChange={toggleHideUnavailable}
                                className="size-4 accent-accent"
                            />
                            <span className="text-text-muted">
                                Hide unavailable
                            </span>
                        </label>
                    )}
                    {deck.format === "manual" && fullCatalogue?.rows && (
                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={filters.showTokens}
                                onChange={toggleShowTokens}
                                className="size-4 accent-accent"
                            />
                            <span className="text-text-muted">Tokens</span>
                        </label>
                    )}
                    <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
                        <span className="tracking-wide">Results</span>
                        <CardZoomSlider
                            value={resultsZoom.value}
                            min={resultsZoom.min}
                            max={resultsZoom.max}
                            onChange={resultsZoom.set}
                            label="Results card size"
                        />
                    </div>
                </>
            }
            sourcePanel={{
                // The pane's tab (issue #2584): one short word plus the live
                // result count. Dropping a deck card on this tab is what
                // removes it from the deck on a phone, now that a tap opens
                // the Peek Panel instead of removing.
                label: "Search",
                count: entries?.length ?? 0,
                content: (
                    <div style={zoomVars(resultsZoom.value)}>
                        <ResultsGrid
                            entries={entries}
                            idle={idle}
                            activeSets={filters.sets}
                            enforceAvailability={deck.format !== "manual"}
                            onAdd={handleAdd}
                        />
                    </div>
                ),
            }}
            mainCards={deck.cards}
            sideCards={deck.sideboard}
            layout={layout}
            lookup={cardLookup}
            view={VIEW}
            zones={{
                mainEmptyMessage: "Click or drag cards here to add them.",
                sideEmptyMessage: "Drag cards here to keep them aside (0–15).",
                sideCountSuffix: `/${SIDEBOARD_LIMIT}`,
                sideWarning:
                    deck.sideboard.length > SIDEBOARD_LIMIT
                        ? "over limit"
                        : null,
            }}
            actions={{
                onAddToMaindeck: handleAdd,
                onAddToSideboard: handleAddSideboard,
                onMoveToSideboard: handleMoveToSideboard,
                onMoveToMaindeck: handleMoveToMaindeck,
                onPin: handlePin,
                // Dropping a deck card on the Search tab (issue #2584) — it
                // leaves the deck entirely, the drag analogue of the tap that
                // used to remove it.
                onRemoveFromDeck: (cardId, zone) =>
                    zone === "maindeck"
                        ? handleRemove(cardId)
                        : handleRemoveSideboard(cardId),
                onMainCardClick: (card) => handleRemove(card.cardId),
                onSideCardClick: (card) => handleRemoveSideboard(card.cardId),
                onMainGroupingChange: handleMainGroupingChange,
                onSideGroupingChange: handleSideGroupingChange,
                onMainOrderingChange: handleMainOrderingChange,
                onSideOrderingChange: handleSideOrderingChange,
                // Manual-Column management, Maindeck only (issue #1626) — a
                // preset row stores no layout, so the affordances that would
                // silently lose their work are not offered there.
                onAddColumn: isPreset ? undefined : handleAddColumn,
                onRenameColumn: isPreset ? undefined : handleRenameColumn,
                onDeleteColumn: isPreset ? undefined : handleDeleteColumn,
            }}
            featured={{
                cardId: effectiveFeaturedCardId,
                // The stored OVERRIDE, not the resolved value: the deck-detail
                // picker shows `Auto` while there is none, and `Auto` is a
                // real state (the art follows the first Maindeck card as the
                // deck changes) rather than a synonym for whichever card
                // happens to be first right now.
                explicitCardId: deck.featuredCardId,
                onSet: handleSetFeatured,
            }}
            legality={{
                formatLabel: FORMAT_RULES[deck.format].label,
                isLegal: legality.isLegal,
                reasons: legality.reasons,
            }}
            saveBar={{
                name: deck.name,
                cardCount: deck.cards.length,
                onChangeName: setName,
                onDelete: onDelete ? () => setConfirmDelete(true) : undefined,
            }}
            overlays={
                <>
                    <DeckImportDialog
                        open={importOpen}
                        onOpenChange={setImportOpen}
                        format={deck.format}
                        resolveCatalogueName={resolveCatalogueName}
                        onImport={handleImport}
                    />

                    <GameDialog
                        open={confirmDelete}
                        onOpenChange={setConfirmDelete}
                        title={`Delete "${deck.name}"?`}
                        subtitle="This action cannot be undone."
                    >
                        <div className="flex justify-end gap-2 mt-4">
                            <ActionButton
                                onClick={() => setConfirmDelete(false)}
                                label="Cancel"
                                tone="secondary"
                            />
                            <ActionButton
                                onClick={() => {
                                    setConfirmDelete(false);
                                    void onDelete?.();
                                }}
                                label="Delete"
                                tone="destructive"
                            />
                        </div>
                    </GameDialog>
                </>
            }
        />
    );
}
