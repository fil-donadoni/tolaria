// Catalogue-wide DSL smoke sweep (ADR 0045 testing regime, issue #804). For
// EVERY DSL-only Effect Script in the catalogue — spell sites (`card.effects`)
// and ability sites (activated / triggered `effects[]`) — this derives a canned
// scenario from the script (via `planSmokeTest`), executes it through the REAL
// resolution path (`resolveTopOfStack`), and asserts the outcomes the script
// itself declares. Zero authoring cost per card: a new DSL card is picked up
// automatically.
//
// A script the generator cannot faithfully scenario-ize is reported as an
// explicit SKIP with a reason (collected and printed) — never silently green
// (issue #804 acceptance criteria). The sweep also fails if it becomes vacuous
// (no DSL card ran), so deleting the last DSL card can't hide a regression.
//
// The generator's own construction / derivation / skip-reporting logic is unit
// tested in `convex/gre/effects/__tests__/scenarioGenerator.test.ts`; this file
// is only the end-to-end wiring over the live catalogue.

import { describe, it, expect } from "vitest";
import { getAllCards, registerTokenDefinition } from "..";
import type { EffectOp, TargetRequirement } from "../types";
import {
    abilityHost,
    activatedAbilitySourceOnBattlefield,
    CASTER_ID,
    FILLER_CARD_DEFINITION,
    planSmokeTest,
    SPELL_HOST,
    triggeredAbilitySourceOnBattlefield,
    type Plan,
    type SmokeHost,
} from "../../gre/effects/scenarioGenerator";
import { makeInstance } from "./setup";
import { resolveTopOfStack } from "../../gre/state";

// The filler card the generated scenarios use for targets / library / zones.
// Register the ONE canonical definition (`scenarioGenerator.ts`) — do not
// hand-copy this literal (issue #926 test-isolation postmortem: a divergent
// copy in `scenarioGenerator.test.ts` used to race this one under the node
// project's `isolate: false`, last-registration-wins).
registerTokenDefinition(FILLER_CARD_DEFINITION);

/** A DSL Effect Script found in the catalogue, tagged by host so the harness
 *  can push the right stack item — and so the planner seeds a source of the
 *  card's OWN kind, where that source really is (issue #3879). */
interface DslSite {
    /** Human label for a legible skip / failure line. */
    label: string;
    effects: EffectOp[];
    host: SmokeHost;
}

/** Collects every DSL-only Effect Script across the catalogue, at both spell
 *  and ability sites. Modes carry their own per-mode spell-site scripts; those
 *  are validated elsewhere and are rare — the smoke sweep covers the primary
 *  spell + ability sites (the AC's "every DSL-only card"). */
function collectDslSites(): DslSite[] {
    const sites: DslSite[] = [];
    for (const card of getAllCards()) {
        const label = `${card.name} (${card.id})`;
        if (card.effects !== undefined) {
            sites.push({ label, effects: card.effects, host: SPELL_HOST });
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
                    label: `${label} ability "${ability.id}"`,
                    effects: ability.effects,
                    host,
                });
            }
        }
    }
    return sites;
}

/** Builds the `targetRequirement` a synthetic host needs so the announced
 *  targets in the plan are legal at cast. Derived from the scenario's target
 *  kind — a single slot in the catalogue today. */
function requirementFor(
    plan: Extract<Plan, { kind: "run" }>
): TargetRequirement | undefined {
    const kind = plan.scenario.targetKind;
    if (kind === "none") return undefined;
    if (kind === "player") return { type: "player", count: 1 };
    return { type: "any", count: 1 };
}

