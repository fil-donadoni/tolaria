import { describe, it, expect } from "vitest";
import { getAllCards } from "../index";
import { getManaTapOptionsDetailed } from "../../gre/constants";
import { makeInstance, makePlayer, makeState } from "./setup";
import type { ActivatedAbility, ManaCost } from "../types";

/**
 * Catalogue-wide mana-ability sweep (CR 605.1a).
 *
 * Every non-stack mana ability in the catalogue is activated through the real
 * engine authority — `getManaTapOptionsDetailed`, the single list the tap
 * mutation, the auto-tap solver and the client picker all read (CR 106.1) — and
 * the output it offers is compared against what the card declares.
 *
 * ── Why this sweep exists ────────────────────────────────────────────────────
 * It replaces ~40 hand-copied per-card snapshots deleted in #2363. Those blocks
 * read `ability.manaProduced` and asserted it equalled `{ G: 1 }` — the
 * definition compared with itself, green on a mana dork the engine never offers
 * and red on a correct errata. Every card they "covered" is covered here
 * instead, and covered better: the assertion now fails when the ENGINE stops
 * offering the mana, which is the only way this can actually break.
 *
 * The gap it closes is real and was measured: `activation-affordability
 * .catalogue.test.ts` is the only other `getAllCards()`-driven sweep over
 * `activatedAbilities`, and it skips `useStack: false` abilities by design
 * ("mana abilities aren't macro-offered"). Before this file, no catalogue sweep
 * called a mana entry point at all.
 *
 * ── What it asserts, and what it deliberately does not ───────────────────────
 * For each card with at least one fixed-output tap mana ability, the option
 * list `getManaTapOptionsDetailed` returns must CONTAIN an entry whose
 * provenance is that ability and whose mana equals its declared `manaProduced`.
 * The list is searched rather than compared whole: a card may legitimately
 * expose more options than one ability (a dual land's basic subtypes, a second
 * printed ability), and pinning the whole list per card would re-import exactly
 * the brittleness this sweep was written to remove.
 *
 * **The load-bearing half is PRESENCE, and it is worth being precise about why.**
 * For a fixed-output ability the engine returns `ability.manaProduced` more or
 * less verbatim, so the colour comparison is close to tautological on its own —
 * it earns its place only by catching the engine TRANSFORMING the value (a
 * dynamic `manaAmount` override, a land-mana substitution, a dedup that keeps
 * the wrong provenance). What is not tautological at all is that the ability
 * reaches the list: it must survive `getEffectiveActivatedAbilities`,
 * `abilitiesSuppressed`, the zero-output rule, the sacrifice fallback and the
 * dedup. Deleting one line of that pipeline turns 63 cards into dead mana
 * sources with every card definition still perfectly correct — which is the
 * failure this sweep was proven against.
 *
 * Skipped, with the reason recorded and asserted non-empty:
 *   - `manaChoices` / `manaColorSource` abilities — the offered list is a
 *     board-dependent CHOICE whose index is load-bearing; a generic fixture
 *     cannot say which entry is right without re-deriving the engine's own
 *     logic, which would make the assertion vacuous.
 *   - abilities the engine drops from the option list by rule: a zero-output
 *     `manaAmount` hook (CR 605.1a / #1889 — Everflowing Chalice with no
 *     counters), and a `canActivate` gate a bare-battlefield fixture fails.
 *   - abilities whose cost is not `{T}`-based, since the fixture taps nothing.
 *   - a SACRIFICE-cost mana ability on a card that also has a non-destructive
 *     one. `getManaTapOptionsDetailed` offers sacrifice options only as a last
 *     resort ("prefer non-destructive options; fall back … only when there is
 *     no other way to tap this source"), so a sac-land's second ability is
 *     absent from the list by design — Havenwood Battleground's `{T}, Sac:
 *     Add {G}{G}` is correctly hidden behind its plain `{T}: Add {G}`.
 */

