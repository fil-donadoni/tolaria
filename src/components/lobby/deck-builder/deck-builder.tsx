import { useCallback, useEffect, useRef, useState } from "react";
import { getCardById } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import type { Id } from "@convex/_generated/dataModel";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import { type UserLobbyDeck } from "~/lib/deckTypes";
import { nextDeckName } from "~/lib/userDecks";
import type { DeckCard } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import ColorFilter from "./color-filter";
import DeckPileArea from "./deck-pile-area";
import ManaValueFilter from "./mana-value-filter";
import ResultsGrid from "./results-grid";
import SaveDeckBar from "./save-deck-bar";
import SearchBar from "./search-bar";
import SubtypeCombobox from "./subtype-combobox";
import TypeFilter from "./type-filter";
import {
    DEFAULT_FILTERS,
    type CardSearchFilters,
    type ColorMode,
    useCardSearch,
} from "./useCardSearch";

interface WorkingDeck {
    name: string;
    format: string;
    colors: string[];
    cards: DeckCard[];
}

interface DeckBuilderProps {
    initialDeck: UserLobbyDeck | null;
    initialDeckList: UserLobbyDeck[];
    onClose: (savedDeckId: string | null) => void;
    onDelete?: () => Promise<void>;
}

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;
const SAVE_DEBOUNCE_MS = 800;
const DEFAULT_FORMAT = "Freeform";

function computeDeckColors(cards: DeckCard[]): string[] {
    const set = new Set<string>();
    for (const card of cards) {
        try {
            const def = getCardById(card.cardId);
            for (const color of getCardColors(def)) set.add(color);
        } catch {
            // ignore — card may have been removed from the registry
        }
    }
    return COLOR_ORDER.filter((c) => set.has(c));
}

export default function DeckBuilder({
    initialDeck,
    initialDeckList,
    onClose,
    onDelete,
}: DeckBuilderProps) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deck, setDeck] = useState<WorkingDeck>(
        () =>
            initialDeck ?? {
                name: nextDeckName(initialDeckList),
                format: DEFAULT_FORMAT,
                colors: [],
                cards: [],
            }
    );
    const [filters, setFilters] = useState<CardSearchFilters>(DEFAULT_FILTERS);

    const { create, update } = useUserDeckMutations();
    const userDeckIdRef = useRef<Id<"userDecks"> | null>(
        initialDeck?.userDeckId ?? null
    );
    const pendingRef = useRef<WorkingDeck | null>(null);
    const timerRef = useRef<number | null>(null);
    const inflightRef = useRef<Promise<unknown> | null>(null);

    const { entries, idle } = useCardSearch(filters);

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
        if (userDeckIdRef.current === null) {
            const promise = create({
                name: pending.name,
                format: pending.format,
                colors: pending.colors,
                cards: pending.cards,
            });
            inflightRef.current = promise;
            try {
                userDeckIdRef.current = await promise;
            } finally {
                inflightRef.current = null;
            }
        } else {
            const promise = update({
                id: userDeckIdRef.current,
                patch: {
                    name: pending.name,
                    format: pending.format,
                    colors: pending.colors,
                    cards: pending.cards,
                },
            });
            inflightRef.current = promise;
            try {
                await promise;
            } finally {
                inflightRef.current = null;
            }
        }
    }, [create, update]);

    const schedule = useCallback(
        (next: WorkingDeck) => {
            const shouldPersist =
                next.cards.length > 0 || userDeckIdRef.current !== null;
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

    const handleAdd = useCallback(
        (cardId: string, cardName: string) => {
            updateDeck((d) => ({
                ...d,
                cards: [...d.cards, { cardId, cardName }],
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

    const handleDone = useCallback(async () => {
        await flush();
        onClose(userDeckIdRef.current);
    }, [flush, onClose]);

    const toggleColor = useCallback((color: string) => {
        setFilters((f) => ({
            ...f,
            colors: f.colors.includes(color)
                ? f.colors.filter((c) => c !== color)
                : [...f.colors, color],
        }));
    }, []);

    const toggleColorless = useCallback(() => {
        setFilters((f) => ({ ...f, includeColorless: !f.includeColorless }));
    }, []);

    const setColorMode = useCallback((mode: ColorMode) => {
        setFilters((f) => ({ ...f, colorMode: mode }));
    }, []);

    const toggleType = useCallback((type: string) => {
        setFilters((f) => ({
            ...f,
            types: f.types.includes(type)
                ? f.types.filter((t) => t !== type)
                : [...f.types, type],
        }));
    }, []);

    const toggleManaValue = useCallback((value: number) => {
        setFilters((f) => ({
            ...f,
            manaValues: f.manaValues.includes(value)
                ? f.manaValues.filter((v) => v !== value)
                : [...f.manaValues, value],
        }));
    }, []);

    const setText = useCallback((text: string) => {
        setFilters((f) => ({ ...f, text }));
    }, []);

    return (
        <div
            className="flex h-dvh flex-col bg-surface-base text-text"
            style={
                {
                    "--card-w": "min(8rem, 18vw, 9.5dvh)",
                    "--card-h": "calc(min(8rem, 18vw, 9.5dvh) * 7 / 5)",
                    "--card-w-sm": "calc(min(8rem, 18vw, 9.5dvh) * 0.75)",
                } as React.CSSProperties
            }
        >
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
                            {initialDeck ? "Edit Deck" : "New Deck"}
                        </h1>
                    </div>
                    <SearchBar value={filters.text} onChange={setText} />
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
                    />
                    <SubtypeCombobox
                        selected={filters.types}
                        onToggle={toggleType}
                    />
                    <ManaValueFilter
                        selected={filters.manaValues}
                        onToggle={toggleManaValue}
                    />
                </div>
            </div>

            <div className="grid flex-1 grid-rows-2 overflow-hidden">
                <div className="overflow-y-auto border-b border-border-subtle/30">
                    <ResultsGrid
                        entries={entries}
                        idle={idle}
                        onAdd={handleAdd}
                    />
                </div>
                <div className="overflow-y-auto">
                    <DeckPileArea cards={deck.cards} onRemove={handleRemove} />
                </div>
            </div>

            <SaveDeckBar
                name={deck.name}
                onChangeName={handleSetName}
                onDone={() => void handleDone()}
                onDelete={onDelete ? () => setConfirmDelete(true) : undefined}
                cardCount={deck.cards.length}
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
