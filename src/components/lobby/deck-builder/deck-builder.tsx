import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DragDropProvider,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
} from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { effectiveFeatured, toggleFeatured } from "~/lib/featuredPicker";
import { computeDeckColors } from "~/lib/deckColors";
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
import type { DeckCard } from "~/types/game";
import type { ParsedDecklist } from "~/lib/deckImport";
import CardImage from "~/components/cards/card-image";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import CardZoomSlider from "./card-zoom-slider";
import ColorFilter from "./color-filter";
import DeckExportButton from "./deck-export-button";
import DeckImportDialog from "./deck-import-dialog";
import DeckPileArea from "./deck-pile-area";
import type { CardDragData, DropZoneId } from "./dnd-types";
import ManaValueFilter from "./mana-value-filter";
import ResultsGrid from "./results-grid";
import SaveDeckBar from "./save-deck-bar";
import SearchBar from "./search-bar";
import FormatSelect from "./format-select";
import DeckBanlistPanel from "./deck-banlist-panel";
import SetFilter from "./set-filter";
import TypeFilter from "./type-filter";
import DeckLegalityPanel from "./deck-legality-panel";
import { useCardZoom } from "./useCardZoom";
import { useFilterSearchParams } from "./useFilterSearchParams";
import { type ColorMode, type MatchMode, useCardSearch } from "./useCardSearch";
import { useDebouncedValue } from "~/hooks/useDebouncedValue";

// Responsive base card width; per-zone zoom multiplies it.
const CARD_BASE = "min(8rem, 18vw, 9.5dvh)";

// Per-zone CSS vars driving `--card-w` / `--card-h` from a zoom multiplier.
function zoomVars(mult: number): React.CSSProperties {
    return {
        "--card-w": `calc(${CARD_BASE} * ${mult})`,
        "--card-h": `calc(${CARD_BASE} * ${mult} * 7 / 5)`,
    } as React.CSSProperties;
}