/** Every descriptor that makes a `useStack: false` ability RECOGNISABLE as a
 *  mana ability (CR 605.1a). The engine and the client both answer "is this a
 *  mana ability" by exactly this disjunction — `getActivatedManaAbility` /
 *  `isUntappedManaSource` / `hasNonManaActivatedAbility` (`gre/constants.ts`)
 *  and `findClientManaAbility` (`src/lib/card-utils.ts`). An ability declaring
 *  NONE of them is invisible to all of them at once. */
function declaresManaOutput(a: ActivatedAbility): boolean {
    return (
        a.manaProduced !== undefined ||
        a.manaChoices !== undefined ||
        a.manaColorSource !== undefined ||
        a.getManaChoices !== undefined
    );
}

/** A tap mana ability with a FIXED declared output — the assertable shape. */
function fixedTapManaAbilities(
    abilities: readonly ActivatedAbility[] | undefined
): ActivatedAbility[] {
    return (abilities ?? []).filter(
        (a) =>
            a.useStack === false &&
            a.manaProduced !== undefined &&
            a.manaChoices === undefined &&
            a.manaColorSource === undefined
    );
}

function totalMana(mana: ManaCost): number {
    return Object.values(mana).reduce<number>(
        (sum, n) => sum + (typeof n === "number" ? n : 0),
        0
    );
}

interface Skip {
    card: string;
    abilityId: string;
    reason: string;
}

interface Sweep {
    checked: number;
    cards: Set<string>;
    skips: Skip[];
    failures: string[];
}

function sweep(): Sweep {
    const result: Sweep = {
        checked: 0,
        cards: new Set(),
        skips: [],
        failures: [],
    };

    for (const def of getAllCards()) {
        const abilities = fixedTapManaAbilities(def.activatedAbilities);
        if (abilities.length === 0) continue;

        const instance = makeInstance(def.id, {
            id: `sweep-${def.id}`,
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [instance] }),
                makePlayer("p2"),
            ],
        });
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));
        const options = getManaTapOptionsDetailed(instance, "p1", battlefields);

        for (const ability of abilities) {
            const label = `${def.name} (${def.id}) / ${ability.id}`;
            const declared = ability.manaProduced!;

            // ADR 0039 — a one-shot mana ability is activated by TAPPING
            // and/or SACRIFICING the source (Lion's Eye Diamond sacrifices
            // without tapping), and both shapes reach the option list. An
            // ability paid for with mana or counters instead (Channel,
            // Rasputin Dreamweaver) is not a tap option at all.
            if (!ability.cost?.tap && !ability.cost?.sacrifice) {
                result.skips.push({
                    card: def.name,
                    abilityId: ability.id,
                    reason: "activated by paying mana/counters, not by tapping or sacrificing — not a tap option",
                });
                continue;
            }
            if (ability.manaAmount) {
                result.skips.push({
                    card: def.name,
                    abilityId: ability.id,
                    reason: "board-conditional manaAmount — output depends on a board this fixture does not build (CR 605.1a / #1889)",
                });
                continue;
            }
            if (totalMana(declared) === 0) {
                result.skips.push({
                    card: def.name,
                    abilityId: ability.id,
                    reason: "declared output is zero mana — the engine omits it from the payment list by rule (CR 605.1a / #1889)",
                });
                continue;
            }
            if (
                ability.cost?.sacrifice &&
                abilities.some((other) => !other.cost?.sacrifice)
            ) {
                result.skips.push({
                    card: def.name,
                    abilityId: ability.id,
                    reason: "sacrifice-cost mana ability shadowed by a non-destructive one — the engine offers sacrifice options only as a last resort",
                });
                continue;
            }
            if (ability.canActivate) {
                const offered = options.some(
                    (o) =>
                        o.source.kind === "activated" &&
                        o.source.abilityId === ability.id
                );
                if (!offered) {
                    result.skips.push({
                        card: def.name,
                        abilityId: ability.id,
                        reason: "canActivate gate is unsatisfied on a bare battlefield",
                    });
                    continue;
                }
            }

            result.checked++;
            result.cards.add(def.id);
            const match = options.find(
                (o) =>
                    o.source.kind === "activated" &&
                    o.source.abilityId === ability.id
            );
            if (!match) {
                result.failures.push(
                    `${label}: declares a {T} mana ability producing ` +
                        `${JSON.stringify(declared)}, but getManaTapOptionsDetailed ` +
                        `offers no option from it. The card is unusable as a mana ` +
                        `source: the auto-tap solver and the client picker both read ` +
                        `this list. Offered: ${JSON.stringify(options)}.`
                );
                continue;
            }
            const declaredKey = JSON.stringify(
                Object.fromEntries(
                    Object.entries(declared).filter(([, n]) => n)
                )
            );
            const offeredKey = JSON.stringify(
                Object.fromEntries(
                    Object.entries(match.mana).filter(([, n]) => n)
                )
            );
            if (declaredKey !== offeredKey) {
                result.failures.push(
                    `${label}: declares ${declaredKey} but the engine offers ` +
                        `${offeredKey}. A player tapping it gets the second one.`
                );
            }
        }
    }
    return result;
}

