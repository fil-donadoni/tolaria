import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getCardById } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import {
    type UserDeck,
    createEmptyUserDeck,
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
        () => initialDeck ?? createEmptyUserDeck("New Deck")
    );
    const [filters, setFilters] = useState<CardSearchFilters>(DEFAULT_FILTERS);
    const [syncing, setSyncing] = useState(false);
    const syncedRef = useRef(false);
    const syncCardIndex = useMutation(api.cardIndex.syncCardIndex);

    const { entries, total } = useCardSearch(filters);

    // Bootstrap the card_index table on first builder open if it's empty.
    // Idempotent: subsequent runs upsert and only patch changed rows.
    useEffect(() => {
        if (syncedRef.current) return;
        if (entries === undefined) return;
        if (total > 0) {
            syncedRef.current = true;
            return;
        }
        syncedRef.current = true;
        setSyncing(true);
        syncCardIndex({})
            .catch(() => {})
            .finally(() => setSyncing(false));
    }, [entries, total, syncCardIndex]);

    const handleManualSync = useCallback(async () => {
        setSyncing(true);
        try {
            await syncCardIndex({});
        } finally {
            setSyncing(false);
        }
    }, [syncCardIndex]);

    const setName = useCallback((name: string) => {
        setDeck((d) => ({ ...d, name }));
    }, []);

    const handleAdd = useCallback((cardId: string, cardName: string) => {
        setDeck((d) => ({
            ...d,
            cards: [...d.cards, { cardId, cardName }],
        }));
    }, []);

    const handleRemove = useCallback((cardId: string) => {
        setDeck((d) => {
            const idx = d.cards.findIndex((c) => c.cardId === cardId);
            if (idx < 0) return d;
            const next = [...d.cards];
            next.splice(idx, 1);
            return { ...d, cards: next };
        });
    }, []);

    const handleSave = useCallback(() => {
        const trimmed = deck.name.trim() || "Untitled Deck";
        const next = touchDeck(deck, {
            name: trimmed,
            colors: computeDeckColors(deck.cards),
        });
        saveUserDeck(next);
        onClose(next.presetId);
    }, [deck, onClose]);

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

    const canSave = useMemo(() => deck.name.trim().length > 0, [deck.name]);

    return (
        <div className="flex h-screen flex-col bg-neutral-950 text-white">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-black/40 px-6 py-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onClose(null)}
                        className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                    >
                        ← Back
                    </button>
                    <h1 className="text-lg font-semibold">
                        {initialDeck ? "Edit Deck" : "New Deck"}
                    </h1>
                    <SearchBar value={filters.text} onChange={setText} />
                    <button
                        onClick={handleManualSync}
                        disabled={syncing}
                        className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40"
                        title="Re-sync the card library from the implemented sets."
                    >
                        {syncing ? "Syncing…" : "Sync library"}
                    </button>
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
                    <ManaValueFilter
                        selected={filters.manaValues}
                        onToggle={toggleManaValue}
                    />
                </div>
            </div>

            <div className="grid flex-1 grid-rows-2 overflow-hidden">
                <div className="overflow-y-auto border-b border-white/10">
                    <ResultsGrid entries={entries} onAdd={handleAdd} />
                </div>
                <div className="overflow-y-auto">
                    <DeckPileArea cards={deck.cards} onRemove={handleRemove} />
                </div>
            </div>

            <SaveDeckBar
                name={deck.name}
                onChangeName={setName}
                canSave={canSave}
                onSave={handleSave}
                onCancel={() => onClose(null)}
                cardCount={deck.cards.length}
            />
        </div>
    );
}
