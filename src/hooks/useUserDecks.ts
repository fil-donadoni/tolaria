import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { type UserLobbyDeck, toUserLobbyDeck } from "~/lib/deckTypes";

export function useUserDecks(): UserLobbyDeck[] | undefined {
    const docs = useQuery(api.userDecks.listMine);
    return useMemo(() => docs?.map(toUserLobbyDeck), [docs]);
}

export function useUserDeckMutations() {
    const create = useMutation(api.userDecks.create);
    const update = useMutation(api.userDecks.update);
    const remove = useMutation(api.userDecks.remove);
    return { create, update, remove };
}

// Admin-only preset mutations (PRD #466, ADR 0033). The deck editor uses them
// in preset mode; the server gates both via `assertIsAdmin`. `createPreset`
// derives the slug from the name and returns it (issue #469).
export function usePresetMutations() {
    const create = useMutation(api.decks.createPreset);
    const update = useMutation(api.decks.updatePreset);
    return { create, update };
}
