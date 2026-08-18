// Named factories for the triggered abilities a TOKEN can carry (CR 707.2 —
// a token's OWN printed triggered ability, independent of its creating
// source), synthesized from the JSON-pure `TokenTriggeredAbility` descriptor
// (`cards/types.ts`, issue #2364).
//
// Same shape as `tokenStaticEffects.ts`'s "one table for encode and decode"
// pattern, adapted for triggers: `TriggeredAbility.matches` is a REQUIRED
// closure and can never survive a JSON round trip, so a descriptor never
// stores `matches` at all — this module REBUILDS it fresh, every time, from
// plain data (`event` + `effects`) via the ordinary trigger factories
// (`enteredTrigger`, `diedTrigger`, `attacksTrigger`). Both the `createToken`
// Op executor
// (server registration, from an `EffectTokenSpec.triggeredAbilities`
// literal) and any future cold-decode rebuild call this SAME function, so
// they can never disagree.
//
// Restricted to SELF scope (CR 109.2) by construction — the descriptor has
// no `scope`/`filter` field, so there is nothing to get wrong on rebuild. A
// token trigger needing a wider scope stays a `resolve()` card via
// `TokenSpec.triggeredAbilities` (full `TriggeredAbility[]`, closures
// allowed) — see that field's doc comment for the fidelity tradeoff on THAT
// surface (id-only content hash, non-firing stub on a cold decode).

import { enteredTrigger } from "./abilities/triggers/enteredTrigger";
import { diedTrigger } from "./abilities/triggers/diedTrigger";
import { attacksTrigger } from "./abilities/triggers/attacksTrigger";
import type {
    TokenTriggeredAbility,
    TokenTriggeredEventKind,
    TriggeredAbility,
} from "./types";

/** The `TokenTriggeredEventKind` members, as a runtime-checkable table. Keyed
 *  by the type so the two can never drift — a new member without a row here is
 *  a COMPILE ERROR. Exported because the COLD-DECODE path (`cards/registry.ts`
 *  `maybeSynthesizeToken`) has to ask "is this encoded `event` string a kind
 *  this factory can rebuild?" before calling in, and it used to answer with a
 *  hand-written `||` chain that no compiler checked — the one site a new kind
 *  could silently miss (issue #2399). */
export const TOKEN_TRIGGERED_EVENT_KINDS: Record<
    TokenTriggeredEventKind,
    true
> = {
    PERMANENT_ENTERED: true,
    CREATURE_DIED: true,
    ATTACKERS_DECLARED: true,
};

/** True when `event` names a kind `resolveTokenTriggeredAbilities` can
 *  synthesize. Fail-closed: an unknown string (a descriptor written by a newer
 *  build) answers false. */
export function isTokenTriggeredEventKind(
    event: unknown
): event is TokenTriggeredEventKind {
    return typeof event === "string" && event in TOKEN_TRIGGERED_EVENT_KINDS;
}

/** Rebuilds real, self-scoped `TriggeredAbility` objects from a token's
 *  declared descriptors. Shared by the `createToken` Op executor
 *  (`gre/effects/interpreter.ts`) and any decoder that needs the same
 *  synthesis. Unknown/future `event` values are dropped defensively (a
 *  descriptor written by a newer build than this one) rather than throwing —
 *  the SAME "unknown segments are dropped" convention
 *  `resolveTokenStaticEffects` uses. */
export function resolveTokenTriggeredAbilities(
    descriptors: readonly TokenTriggeredAbility[] | undefined
): TriggeredAbility[] {
    if (!descriptors?.length) return [];
    const abilities: TriggeredAbility[] = [];
    for (const d of descriptors) {
        switch (d.event) {
            case "PERMANENT_ENTERED":
                abilities.push(
                    enteredTrigger({
                        id: d.id,
                        oracleText: d.oracleText,
                        scope: "self",
                        effects: d.effects,
                    })
                );
                break;
            case "CREATURE_DIED":
                abilities.push(
                    diedTrigger({
                        id: d.id,
                        oracleText: d.oracleText,
                        scope: "self",
                        effects: d.effects,
                    })
                );
                break;
            case "ATTACKERS_DECLARED":
                abilities.push(
                    attacksTrigger({
                        id: d.id,
                        oracleText: d.oracleText,
                        scope: "self",
                        effects: d.effects,
                    })
                );
                break;
            default: {
                // Exhaustiveness guard — a new `TokenTriggeredEventKind`
                // member is a compile error here until this switch is
                // extended to match (mirrors `TOKEN_STATIC_EFFECT_FACTORIES`'
                // `Record<TokenStaticEffectKey, …>` exhaustiveness, just
                // expressed as a switch since each event needs a different
                // factory signature).
                const exhaustive: never = d.event;
                void exhaustive;
            }
        }
    }
    return abilities;
}
