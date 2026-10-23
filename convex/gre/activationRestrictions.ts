// Continuous "activation-restriction" static effects (CR 602.5 / CR 611).
//
// A `StaticActivationRestriction` (`convex/cards/types.ts`) on a battlefield
// permanent forbids activating the activated abilities of every permanent its
// `filter` matches — Cursed Totem's "Activated abilities of creatures can't be
// activated." Evaluated live on every read, exactly like `cast-restriction`
// (`cards/castRestrictions.ts`) and `permanent-guard` (`gre/permanentGuard.ts`):
// nothing is materialized, so the lock ends the moment its source leaves the
// battlefield or loses its abilities (CR 611.3b, CR 613.1f).
//
// Pure function of a `TriggerStateView`, so the server mutations, the Bot's
// enumerator and the client affordance (`buildTriggerStateView` rows, whose
// `card` keeps the definition id across `projectPublicState`) all read the one
// predicate (ADR 0074 — the client reads, never decides).

import { tryGetDefinition } from "../cards";
import { matchesPermanentFilter } from "../cards/filters";
import type { MatchablePermanent } from "../cards/filters";
import type { TriggerStateView } from "../cards/types";

type BattlefieldRow =
    TriggerStateView["players"][number]["battlefield"][number];

/** Every battlefield, and nothing else — a `TriggerStateView`, a `GameState`
 *  or a mana census's `{ playerId, battlefield }[]` wrapped as `{ players }`
 *  all satisfy it. A partial board (one controller's battlefield) can only
 *  miss a restriction, never invent one. */
export interface RestrictionBoardView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<BattlefieldRow> }>;
}

/** CR 613.1f — a permanent that lost all abilities generates no static effect. */
function abilitiesSuppressed(row: BattlefieldRow): boolean {
    return (row.abilitiesSuppressedBy?.length ?? 0) > 0;
}

function findBattlefieldRow(
    state: RestrictionBoardView,
    id: string
): BattlefieldRow | undefined {
    for (const player of state.players) {
        const row = player.battlefield.find((c) => c.id === id);
        if (row) return row;
    }
    return undefined;
}

/** CR 602.5 — the rejection reason (the restricting card's Oracle text) when
 *  an `activation-restriction` static on any battlefield prohibits activating
 *  an ability of the permanent `sourceId`, else `null`.
 *
 *  `isManaAbility` (CR 605.1a) decides whether an `exemptManaAbilities`
 *  restriction applies. A source that is not on the battlefield — a hand
 *  card's cycling, a graveyard ability — is never restricted: the filter
 *  describes permanents (CR 109.2). */
export function activationRestrictionViolation(
    state: RestrictionBoardView,
    sourceId: string,
    isManaAbility: boolean
): string | null {
    const source = findBattlefieldRow(state, sourceId);
    if (!source) return null;
    for (const player of state.players) {
        for (const lock of player.battlefield) {
            const cardId = (lock.card as { id?: string } | undefined)?.id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            if (!def?.staticEffects) continue;
            if (abilitiesSuppressed(lock)) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "activation-restriction") continue;
                if (isManaAbility && effect.exemptManaAbilities) continue;
                if (
                    matchesPermanentFilter(
                        source as MatchablePermanent,
                        effect.filter,
                        {
                            selfInstanceId: lock.id,
                            selfControllerId: lock.controllerId,
                        }
                    )
                ) {
                    return effect.oracleText;
                }
            }
        }
    }
    return null;
}
