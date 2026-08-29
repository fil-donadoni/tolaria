// Catalogue guard — an ability whose Oracle text names a PLAYER target must
// DECLARE that target (CR 601.2c / 603.3d), issue #2801.
//
// The engine enforces "this player can't be targeted" in exactly one place:
// the player branch of `getLegalTargets` (the offered set) and the twin check
// in the `selectTarget` mutation (the accepted set), both reading
// `playerHasProtectionFromEverything` (CR 702.16b) and `playerHasShroud`
// (CR 702.18), applied to a player via CR 115.4.
//
// An ability that never declares a `targetRequirement` never reaches that
// branch. Several cards used to spell "target opponent" as a hardcoded player
// ROLE instead — `player: "opponent"` in an Effect Script, or an
// `allPlayerIds.find(p => p !== controller)` scan inside a `resolve()`. The
// shortcut was documented as safe because the engine is 2-player-only, so
// WHICH player is deterministic. That reasoning is sound for identity and
// wrong for legality: it decides WHO the opponent is without ever asking
// WHETHER they may be targeted, so The One Ring's protection was ignored and
// the protected player still discarded (the reported bug).
//
// This sweep fails the moment a new card ships with the same shortcut. It is
// deliberately a TEXT-driven guard: the Oracle line is the specification, and
// the declaration is what the engine can see.
import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import type { CardDefinition, EffectOp, TargetRequirement } from "../types";

/** The Oracle phrasing that makes a player a TARGET. "Each opponent",
 *  "that player", "defending player" and "an opponent" are NOT targets
 *  (CR 115.1 — only the word "target" makes something a target), so the
 *  pattern is anchored on the word itself. */
const PLAYER_TARGET_RE = /target (opponent|player)/i;

/** Sites whose Oracle text genuinely names a player target but whose
 *  declaration the engine cannot see from the ability row alone, or which are
 *  BLOCKED on a named engine gap with a real open issue. One line of reason
 *  each; meant to empty out, never a standing hatch
 *  (`docs/agents/gre-guards.md` idiom, mirroring `KEYWORD_ALLOWLIST`). */
const ALLOWLIST: ReadonlyArray<{
    cardId: string;
    site: string;
    /** Real open issue for a BLOCKED row; omitted for a row that is correct
     *  today at a site the row-level scan cannot see (`nestedReflexive`). */
    issue?: number;
    /** Set when the target IS declared, just on a nested `reflexiveTrigger`
     *  Op — the second test below proves it is really there. */
    nestedReflexive?: boolean;
    reason: string;
}> = [
    {
        cardId: "4c6cf93a-d073-48ac-88db-c46bf3e10beb",
        site: "triggeredAbilities:generous-plunderer-upkeep-treasure",
        nestedReflexive: true,
        reason:
            "The player target belongs to the REFLEXIVE trigger this ability's " +
            "script raises ('When you do, target opponent …', CR 603.3c/603.3d), " +
            "which carries its own targetRequirement on the `reflexiveTrigger` Op — " +
            "see the nested-declaration check below, which asserts it is really there.",
    },
    {
        cardId: "8965ce61-0522-4f77-a82d-89441d1ba867",
        site: "spell",
        issue: 2910,
        reason:
            "Fiery Justice. BLOCKED: the divide-as-you-choose budget is scoped " +
            "to the whole flat target list, not to the group that declared it, " +
            "so a second target group folds the opponent into the 5-damage split.",
    },
    {
        cardId: "4be2aa3b-207b-4d21-abfb-6788520c7676",
        site: "spell",
        issue: 2912,
        reason:
            "Drafna's Restoration. BLOCKED: no cross-slot \"candidate is in " +
            "target N's zone\" filter exists, so two independent groups would " +
            "let the caster announce one player and raid the other's graveyard " +
            "(illegal per CR 601.2c).",
    },
];

