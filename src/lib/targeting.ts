import type { CardInstance, Player } from "~/types/game";
import type { CardType, PermanentView } from "@convex/cards/types";
import type { CardInstanceState } from "@convex/gre/state";
import {
    isGuardedAgainst,
    type GuardActionSource,
} from "@convex/gre/permanentGuard";

// Client-side mirror of the server's `cantBeTargeted` gate (CR 702.18 shroud /
// "can't be the target of spells or abilities", CR 611 continuous guard). The
// server is authoritative — `selectTarget` rejects an illegal target — but the
// client also greys out shrouded permanents so they read as un-clickable
// (issue #382). This imports only the PURE guard helper from the GRE (the same
// boundary relaxation `effective-stats.ts` uses for the layer system); it never
// touches a mutation or transport module.

/** Projects a frontend `CardInstance` into the `PermanentView` the guard
 *  predicates read. Spread-forwarding keeps every field (`attachedTo`,
 *  `isTapped`, …) reaching the predicate unchanged; only `types`/`subtypes` are
 *  narrowed because they're optional on `CardInstance` but required on
 *  `PermanentView` (server-projected battlefield cards always carry them). */
// The guard reads only a handful of structural fields (`card.id`, `id`,
// `isTapped`, `attachedTo`, `types`, `subtypes`), all carried by a
// spread-projected `CardInstance`. We cast to `CardInstanceState` at this
// boundary so the pure guard signature is satisfied without forcing every
// optional server-only field (`zone`, `staticAbilities`) onto the projection —
// the same pragmatic projection `effective-stats.ts` performs for the layers.
function toGuardTarget(card: CardInstance): CardInstanceState {
    return {
        ...card,
        types: (card.types ?? []) as CardType[],
        subtypes: card.subtypes ?? [],
    } as unknown as CardInstanceState & PermanentView;
}

function toGuardState(players: Player[]): {
    players: { battlefield: CardInstanceState[] }[];
} {
    return {
        players: players.map((p) => ({
            battlefield: p.battlefield.map(toGuardTarget),
        })),
    };
}

/** Locates the spell/ability source whose target selection is in progress, so
 *  source-narrowed guards ("Aura spells", "spells only" — CR 109.5 / 113.3)
 *  evaluate correctly. For `kind: "ability"` the source is a battlefield
 *  permanent; otherwise it's the hand card being cast (or, for copy-retarget,
 *  treated as a spell). Returns the source's characteristics for the guard. */
function pendingGuardSource(
    players: Player[],
    sourceCardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget" | undefined
): GuardActionSource {
    const isAbility = kind === "ability";
    for (const p of players) {
        const zone = isAbility ? p.battlefield : p.hand;
        const found = zone?.find(
            (c): c is CardInstance => !!c && c.id === sourceCardInstanceId
        );
        if (found) {
            return {
                types: found.types ?? [],
                subtypes: found.subtypes ?? [],
                isSpell: !isAbility,
            };
        }
    }
    // Source not located (e.g. copy on the stack): be conservative — treat as a
    // spell with no subtypes so unfiltered shroud still greys the candidate.
    return { types: [], subtypes: [], isSpell: kind !== "ability" };
}

/** True if `candidate` is barred from being targeted by the pending
 *  spell/ability under any active `cantBeTargeted` guard (CR 702.18 / 611).
 *  Used by the battlefield click gate to make shrouded permanents un-clickable.
 *  When there is no source info the check stays conservative. */
export function isUntargetableByPending(
    players: Player[],
    candidate: CardInstance,
    sourceCardInstanceId: string,
    kind: "cast" | "ability" | "copy-retarget" | undefined
): boolean {
    const state = toGuardState(players);
    const source = pendingGuardSource(players, sourceCardInstanceId, kind);
    return isGuardedAgainst(
        state,
        toGuardTarget(candidate),
        "cantBeTargeted",
        source
    );
}
