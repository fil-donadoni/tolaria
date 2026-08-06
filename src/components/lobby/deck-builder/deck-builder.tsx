import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragDropManager } from "@dnd-kit/dom";
import {
    createDeckColumnLayout,
    pinCardToColumn,
    type ColumnId,
    type DeckColumnLayout,
} from "@convex/deckLayout";
import { effectiveFeatured, toggleFeatured } from "~/lib/featuredPicker";
import { computeDeckColors } from "~/lib/deckColors";
import { deckCardLookup, makeDeckCardShapeResolver } from "~/lib/deckCardShape";
import DeckBuilderShell from "~/components/deckbuilder/deck-builder-shell";
import type { DeckBuilderViewSpec } from "~/components/deckbuilder/deckBuilderVariant";
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
            }),
        [kind, mode, sinks, fullCatalogue?.rows]
    );

    const { deck, updateDeck, setName, flush } = useDeckWorkspace({
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
                  }
                : {
                      name: nextDeckName(initialDeckList),
                      format: defaultFormat,
                      cards: [],
                      sideboard: [],
                      featuredCardId: undefined,
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

    // The deck's Column Layout (ADR 0075, issue #1622). Grouping is pinned to
    // Mana Value in this slice — there is no user-facing control yet — so the
    // only thing that changes here is the Card Pin map a column drag records.
    // Held in the WORKING deck, not persisted: `userDecks.layout` lands in a
    // later slice of PRD #1617, so a pin survives re-render (and every other
    // edit to the deck) but not a reload.
    const [layout, setLayout] = useState<DeckColumnLayout>(() =>
        createDeckColumnLayout()
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
    // A re-click on the already-featured card clears the override, reverting to
    // the first-Maindeck-card default (User Story 13).
    const handleSetFeatured = useCallback(
        (cardId: string) => {
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

    const handleAdd = useCallback(
        (cardId: string, cardName: string) => {
            updateDeck((d) => ({
                ...d,
                cards: [...d.cards, { cardId, cardName }],
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
    // (ADR 0075 §3). Pins are keyed by Card ID here — four Lightning Bolts pin
    // together, which is always what a Constructed builder wants (ADR 0075 §4).
    const handlePin = useCallback((cardId: string, columnId: ColumnId) => {
        setLayout((current) => ({
            ...current,
            maindeck: pinCardToColumn(current.maindeck, cardId, columnId),
        }));
    }, []);

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
            sourcePanel={
                <div style={zoomVars(resultsZoom.value)}>
                    <ResultsGrid
                        entries={entries}
                        idle={idle}
                        activeSets={filters.sets}
                        enforceAvailability={deck.format !== "manual"}
                        onAdd={handleAdd}
                    />
                </div>
            }
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
                onMainCardClick: (card) => handleRemove(card.cardId),
                onSideCardClick: (card) => handleRemoveSideboard(card.cardId),
            }}
            featured={{
                cardId: effectiveFeaturedCardId,
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
