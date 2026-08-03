import type { CardInstance, Player, StackItem } from "~/types/game";
import type { CardType, PermanentView } from "@convex/cards/types";
import type { CardInstanceState } from "@convex/gre/state";
import {
    isGuardedAgainst,
    playerHasShroud,
    type GuardActionSource,
} from "@convex/gre/permanentGuard";
import { isProtectedFrom, protectionSourceView } from "@convex/gre/protection";

// Client-side mirror of the server's `cantBeTargeted` gate (CR 702.18 shroud /
// "can't be the target of spells or abilities", CR 611 continuous guard). The
// server is authoritative — `selectTarget` rejects an illegal target — but the
// client also greys out shrouded permanents so they read as un-clickable
// (issue #382). This imports only the PURE guard helper from the GRE (the same
// boundary relaxation `effective-stats.ts` uses for the layer system); it never
// touches a mutation or transport module.
//
// `playerHasShroud` (issue #1128) is the PLAYER-scoped sibling: a shrouded
// player's nameplate should read as un-clickable the same way a shrouded
// permanent does. `isPlayerUntargetableByPending` below wraps it for
// `usePlayerInteraction` the same way `isUntargetableByPending` wraps
// `isGuardedAgainst` for the battlefield.

/** Projects a frontend `CardInstance` into the `PermanentView` the guard
 *  predicates read. Spread-forwarding keeps every field (`attachedTo`,
 *  `isTapped`, …) reaching the predicate unchanged; only `types`/`subtypes` are
 *  narrowed because they're optional on `CardInstance` but required on
 *  `PermanentView` (server-projected battlefield cards always carry them). */
// The guard reads only a handful of structural fields (`card.id`, `id`,
// `isTapped`, `attachedTo`, `types`, `subtypes`, `staticAbilities`), all
// carried by a spread-projected `CardInstance` — `staticAbilities` included:
// `projectPublicState`'s `slimCard` (`convex/gameProjections.ts`) forwards it
// verbatim (it only strips `card`/`knownTo`/`stormSnapshot`), and it is a
// first-class optional field on `CardInstance` itself
// (`src/types/game.ts`). We cast to `CardInstanceState` at this boundary so
// the pure guard signature is satisfied without forcing every optional
// server-only field (`zone`, the rest of `PermanentView`) onto the
// projection — the same pragmatic projection `effective-stats.ts` performs
// for the layers. This is what makes the CR 702.18 dynamic-shroud-grant
// bridge (`gre/permanentGuard.ts`'s `hasShroud`, issue #959) work client-side
// for free: it reads `card.staticAbilities` directly, no new wiring needed.
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
    stackItems: readonly StackItem[],
    sourceCardInstanceId: string,
    kind:
        | "cast"
        | "ability"
        | "copy-retarget"
        | "retarget"
        | "trigger"
        | undefined,
    sourceControllerId: string | undefined
): GuardActionSource {
    // CR 113.3 — only a cast / (copy-)retargeted spell is a spell; an
    // activated OR triggered ability is not. Mirrors the server's
    // `pendingTargetingSource`.
    const isSpell =
        kind === "cast" || kind === "retarget" || kind === "copy-retarget";
    const found = findPendingSourceCard(
        players,
        stackItems,
        sourceCardInstanceId,
        kind
    );
    // Source not located (an emblem-sourced trigger has no stack row of its
    // own): types/subtypes stay empty — the server is authoritative on
    // legality, and this gate is a UX convenience that must not GREY a legal
    // target it cannot judge.
    return {
        types: found?.types ?? [],
        subtypes: found?.subtypes ?? [],
        isSpell,
        // CR 702.11b — the source's controller, so hexproof greys only
        // an opponent's targeted spell, never the controller's own.
        controllerId: sourceControllerId,
    };
}

/** Locates the pending spell/ability's source card in the zone it lives in,
 *  mirroring the server's own `pendingTargetingSource`
 *  (`convex/gre/rules.ts`): a TRIGGER / retarget / copy-retarget source is the
 *  on-STACK item (its `PendingTarget.cardInstanceId` is a synthetic stack-item
 *  id that appears in no other zone — the omission that let a protected
 *  permanent glow and hard-error on click, issue #1120 review); an ability's
 *  source is a battlefield permanent; a cast's is the hand card. Returns
 *  `undefined` only when it is genuinely absent from the wire view. */