function requirementTypes(req: TargetRequirement | undefined): string[] {
    if (!req) return [];
    return Array.isArray(req.type) ? [...(req.type as string[])] : [req.type];
}

/** How many of these groups DECLARE a player target: the type must name
 *  `"player"` explicitly.
 *
 *  `"any"` deliberately does NOT count, even though "any target" does include
 *  each player (CR 115.4). A card can carry an "any target" DAMAGE group AND a
 *  separate "target opponent" clause, and the `"any"` group is not the one that
 *  clause names. Fiery Justice is exactly that shape — "5 damage divided as you
 *  choose among any number of targets. Target opponent gains 5 life." — and
 *  counting its damage group as the player declaration is what let it slip past
 *  an earlier draft of this guard while the lifegain clause stayed ungated.
 *  Verified against the whole catalogue: no shipped site names a player target
 *  and satisfies it with an `"any"`-only group. */
function playerGroupCount(reqs: (TargetRequirement | undefined)[]): number {
    return reqs.filter((r) => requirementTypes(r).includes("player")).length;
}

/** How many distinct "target opponent" / "target player" clauses an Oracle
 *  line names. Each is its own target (CR 601.2c), so each needs its own
 *  group — one declaration does not cover two clauses. */
function playerTargetClauseCount(oracle: string): number {
    return (oracle.match(/target (opponent|player)/gi) ?? []).length;
}

function declaresPlayer(reqs: (TargetRequirement | undefined)[]): boolean {
    return playerGroupCount(reqs) > 0;
}

/** Every `targetRequirement`-bearing group reachable from one ability or
 *  spell site: the primary group, its independent siblings (CR 601.2c), and
 *  each mode's own group (CR 700.2c / 603.3c). */
function requirementsOf(
    carrier: Record<string, unknown> | undefined
): (TargetRequirement | undefined)[] {
    if (!carrier) return [];
    const modes = (carrier.modes ?? []) as { targetRequirement?: unknown }[];
    return [
        carrier.targetRequirement as TargetRequirement | undefined,
        ...((carrier.additionalTargetRequirements ??
            []) as TargetRequirement[]),
        ...modes.map(
            (m) => m.targetRequirement as TargetRequirement | undefined
        ),
    ];
}

/** Walks an Effect Script for a `reflexiveTrigger` Op carrying a player-typed
 *  requirement. A reflexive trigger ("When you do, target opponent …") is its
 *  OWN targeted ability (CR 603.3c/603.3d) — its declaration rides the Op, not
 *  the enclosing ability row, and the `if`/`forEach` constructs can nest it
 *  arbitrarily deep. */
function nestedReflexiveDeclaresPlayer(effects: unknown): boolean {
    if (!Array.isArray(effects)) return false;
    for (const raw of effects as EffectOp[]) {
        const op = raw as unknown as Record<string, unknown>;
        if (
            op.op === "reflexiveTrigger" &&
            declaresPlayer(requirementsOf(op))
        ) {
            return true;
        }
        // The four frozen structural constructs (ADR 0045) — bind/ref carry no
        // nested script; `if` and `forEach` do.
        for (const key of ["then", "else", "body", "effects"]) {
            if (nestedReflexiveDeclaresPlayer(op[key])) return true;
        }
    }
    return false;
}

type Site = { cardId: string; label: string; site: string; oracle: string };

/** Every site on a card that can name a player target in its OWN Oracle line:
 *  the spell itself (only for a card that IS a spell — a permanent's
 *  card-level `oracleText` is the concatenation of its abilities' lines, which
 *  would double-count every ability below), plus every ability row. */
