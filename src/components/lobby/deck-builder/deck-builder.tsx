import { useCallback, useEffect, useRef, useState } from "react";
import { getCardById } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import type { Id } from "@convex/_generated/dataModel";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import { type UserLobbyDeck } from "~/lib/deckTypes";
import { nextDeckName } from "~/lib/userDecks";
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
}: DeckBuilderProps) {
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
        <div className="flex h-screen flex-col bg-neutral-950 text-white">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-black/40 px-6 py-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => void handleDone()}
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
                onDone={() => void handleDone()}
                cardCount={deck.cards.length}
            />
        </div>
    );
}
