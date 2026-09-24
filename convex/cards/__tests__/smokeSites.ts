// The DSL sites the catalogue-wide smoke sweep runs (ADR 0045 testing
// regime, issue #804) — one definition shared by the sweep itself
// (`convex/cards/__tests__/effectScriptSmoke.test.ts`) and by the tooling that
// needs to know which cards the sweep actually covers: a card with a site the
// planner SKIPS is on the "smoke skip list" (issue #4489,
// `scripts/purge-identity-tests.ts`).

import type { CardDefinition, EffectOp } from "../types";
import {
    abilityHost,
    activatedAbilitySourceOnBattlefield,
    SPELL_HOST,
    triggeredAbilitySourceOnBattlefield,
    type SmokeHost,
} from "../../gre/effects/scenarioGenerator";

/** A DSL Effect Script found in the catalogue, tagged by host so the harness
 *  can push the right stack item — and so the planner seeds a source of the
 *  card's OWN kind, where that source really is (issue #3879). */
export interface DslSite {
    /** The catalogue card the script belongs to. */
    cardId: string;
    /** Human label for a legible skip / failure line. */
    label: string;
    effects: EffectOp[];
    host: SmokeHost;
    /** Which stack item the harness pushes. This is NOT `host.site`: a GRANT
     *  template is hosted by an ability (so the harness pushes an ability
     *  item, and a body reading the implicit source still resolves against a
     *  permanent) while its `host` stays `SPELL_HOST`, because the KIND of the
     *  permanent that received the grant is not on this definition
     *  (issue #3879). Keeping the two apart is what stops the fail-closed
     *  planner decision from also downgrading the harness. */
    pushes: "spell" | "ability";
}

/** Collects every DSL-only Effect Script across the catalogue, at both spell
 *  and ability sites. Modes carry their own per-mode spell-site scripts; those
 *  are validated elsewhere and are rare — the smoke sweep covers the primary
 *  spell + ability sites (the AC's "every DSL-only card"). */
export function collectDslSites(cards: readonly CardDefinition[]): DslSite[] {
    const sites: DslSite[] = [];
    for (const card of cards) {
        const label = `${card.name} (${card.id})`;
        if (card.effects !== undefined) {
            sites.push({
                cardId: card.id,
                label,
                effects: card.effects,
                host: SPELL_HOST,
                pushes: "spell",
            });
        }
        // CR 113.7 — the source of one of the card's OWN abilities is the
        // permanent this card makes, so its kind is the card's own.
        const own: {
            ability: { id: string; effects?: EffectOp[] };
            host: SmokeHost;
        }[] = [
            ...(card.activatedAbilities ?? []).map((ability) => ({
                ability,
                host: abilityHost(
                    card,
                    activatedAbilitySourceOnBattlefield(ability)
                ),
            })),
            ...(card.triggeredAbilities ?? []).map((ability) => ({
                ability,
                host: abilityHost(
                    card,
                    triggeredAbilitySourceOnBattlefield(ability)
                ),
            })),
            // A GRANT template's source is whatever permanent received the
            // grant (CR 113.7 again), which this definition does not know —
            // so there is no kind to seed and `$source` stays unmodelled,
            // exactly as at a spell site. Fail-closed by construction rather
            // than by assuming the grantee is a creature (issue #3879).
            ...(card.grantTemplates ?? []).map((ability) => ({
                ability,
                host: SPELL_HOST,
            })),
            ...(card.triggeredGrantTemplates ?? []).map((ability) => ({
                ability,
                host: SPELL_HOST,
            })),
        ];
        for (const { ability, host } of own) {
            if (ability.effects !== undefined) {
                sites.push({
                    cardId: card.id,
                    label: `${label} ability "${ability.id}"`,
                    effects: ability.effects,
                    host,
                    pushes: "ability",
                });
            }
        }
    }
    return sites;
}