function findPendingSourceCard(
    players: Player[],
    stackItems: readonly StackItem[],
    sourceCardInstanceId: string,
    kind: string | undefined
): CardInstance | undefined {
    if (kind === "trigger" || kind === "retarget" || kind === "copy-retarget") {
        return stackItems.find((s) => s.id === sourceCardInstanceId);
    }
    const isAbility = kind === "ability";
    for (const p of players) {
        const zone = isAbility ? p.battlefield : p.hand;
        const found = zone?.find(
            (c): c is CardInstance => !!c && c.id === sourceCardInstanceId
        );
        if (found) return found;
    }
    return undefined;
}

/** True if `candidate` is barred from being targeted by the pending
 *  spell/ability under any active `cantBeTargeted` guard (CR 702.18 shroud /
 *  611, CR 702.11b hexproof) OR by CR 702.16b protection. Used by the
 *  battlefield click gate to make untargetable permanents un-clickable.
 *  `sourceControllerId` is the chooser (the spell/ability's controller);
 *  hexproof greys the candidate only for an opponent's source, never its own
 *  controller's. When there is no source info the check stays conservative.
 *
 *  CR 702.16b (issue #1120): protection is read through the SAME pure
 *  `isProtectedFrom` predicate `getLegalTargets` (the offered set) and
 *  `selectTarget` (the accepted set) read, so every quality family — colour,
 *  the CR 702.16k player quality, and the CHARACTERISTIC form ("protection
 *  from legendary creatures") — greys out identically on the board. The
 *  source's live characteristics come from the wire view of its own card:
 *  a cast source is the chooser's own hand card and an ability source is a
 *  battlefield permanent, so both are visible to whoever is choosing. When
 *  the source can't be located (a trigger's synthetic stack-item id) the
 *  protection check is SKIPPED, not guessed — the server's own gate is
 *  authoritative and rejects the pick, and this UI hint's standing rule is
 *  never to hide a target it can't judge. */
export function isUntargetableByPending(
    players: Player[],
    candidate: CardInstance,
    sourceCardInstanceId: string,
    kind:
        | "cast"
        | "ability"
        | "copy-retarget"
        | "retarget"
        | "trigger"
        | undefined,
    /** CR 405 — the projected stack. REQUIRED, and positioned before the
     *  optional `sourceControllerId` so the compiler names every caller: a
     *  TRIGGER-sourced pending target's `cardInstanceId` is a synthetic
     *  stack-item id that exists in no other zone, so without this the gate
     *  silently could not resolve the source and offered targets the server
     *  rejects (issue #1120 review). Pass `[]` only where there genuinely is
     *  no stack. */
    stackItems: readonly StackItem[],
    sourceControllerId?: string
): boolean {
    const state = toGuardState(players);
    const source = pendingGuardSource(
        players,
        stackItems,
        sourceCardInstanceId,
        kind,
        sourceControllerId
    );
    if (
        isGuardedAgainst(
            state,
            toGuardTarget(candidate),
            "cantBeTargeted",
            source
        )
    ) {
        return true;
    }
    const sourceCard = findPendingSourceCard(
        players,
        stackItems,
        sourceCardInstanceId,
        kind
    );
    if (!sourceCard) return false;
    return isProtectedFrom(
        toGuardTarget(candidate),
        protectionSourceView(toGuardTarget(sourceCard))
    );
}

/** True if `candidatePlayerId` is barred from being targeted by ANY
 *  spell/ability under an active player-scoped shroud guard (CR 702.18
 *  applied to a player via CR 115.4, CR 611). Used by the player-nameplate
 *  click gate (`usePlayerInteraction`) to make a shrouded player
 *  un-clickable, mirroring `isUntargetableByPending` for permanents. Unlike
 *  that helper, this takes no source-characteristics parameters: CR 702.18
 *  shroud has no hexproof-style controller exception and no
 *  Artifact-Ward-style source filter — it bars every source unconditionally,
 *  including the guarded player's own spells/abilities. */
export function isPlayerUntargetableByPending(
    players: Player[],
    candidatePlayerId: string,
    protectedPlayerIds?: string[]
): boolean {
    // CR 702.16b/i (issue #674, The One Ring) — protection from everything bars
    // targeting on the same unconditional terms as shroud (no controller
    // exception, the protected player's own spells included), so it folds into
    // the same guard. Unlike shroud it isn't derived from a battlefield
    // permanent's static effect: it's a turn-scoped player designation carried
    // on the wire as `GameState.playerProtectionFromEverything`, which is why
    // it arrives as a parameter instead of being read off `players`.
    if (protectedPlayerIds?.includes(candidatePlayerId)) return true;
    return playerHasShroud(toGuardState(players), candidatePlayerId);
}