function playerTargetSites(card: CardDefinition): Site[] {
    const c = card as CardDefinition & Record<string, unknown>;
    const out: Site[] = [];
    const label = `${c.name} (${c.id})`;
    const isSpell =
        (c.types ?? []).includes("Instant") ||
        (c.types ?? []).includes("Sorcery");
    if (
        isSpell &&
        typeof c.oracleText === "string" &&
        PLAYER_TARGET_RE.test(c.oracleText)
    ) {
        out.push({ cardId: c.id, label, site: "spell", oracle: c.oracleText });
    }
    for (const key of [
        "activatedAbilities",
        "triggeredAbilities",
        "grantTemplates",
        "triggeredGrantTemplates",
        "chapterAbilities",
    ]) {
        for (const ability of (c[key] ?? []) as Record<string, unknown>[]) {
            const oracle = ability.oracleText;
            if (typeof oracle !== "string" || !PLAYER_TARGET_RE.test(oracle)) {
                continue;
            }
            out.push({
                cardId: c.id,
                label,
                site: `${key}:${String(ability.id)}`,
                oracle,
            });
        }
    }
    return out;
}

function siteCarrier(
    card: CardDefinition,
    site: Site
): Record<string, unknown> | undefined {
    const c = card as CardDefinition & Record<string, unknown>;
    if (site.site === "spell") return c as Record<string, unknown>;
    const [key, id] = site.site.split(":");
    return ((c[key] ?? []) as Record<string, unknown>[]).find(
        (a) => a.id === id
    );
}

describe("player-target declaration catalogue guard (CR 601.2c / 603.3d, issue #2801)", () => {
    it("every shipped Oracle line naming a player target declares a player-typed requirement", () => {
        const offenders: string[] = [];
        for (const card of getAllCards()) {
            for (const site of playerTargetSites(card)) {
                const allowed = ALLOWLIST.some(
                    (a) => a.cardId === site.cardId && a.site === site.site
                );
                if (allowed) continue;
                const carrier = siteCarrier(card, site);
                const declared = playerGroupCount(requirementsOf(carrier));
                const needed = playerTargetClauseCount(site.oracle);
                if (declared >= needed) continue;
                // NO blanket skip for a dynamic `getTargetRequirement`: it
                // cannot be read statically, so admitting it would be an
                // unproven hatch — exactly what the reasoned ALLOWLIST above
                // exists to replace. No shipped site pairs one with a
                // player-target Oracle line today; the first that does earns a
                // row and a reason, not a silent pass.
                offenders.push(
                    `${site.label} [${site.site}] — names ${needed} player target(s), declares ${declared} — "${site.oracle.replace(/\n/g, " | ")}"`
                );
            }
        }
        expect(offenders).toEqual([]);
    });

    it("every allowlisted site really declares its player target on a nested reflexive trigger", () => {
        // The allowlist is not a blanket skip: each entry must still prove the
        // target IS declared, just at a site the row-level scan cannot see.
        const unproven: string[] = [];
        for (const entry of ALLOWLIST.filter((e) => e.nestedReflexive)) {
            const card = getAllCards().find((c) => c.id === entry.cardId);
            expect(
                card,
                `allowlisted card ${entry.cardId} is not shipped`
            ).toBeDefined();
            const carrier = siteCarrier(card!, {
                cardId: entry.cardId,
                label: card!.name,
                site: entry.site,
                oracle: "",
            });
            expect(
                carrier,
                `allowlisted site ${entry.site} is not on ${card!.name}`
            ).toBeDefined();
            if (!nestedReflexiveDeclaresPlayer(carrier!.effects)) {
                unproven.push(`${card!.name} [${entry.site}]`);
            }
        }
        expect(unproven).toEqual([]);
    });

    it("every allowlist entry carries a reason, and exactly one of a proof or a ticket", () => {
        for (const entry of ALLOWLIST) {
            const label = `${entry.cardId} ${entry.site}`;
            expect(entry.reason.length, label).toBeGreaterThan(20);
            // A row is EITHER "correct, just not visible here" (proved by the
            // nested check above) OR "blocked, tracked" — never neither, which
            // is how an allowlist rots into a standing hatch.
            expect(
                Boolean(entry.nestedReflexive) !== (entry.issue !== undefined),
                label
            ).toBe(true);
        }
    });
});