const RESULT = sweep();

describe("mana abilities, catalogue-wide (CR 605.1a)", () => {
    it("every fixed-output {T} mana ability is offered by the engine, producing what it declares", () => {
        expect(RESULT.failures, RESULT.failures.join("\n\n")).toEqual([]);
    }, 120_000);

    it("the sweep is not vacuous — it reached a substantial slice of the catalogue", () => {
        // Without this, a filter that accidentally matches nothing turns the
        // assertion above into a green no-op forever. The floor is well under
        // the current count so it tracks a real regression, not catalogue churn.
        expect(RESULT.checked).toBeGreaterThan(50);
        expect(RESULT.cards.size).toBeGreaterThan(40);
    });

    // ── The sweep's own blind spot, closed (CR 605.1a) ──────────────────────
    // `fixedTapManaAbilities` selects on `manaProduced !== undefined`, so an
    // ability that declares NO mana descriptor at all is filtered out of the
    // sweep above rather than failing it: the shape is invisible to the sweep
    // for exactly the reason it is broken in the game. Shelldock Isle shipped
    // that way — a `useStack: false` "{T}: Add {U}." whose only output was an
    // `effect: (ctx) => ctx.addMana(...)` closure, which a fixed-output tap
    // ability never executes (the mana is deposited structurally from
    // `manaProduced`). Result: the land was not a mana source on ANY surface —
    // no tap-for-mana affordance, no entry in `getManaTapOptionsDetailed`, not
    // counted by the bot — leaving only its {U},{T} hideaway-play ability
    // clickable, which nothing on the board could pay for.
    it("every non-stack ability declares a mana output descriptor", () => {
        const undeclared: string[] = [];
        for (const def of getAllCards()) {
            for (const a of def.activatedAbilities ?? []) {
                if (a.useStack === false && !declaresManaOutput(a)) {
                    undeclared.push(
                        `${def.name} (${def.id}) / ${a.id}: "${a.oracleText ?? ""}" is ` +
                            `useStack: false but declares none of manaProduced / ` +
                            `manaChoices / manaColorSource / getManaChoices, so no ` +
                            `mana authority (engine tap options, client tap ` +
                            `affordance, bot mana census) can see it produce mana. ` +
                            `An \`effect\`/\`effects\` body is NOT enough: a fixed-output ` +
                            `tap ability never runs one.`
                    );
                }
            }
        }
        expect(undeclared, undeclared.join("\n\n")).toEqual([]);
    });

    it("every skipped ability records why it was skipped", () => {
        for (const skip of RESULT.skips) {
            expect(
                skip.reason.trim().length,
                `skip without a reason: ${skip.card} / ${skip.abilityId}`
            ).toBeGreaterThan(0);
        }
        if (RESULT.skips.length > 0) {
            console.info(
                `[mana catalogue sweep] checked ${RESULT.checked} abilities ` +
                    `across ${RESULT.cards.size} cards; skipped ${RESULT.skips.length}:\n` +
                    RESULT.skips
                        .map(
                            (s) =>
                                `  SKIP ${s.card} / ${s.abilityId}: ${s.reason}`
                        )
                        .join("\n")
            );
        }
    });
});