/** Runs one spell-site script through resolution and returns the post-state. */
function runSpellSite(
    plan: Extract<Plan, { kind: "run" }>,
    effects: EffectOp[],
    id: string
): void {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...(requirementFor(plan)
            ? { targetRequirement: requirementFor(plan) }
            : {}),
    });
    const state = plan.scenario.state;
    state.stack.push({
        ...makeInstance(id, {
            controllerId: CASTER_ID,
            ownerId: CASTER_ID,
            zone: "hand",
        }),
        castById: CASTER_ID,
        targets: plan.scenario.targets,
    });
    resolveTopOfStack(state);
}

/** Runs one ability-site script through resolution: registers a synthetic
 *  creature carrying the ability, drops the source permanent on the caster's
 *  battlefield (so `$source` binds — CR 608.2h), and pushes an activated-ability
 *  stack item. When the script acts on `$source` the generator has already
 *  seeded that permanent (`scenario.sourcePermanentId`, issue #3831) and the
 *  assertions were derived from it, so the stack item is pushed under ITS id —
 *  the id `$source` binds to (CR 113.7) — instead of a second source. */
function runAbilitySite(
    plan: Extract<Plan, { kind: "run" }>,
    effects: EffectOp[],
    id: string
): void {
    const abilityId = `${id}-ab`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Creature"],
        subtypes: ["Wizard"],
        power: 3,
        toughness: 3,
        activatedAbilities: [
            {
                id: abilityId,
                oracleText: "smoke",
                cost: { tap: true },
                useStack: true,
                effects,
                ...(requirementFor(plan)
                    ? { targetRequirement: requirementFor(plan) }
                    : {}),
            },
        ],
    });
    const state = plan.scenario.state;
    const seeded = plan.scenario.sourcePermanentId;
    const source = makeInstance(id, {
        id: seeded ?? `${id}-src`,
        controllerId: CASTER_ID,
        ownerId: CASTER_ID,
        zone: "battlefield",
        isSummoningSick: false,
    });
    if (seeded === undefined)
        state.players.find((p) => p.id === CASTER_ID)!.battlefield.push(source);
    state.stack.push({
        ...source,
        zone: "stack",
        castById: CASTER_ID,
        abilityId,
        targets: plan.scenario.targets,
    });
    resolveTopOfStack(state);
}

describe("DSL Effect Script smoke sweep (ADR 0045, issue #804)", () => {
    const sites = collectDslSites();
    const skips: string[] = [];
    let ran = 0;

    it("every DSL-only Effect Script's declared outcomes hold under canned resolution", () => {
        sites.forEach((s, i) => {
            const plan = planSmokeTest(s.effects, s.host);
            if (plan.kind === "skip") {
                skips.push(`SKIP ${s.label}: ${plan.reason}`);
                return;
            }
            const id = `smoke-${s.host.site}-${i}`;
            if (s.host.site === "spell") {
                runSpellSite(plan, s.effects, id);
            } else {
                runAbilitySite(plan, s.effects, id);
            }
            const post = plan.scenario.state;
            for (const assertion of plan.assertions) {
                const result = assertion.check(post);
                expect(
                    result.ok,
                    `${s.label}: ${assertion.label} — ${result.detail ?? ""}`
                ).toBe(true);
            }
            ran++;
        });
        // Report skips explicitly — never silently green (issue #804).
        if (skips.length > 0) {
            console.info(
                `[DSL smoke sweep] ${ran} ran, ${skips.length} skipped:\n${skips.join("\n")}`
            );
        }
    });

    it("is not vacuous — at least one DSL script ran end-to-end", () => {
        // Recompute independently so this assertion doesn't depend on test
        // ordering (vitest may isolate `it` state).
        const runnable = sites.filter(
            (s) => planSmokeTest(s.effects, s.host).kind === "run"
        );
        expect(runnable.length).toBeGreaterThanOrEqual(1);
    });

    it("every skip carries a non-empty reason (never silently green)", () => {
        for (const s of sites) {
            const plan = planSmokeTest(s.effects, s.host);
            if (plan.kind === "skip") {
                expect(plan.reason.length, s.label).toBeGreaterThan(0);
            }
        }
    });
});
