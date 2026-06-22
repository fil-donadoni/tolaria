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

// Admin-only preset edit mutation (PRD #466, ADR 0033). The deck editor uses
// it in preset mode; the server gates it via `assertIsAdmin`.
export function usePresetMutations() {
    const update = useMutation(api.decks.updatePreset);
    return { update };
}
