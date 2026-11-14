import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards/catalogue";
import { foldCardName } from "@convex/cards/textNormalize";

/**
 * The user's preferred printing per card (issue #8755), read for the whole
 * deck-builder results grid from ONE subscription
 * (`api.userCardPrints.listMyCardPrints`) — never one query per mounted cell.
 *
 * `prefer` is optimistic: the pick lands in a session overlay at once and the
 * save runs behind it. A failed save keeps the overlay, so the visible choice
 * is not undone for the session (a Convex optimistic update would roll it
 * back); the next reload shows what the server holds.
 */
export function usePreferredPrints() {
    const saved = useQuery(api.userCardPrints.listMyCardPrints);
    const save = useMutation(api.userCardPrints.setMyCardPrint);
    const [session, setSession] = useState<ReadonlyMap<string, CardPrinting>>(
        () => new Map()
    );

    const merged = useMemo(() => {
        const map = new Map<string, CardPrinting>();
        for (const row of saved ?? [])
            map.set(row.cardKey, {
                printId: row.printId,
                setCode: row.setCode,
            });
        for (const [key, printing] of session) map.set(key, printing);
        return map;
    }, [saved, session]);

    const preferredFor = useCallback(
        (cardName: string): CardPrinting | undefined =>
            merged.get(foldCardName(cardName)),
        [merged]
    );

    const prefer = useCallback(
        (cardName: string, printing: CardPrinting) => {
            const chosen = {
                printId: printing.printId,
                setCode: printing.setCode,
            };
            setSession((prev) => {
                const next = new Map(prev);
                next.set(foldCardName(cardName), chosen);
                return next;
            });
            save({ cardName, ...chosen }).catch((err: unknown) => {
                console.warn("Could not save the preferred printing", err);
            });
        },
        [save]
    );

    return { preferredFor, prefer };
}