interface WorkingDeck {
    name: string;
    format: FormatId;
    colors: string[];
    cards: DeckCard[];
    sideboard: DeckCard[];
    // Featured Card override (PRD #589, issue #599). The Card ID the player
    // picked to supply the deck's art, or `undefined` to let the resolver
    // default to the first Maindeck card. Persisted via the existing deck
    // update mutation (admin-gated for presets, ADR 0033).
    featuredCardId?: string;
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
    onClose: (savedDeckId: string | null) => void;
    onDelete?: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 800;
// Trailing-edge delay before a search keystroke feeds the filter pass + URL
// (PRD #501, issue #503). Tuned for feel; the input itself stays responsive.
const SEARCH_DEBOUNCE_MS = 180;
const DEFAULT_FORMAT: FormatId = "freeform";

export default function DeckBuilder({
    kind,
    mode = "edit",
    defaultFormat = DEFAULT_FORMAT,
    initialDeck,
    initialIdentity,
    initialDeckList,
    sinks,
    onClose,
    onDelete,
}: DeckBuilderProps) {
    const isPreset = kind === "preset";
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [deck, setDeck] = useState<WorkingDeck>(() =>
        initialDeck
            ? {
                  name: initialDeck.name,
                  format: initialDeck.format,
                  colors: initialDeck.colors,
                  cards: initialDeck.cards,
                  sideboard: initialDeck.sideboard ?? [],
                  // The override is seeded `undefined` so an unchanged save
                  // leaves the stored value untouched (the update mutation skips
                  // an absent `featuredCardId`). The currently-featured card is
                  // still shown via the resolved `initialDeck.featuredCardId`
                  // (see `effectiveFeaturedCardId`), so it survives reloads.
                  featuredCardId: undefined,
              }
            : {
                  name: nextDeckName(initialDeckList),
                  format: defaultFormat,
                  colors: [],
                  cards: [],
                  sideboard: [],
                  featuredCardId: undefined,
              }
    );
    const [filters, setFilters] = useFilterSearchParams();

    // The search box is a responsive local value; only its debounced form feeds
    // the filter pass + URL encoding, so neither runs per keystroke (issue #503).
    // Seeded once from the URL so a shared link's query pre-fills the box.
    const [rawText, setRawText] = useState(() => filters.text);
    const debouncedText = useDebouncedValue(rawText, SEARCH_DEBOUNCE_MS);

    // Current persisted identity: a userDeckId once a user deck is created, or
    // the preset slug in preset mode. Null only for a brand-new user deck
    // before its first flush.
    const identityRef = useRef<string | null>(initialIdentity);
    const pendingRef = useRef<WorkingDeck | null>(null);
    const timerRef = useRef<number | null>(null);
    const inflightRef = useRef<Promise<unknown> | null>(null);

    // The card search is pre-filtered to the deck's Format allowed sets (issue
    // #514): the builder only surfaces legally-includable prints. Discovery
    // only — the authoritative legality check is `validateDeck`.
    const { entries, idle } = useCardSearch(filters, deck.format);

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
        // The dispatch maps `kind` + current identity to the correct mutation
        // pair (userDecks create-then-update vs decks.updatePreset by slug) and
        // returns the resulting identity. The editor never branches on `kind`.
        const save = dispatchDeckSave(kind, sinks, identityRef.current, mode);
        const promise = save({
            name: pending.name,
            format: pending.format,
            colors: pending.colors,
            cards: pending.cards,
            sideboard: pending.sideboard,
            featuredCardId: pending.featuredCardId,
        });
        inflightRef.current = promise;
        try {
            identityRef.current = await promise;
        } finally {
            inflightRef.current = null;
        }
    }, [kind, mode, sinks]);

    const schedule = useCallback(
        (next: WorkingDeck) => {
            const shouldPersist =
                next.cards.length > 0 ||
                next.sideboard.length > 0 ||
                identityRef.current !== null;
            if (!shouldPersist) {
                pendingRef.current = null;
                clearTimer();
                return;
            }
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
        (updater: (deck: WorkingDeck) => WorkingDeck) => {
            setDeck((current) => {
                const updated = updater(current);
                const next: WorkingDeck = {
                    ...updated,
                    colors: computeDeckColors(updated.cards),
                };
                schedule(next);
                return next;
            });
        },
        [schedule]
    );

    const handleSetName = useCallback(
        (name: string) => {
            updateDeck((d) => ({ ...d, name }));
        },
        [updateDeck]
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
        },
        [updateDeck]
    );

    // Read-only once the deck exists — editing an existing user deck or preset
    // never changes its Format (ADR 0036).
    const formatReadOnly = initialDeck !== null;

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
        await flush();
        onClose(identityRef.current);
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
        (mode: ColorMode) => {
            setFilters((f) => ({ ...f, colorMode: mode }));
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
        (mode: MatchMode) => {
            setFilters((f) => ({ ...f, typeMode: mode }));
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
        (mode: MatchMode) => {
            setFilters((f) => ({ ...f, setMode: mode }));
        },
        [setFilters]
    );

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
    const resultsZoom = useCardZoom({
        zone: "results",
        min: 0.75,
        max: 1.8,
        initial: 0.95,
    });
    const mainZoom = useCardZoom({
        zone: "main",
        min: 1,
        max: 2.2,
        initial: 1.25,
    });
    const sideZoom = useCardZoom({
        zone: "side",
        min: 1,
        max: 2.2,
        initial: 1.25,
    });

    // Touch drag waits ~250ms so a quick swipe still scrolls the list and only a
    // deliberate hold-then-move starts a drag (under the 400ms long-press preview
    // threshold, so the two never collide). Mouse drag starts after a small move.
    const sensors = useMemo(
        () => [
            PointerSensor.configure({
                activationConstraints: (event: PointerEvent) =>
                    event.pointerType === "touch"
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
            if (data.kind === "result") {
                if (dest === "side")
                    handleAddSideboard(data.cardId, data.cardName);
                else handleAdd(data.cardId, data.cardName);
            } else if (data.kind === "main" && dest === "side") {
                handleMoveToSideboard(data.cardId);
            } else if (data.kind === "side" && dest === "main") {
                handleMoveToMaindeck(data.cardId);
            }
        },
        [
            handleAdd,
            handleAddSideboard,
            handleMoveToSideboard,
            handleMoveToMaindeck,
        ]
    );

    return (
        <div
            className="flex h-dvh flex-col bg-surface-base text-text"
            style={{ "--card-base": CARD_BASE } as React.CSSProperties}
        >
            <DragDropProvider sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="flex flex-col gap-3 border-b border-border-subtle/30 bg-surface/60 px-4 py-3 md:px-6">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => void handleDone()}
                                className="btn-base btn-tone-ghost px-3 py-1.5 text-sm"
                            >
                                ← Back
                            </button>
                            <h1 className="text-lg font-semibold font-beleren tracking-wide text-parchment">
                                {isPreset
                                    ? mode === "create"
                                        ? "New Preset"
                                        : "Edit Preset"
                                    : initialDeck
                                      ? "Edit Deck"
                                      : "New Deck"}
                            </h1>
                            {isPreset && initialIdentity && (
                                <span
                                    className="rounded-sm border border-border-subtle/40 bg-surface/60 px-2 py-1 font-mono text-xs text-text-muted"
                                    title="Slug is read-only and never changes on rename"
                                >
                                    slug: {initialIdentity}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => setImportOpen(true)}
                                className="btn-base btn-tone-ghost px-3 py-1.5 text-sm"
                            >
                                Import
                            </button>
                            <DeckExportButton
                                deck={{
                                    cards: deck.cards,
                                    sideboard: deck.sideboard,
                                }}
                            />
                            <FormatSelect
                                value={deck.format}
                                readOnly={formatReadOnly}
                                onChange={handleSetFormat}
                            />
                            <DeckBanlistPanel format={deck.format} />
                        </div>
                        <SearchBar value={rawText} onChange={setText} />
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
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
                    </div>
                </div>

                <div className="grid flex-1 grid-rows-[1fr_1fr] overflow-hidden">
                    <div
                        className="overflow-y-auto border-b border-border-subtle/30"
                        style={zoomVars(resultsZoom.value)}
                    >
                        <ResultsGrid
                            entries={entries}
                            idle={idle}
                            activeSets={filters.sets}
                            onAdd={handleAdd}
                        />
                    </div>
                    <div className="flex min-h-0 divide-x divide-border-subtle/30 overflow-hidden">
                        <div
                            className="h-full w-3/4 overflow-hidden"
                            style={zoomVars(mainZoom.value)}
                        >
                            <DeckPileArea
                                title="Maindeck"
                                zone="main"
                                grouped
                                cards={deck.cards}
                                onRemove={handleRemove}
                                featuredCardId={effectiveFeaturedCardId}
                                onSetFeatured={handleSetFeatured}
                                emptyMessage="Click or drag cards here to add them."
                                headerRight={
                                    <CardZoomSlider
                                        value={mainZoom.value}
                                        min={mainZoom.min}
                                        max={mainZoom.max}
                                        onChange={mainZoom.set}
                                        label="Maindeck card size"
                                    />
                                }
                            />
                        </div>
                        <div
                            className="h-full w-1/4 overflow-hidden"
                            style={zoomVars(sideZoom.value)}
                        >
                            <DeckPileArea
                                title="Sideboard"
                                zone="side"
                                grouped={false}
                                cards={deck.sideboard}
                                onRemove={handleRemoveSideboard}
                                countSuffix={`/${SIDEBOARD_LIMIT}`}
                                warning={
                                    deck.sideboard.length > SIDEBOARD_LIMIT
                                        ? "over limit"
                                        : null
                                }
                                emptyMessage="Drag cards here to keep them aside (0–15)."
                                headerRight={
                                    <CardZoomSlider
                                        value={sideZoom.value}
                                        min={sideZoom.min}
                                        max={sideZoom.max}
                                        onChange={sideZoom.set}
                                        label="Sideboard card size"
                                    />
                                }
                            />
                        </div>
                    </div>
                </div>

                <DragOverlay dropAnimation={null}>
                    {(source) => {
                        const d = source.data as CardDragData;
                        return (
                            <div
                                className="aspect-5/7"
                                style={{
                                    width: `calc(${CARD_BASE} * 1.1)`,
                                }}
                            >
                                <CardImage card={{ id: d.cardId }} />
                            </div>
                        );
                    }}
                </DragOverlay>
            </DragDropProvider>

            <DeckLegalityPanel
                formatLabel={FORMAT_RULES[deck.format].label}
                isLegal={legality.isLegal}
                reasons={legality.reasons}
            />

            <SaveDeckBar
                name={deck.name}
                onChangeName={handleSetName}
                onDone={() => void handleDone()}
                onDelete={onDelete ? () => setConfirmDelete(true) : undefined}
                cardCount={deck.cards.length}
            />

            <DeckImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                format={deck.format}
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
        </div>
    );
}
