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
import { objectHasChosenName } from "../cards/cardNames";
import { matchesPermanentFilter } from "../cards/filters";
import type { MatchablePermanent } from "../cards/filters";
import type {
    CardDefinition,
    StaticActivationRestriction,
    TriggerStateView,
} from "../cards/types";

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

/** The `activation-restriction` statics a definition declares, memoised per
 *  definition OBJECT (a `WeakMap`, so a re-registered definition is read
 *  afresh). The scan runs on the mana planner's hot path, once per candidate
 *  source, so an ordinary board must cost a lookup per permanent and no more. */
const RESTRICTIONS_OF = new WeakMap<
    CardDefinition,
    readonly StaticActivationRestriction[]
>();

function restrictionsOf(
    def: CardDefinition
): readonly StaticActivationRestriction[] {
    let found = RESTRICTIONS_OF.get(def);
    if (!found) {
        found = (def.staticEffects ?? []).filter(
            (e): e is StaticActivationRestriction & typeof e =>
                e.kind === "activation-restriction"
        );
        RESTRICTIONS_OF.set(def, found);
    }
    return found;
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

/** Whether any permanent on `state` declares an `activation-restriction` static
 *  at all. False proves {@link activationRestrictionViolation} is `null` for
 *  every source on this board, which is what lets one mana census ask once
 *  rather than once per source. Suppression is not read: a true here only sends
 *  the caller to the full check. */
export function boardDeclaresActivationRestriction(
    state: RestrictionBoardView
): boolean {
    for (const player of state.players) {
        for (const lock of player.battlefield) {
            const cardId = (lock.card as { id?: string } | undefined)?.id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            if (def && restrictionsOf(def).length > 0) return true;
        }
    }
    return false;
}

/** A source row in a zone other than the battlefield, when the view carries
 *  the zone (a `GameState` does; a mana census's battlefield-only board does
 *  not). Only a name-keyed restriction reads it — `filter` names permanents. */
function findOffBattlefieldSource(
    state: RestrictionBoardView,
    id: string
): NamedSource | undefined {
    for (const player of state.players as ReadonlyArray<OffBattlefieldZones>) {
        for (const zone of [player.hand, player.graveyard, player.exile]) {
            if (!Array.isArray(zone)) continue;
            const row = (zone as ReadonlyArray<NamedSource | null>).find(
                (c) => c !== null && typeof c === "object" && c.id === id
            );
            if (row) return row;
        }
    }
    return undefined;
}

/** The fields a name comparison reads (CR 201.4b / 709.4a, `objectHasChosenName`). */
type NamedSource = Parameters<typeof objectHasChosenName>[0] & { id: string };

type OffBattlefieldZones = {
    hand?: unknown;
    graveyard?: unknown;
    exile?: unknown;
};

/** CR 602.5 — the rejection reason (the restricting card's Oracle text) when
 *  an `activation-restriction` static on any battlefield prohibits activating
 *  an ability of the object `sourceId`, else `null`.
 *
 *  `isManaAbility` (CR 605.1a) decides whether an `exemptManaAbilities`
 *  restriction applies. A `filter` restriction describes permanents (CR
 *  109.2), so a source that is not on the battlefield — a hand card's
 *  cycling, a graveyard ability — escapes it; a `sourcesNamed` restriction
 *  covers a source in any zone (CR 113.7), found on the view's own zones or
 *  supplied as `source` by a caller that already resolved it. */
export function activationRestrictionViolation(
    state: RestrictionBoardView,
    sourceId: string,
    isManaAbility: boolean,
    source?: NamedSource
): string | null {
    // Resolved only once a live restriction exists — the common board has
    // none and never pays for either lookup.
    let onBattlefield: BattlefieldRow | undefined | null = null;
    let anyZone: NamedSource | undefined | null = null;
    for (const player of state.players) {
        for (const lock of player.battlefield) {
            const cardId = (lock.card as { id?: string } | undefined)?.id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            if (!def) continue;
            const restrictions = restrictionsOf(def);
            if (restrictions.length === 0 || abilitiesSuppressed(lock)) {
                continue;
            }
            if (onBattlefield === null)
                onBattlefield = findBattlefieldRow(state, sourceId);
            for (const effect of restrictions) {
                if (isManaAbility && effect.exemptManaAbilities) continue;
                if (effect.sourcesNamed === "chosen-name") {
                    // CR 614.12a — no name chosen (yet): nothing is locked.
                    if (lock.chosenName === undefined) continue;
                    if (anyZone === null)
                        anyZone =
                            onBattlefield ??
                            source ??
                            findOffBattlefieldSource(state, sourceId);
                    if (
                        anyZone &&
                        objectHasChosenName(
                            anyZone,
                            lock.chosenName,
                            tryGetDefinition
                        )
                    )
                        return effect.oracleText;
                    continue;
                }
                if (!onBattlefield) continue;
                if (
                    matchesPermanentFilter(
                        onBattlefield as MatchablePermanent,
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
