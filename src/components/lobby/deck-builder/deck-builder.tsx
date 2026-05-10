import { useCallback, useRef, useState } from "react";
import { getCardById } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import {
    type UserDeck,
    createEmptyUserDeck,
    listUserDecks,
    nextDeckName,
    saveUserDeck,
    touchDeck,
} from "~/lib/userDecks";
import type { DeckCard } from "~/types/game";
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

interface DeckBuilderProps {
    initialDeck: UserDeck | null;
    onClose: (savedPresetId: string | null) => void;
}

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

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
    onClose,
}: DeckBuilderProps) {
    const [deck, setDeck] = useState<UserDeck>(
        () => initialDeck ?? createEmptyUserDeck(nextDeckName(listUserDecks()))
    );
    const [filters, setFilters] = useState<CardSearchFilters>(DEFAULT_FILTERS);
    // Track whether the deck has been written to localStorage at least once.
    // Empty drafts stay virtual until the first edit so a user opening the
    // builder and bailing out doesn't leave behind an empty "Deck N".
    const persistedRef = useRef(initialDeck !== null);

    const { entries, idle } = useCardSearch(filters);

    const updateDeck = useCallback((updater: (deck: UserDeck) => UserDeck) => {
        setDeck((current) => {
            const updated = updater(current);
            const next = touchDeck(updated, {
                colors: computeDeckColors(updated.cards),
            });
            if (persistedRef.current || next.cards.length > 0) {
                saveUserDeck(next);
                persistedRef.current = true;
            }
            return next;
        });
    }, []);

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

    const handleDone = useCallback(() => {
        onClose(persistedRef.current ? deck.presetId : null);
    }, [deck.presetId, onClose]);

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
        <div className="flex h-screen flex-col bg-neutral-950 text-white">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-black/40 px-6 py-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleDone}
                        className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                    >
                        ← Back
                    </button>
                    <h1 className="text-lg font-semibold">
                        {initialDeck ? "Edit Deck" : "New Deck"}
                    </h1>
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
                <div className="overflow-y-auto border-b border-white/10">
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
                onDone={handleDone}
                cardCount={deck.cards.length}
            />
        </div>
    );
}
