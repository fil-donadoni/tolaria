import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    type BanlistOverride,
    type FormatId,
    isBanlistFormatId,
} from "@convex/formats";

// Client-side DB banlist override hooks (PRD #1138, issue #1144). Both wrap the
// reactive `getBanlistEnforcement` query and convert its wire arrays into the
// `BanlistOverride` Set shape `validateDeck` expects. A Format with no DB-backed
// banlist (Freeform, Alpha 40) skips the query entirely and resolves to
// `undefined`, which every `validateDeck` call site already treats as "use the
// code-const fallback" — so nothing regresses before the first Scryfall sync.

/** The injected banlist override for a single Format, or `undefined` while the
 *  query loads / for a non-DB-backed Format. Used by the live deck builder,
 *  whose working deck has exactly one Format. */
export function useBanlistOverride(
    format: string | undefined
): BanlistOverride | undefined {
    const enforcement = useQuery(
        api.banlists.getBanlistEnforcement,
        format && isBanlistFormatId(format) ? { format } : "skip"
    );
    return useMemo(
        () =>
            enforcement
                ? {
                      banned: new Set(enforcement.banned),
                      restricted: new Set(enforcement.restricted),
                  }
                : undefined,
        [enforcement]
    );
}

/** Both DB-backed Formats' overrides keyed by `FormatId`, for a list that mixes
 *  Formats (the user's saved decks). A row whose Format isn't DB-backed simply
 *  looks up `undefined` here — the same code-const fallback path. Mirrors the
 *  server's `loadBanlistOverridesByFormat` (`convex/decks.ts`). */
export function useBanlistOverridesByFormat(): Partial<
    Record<FormatId, BanlistOverride>
> {
    const premodern = useBanlistOverride("premodern");
    const oldSchool = useBanlistOverride("old-school");
    return useMemo(
        () => ({ premodern, "old-school": oldSchool }),
        [premodern, oldSchool]
    );
}
