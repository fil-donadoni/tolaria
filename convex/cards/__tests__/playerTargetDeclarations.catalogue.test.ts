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
 *  correct for a reason the text scan can't express. One line of reason each;
 *  meant to stay near-empty (`docs/agents/gre-guards.md` idiom). */
const ALLOWLIST: ReadonlyArray<{
    cardId: string;
    site: string;
    reason: string;
}> = [
    {
        cardId: "4c6cf93a-d073-48ac-88db-c46bf3e10beb",
        site: "triggeredAbilities:generous-plunderer-upkeep-treasure",
        reason:
            "The player target belongs to the REFLEXIVE trigger this ability's " +
            "script raises ('When you do, target opponent …', CR 603.3c/603.3d), " +
            "which carries its own targetRequirement on the `reflexiveTrigger` Op — " +
            "see the nested-declaration check below, which asserts it is really there.",
    },
];

function requirementTypes(req: TargetRequirement | undefined): string[] {
    if (!req) return [];
    return Array.isArray(req.type) ? [...(req.type as string[])] : [req.type];
}

/** A requirement group that can select a PLAYER: an explicit `"player"`, or
 *  `"any"` (CR 115.4 — "any target" includes each player). */
function declaresPlayer(reqs: (TargetRequirement | undefined)[]): boolean {
    return reqs.some((r) =>
        requirementTypes(r).some((t) => t === "player" || t === "any")
    );
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
                if (declaresPlayer(requirementsOf(carrier))) continue;
                // A dynamic requirement is computed per-activation and cannot
                // be read statically — it is a declaration all the same.
                if (carrier?.getTargetRequirement) continue;
                offenders.push(
                    `${site.label} [${site.site}] — "${site.oracle.replace(/\n/g, " | ")}"`
                );
            }
        }
        expect(offenders).toEqual([]);
    });

    it("every allowlisted site really declares its player target on a nested reflexive trigger", () => {
        // The allowlist is not a blanket skip: each entry must still prove the
        // target IS declared, just at a site the row-level scan cannot see.
        const unproven: string[] = [];
        for (const entry of ALLOWLIST) {
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

    it("every allowlist entry carries a reason", () => {
        for (const entry of ALLOWLIST) {
            expect(
                entry.reason.length,
                `${entry.cardId} ${entry.site}`
            ).toBeGreaterThan(20);
        }
    });
});
