// The zone a cast comes from, what it PAYS from there, and the stack flags it
// stamps — the one authority every cast site reads (issue #2971).
//
// These four helpers used to live in `convex/game.ts`, beside the mutations
// that call them. That was fine while the only readers were mutations; it
// stopped being fine the moment the Bot's move enumerator (`gre/moves.ts`)
// needed the same answers, because `game.ts` imports the enumerator — so a
// direct import would be a cycle, and the alternative (a second, parallel
// cost table inside the enumerator) is precisely the divergence every comment
// in here warns about. Moved down into `gre/` unchanged; `game.ts` re-exports
// them, so every existing importer — including a dozen tests that pull them
// from `"../../game"` — is untouched.
//
// Nothing here reads a mutation, a ctx, or the database: it is a pure function
// of `GameState` plus the card, which is what makes the move legal to make.

import { getInstanceManaCost } from "../cards";
import type { ManaCost } from "../cards/types";
import type { CardInstanceState, GameState } from "./state";
import { getMadnessCost } from "./madness";
import { hasEscape, getEscapeManaCost } from "./escape";
import { hasFlashback, getFlashbackCost } from "./flashback";
import { hasRetrace } from "./retrace";
import { hasRebound } from "./rebound";
import { canCastSpellsFromTopOfLibrary, libraryTopCastLifeCost } from "./rules";

/** The zone a cast originates from (CR 601.3). Normally the hand; exile for
 *  Ice Cauldron's noted card; graveyard for a Flashback cast (CR 702.34);
 *  library for a cast off the TOP under a cast-from-top permission
 *  (CR 601.3, Bolas's Citadel). */
export type CastFromZone = "hand" | "exile" | "graveyard" | "library";

/** CR 702.34 — the stack-item flags a Flashback cast (from the graveyard) adds:
 *  `castFromGraveyard` (read by "if this spell was cast from a graveyard"
 *  clauses) and `exileOnResolve` (so `finalizeSpellResolution` exiles the card
 *  instead of returning it to the graveyard). Empty for a normal hand/exile
 *  cast. Exported for the flashback integration test (issue #944 pattern). */
export function flashbackStackFlags(zone: CastFromZone): {
    exileOnResolve?: true;
    castFromGraveyard?: true;
} {
    return zone === "graveyard"
        ? { exileOnResolve: true, castFromGraveyard: true }
        : {};
}

/** CR 702.34 / 702.138 / 305.1-analog / 117.6-analog — the stack-item flags a
 *  graveyard cast adds, choosing between Escape, Flashback, and every OTHER
 *  graveyard-cast mechanism by the card's live capability:
 *   - Escape (CR 702.138b): `castFromGraveyard` + `escaped` — the resulting
 *     permanent escaped. NO `exileOnResolve` (the card resolves normally).
 *   - Flashback (CR 702.34a): `castFromGraveyard` + `exileOnResolve` — the card
 *     is exiled as it leaves the stack.
 *   - Permission cast (CR 305.1-analog / 601, issue #1149, Yawgmoth's Will)
 *     OR a per-card grant (issue #1344, Malcolm, Alluring Scoundrel):
 *     `castFromGraveyard` only — the card resolves and lands in the graveyard
 *     normally, exactly like a hand cast, no exile / no `escaped`. Both share
 *     this same fallback branch — a granted card is never also Flashback/
 *     Escape in practice, so no extra disambiguation is needed.
 *  A non-graveyard cast adds nothing. Exported for the escape integration test. */
export function graveyardCastStackFlags(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): { exileOnResolve?: true; castFromGraveyard?: true; escaped?: true } {
    if (zone !== "graveyard") return {};
    if (hasEscape(state, card)) {
        return { castFromGraveyard: true, escaped: true };
    }
    if (hasFlashback(card)) {
        return flashbackStackFlags(zone);
    }
    // CR 614.1 / 400.7 (issue #2380) — a per-card grant may carry an
    // "if that spell would be put into your graveyard, exile it instead"
    // rider (Jace, Telepath Unbound's −3). Checked BEFORE the plain-grant
    // fallback below and routed through the SAME `exileOnResolve` flag
    // Flashback uses, so there is exactly one exile-as-it-leaves-the-stack
    // path rather than a second parallel one.
    if (card.castFromGraveyardExilesOnResolve) {
        return { castFromGraveyard: true, exileOnResolve: true };
    }
    // CR 702.81a (issue #2358) — a RETRACE cast.
    //
    // THIS BRANCH IS DOCUMENTATION, NOT CONTROL FLOW: it returns exactly the
    // same object as the fallback three lines below, so deleting it changes no
    // behaviour and reds no test (issue #2358 review, finding 3 — the original
    // proof-of-failure claim for it was wrong; only ADDING `exileOnResolve`
    // here reds `retrace.test.ts`). It is kept deliberately, because the
    // ABSENCE of `exileOnResolve` is the mechanic's headline divergence from
    // Flashback and is worth stating where the choice between mechanisms is
    // made: CR 702.81a says nothing about exiling, so a retraced instant or
    // sorcery finishes resolving and is put into its owner's graveyard
    // (CR 608.2m) — which is exactly what makes it retraceable again, bounded
    // only by the lands left in hand to discard. `escaped` is likewise absent:
    // retrace is an ADDITIONAL cost, not the escape alternative cost, so
    // nothing escaped. The behaviour itself IS asserted, on the fallback's
    // output, by `retrace.test.ts`'s `graveyardCastStackFlags` and end-to-end
    // resolve cases.
    if (hasRetrace(state, card)) {
        return { castFromGraveyard: true };
    }
    // CR 305.1-analog / 601 (issue #1149) / 117.6-analog (issue #1344) —
    // neither Escape nor Flashback: this is a plain cast under the BROAD
    // graveyard-cast permission (Yawgmoth's Will) or a per-card grant
    // (Malcolm). No exile-on-resolve, no `escaped` — the card resolves and
    // lands in the graveyard exactly like any other spell (CR 608.2m).
    return { castFromGraveyard: true };
}

/** CR 702.88a — the stack-item flag a Rebound cast adds: `reboundFromHand`,
 *  read by `finalizeSpellResolution` (state.ts) to redirect the resolving
 *  spell to exile (instead of the graveyard) and schedule its next-upkeep
 *  reflexive Cast/Decline trigger. Gated on BOTH the card having rebound AND
 *  the cast originating from HAND — this single gate is what makes CR
 *  702.88a free: the later exile recast has `zone === "exile"`, so it never
 *  re-stamps the flag and can never rebound again. Empty for every other
 *  cast (a card with no rebound, or a rebound card recast from exile/
 *  graveyard). Exported for symmetry with `flashbackStackFlags` / a future
 *  integration test. */
export function reboundCastStackFlags(
    card: CardInstanceState,
    zone: CastFromZone
): { reboundFromHand?: true } {
    return zone === "hand" && hasRebound(card) ? { reboundFromHand: true } : {};
}

/** The mana cost a cast pays: the Escape cost or Flashback cost when cast from
 *  the graveyard (CR 702.138a / 702.34a — "rather than paying its mana cost"),
 *  the card's normal printed mana cost under the BROAD graveyard-cast
 *  permission (CR 305.1-analog / 601, issue #1149 — Yawgmoth's Will pays no
 *  alternative cost, just the printed one), else the card's printed mana cost
 *  for a hand/exile cast. Exported for the flashback/escape integration tests
 *  (issue #944 pattern). */
/** CR 118.9-analog / 119.4 / 107.3b (issue #2398, Bolas's Citadel) — the
 *  payment a cast owes INSTEAD of its mana cost when it comes off the top of
 *  the caster's library under a permission that replaces the mana cost.
 *  `undefined` for every other cast (including a library-top cast under a
 *  permission with no replacement — Vizier of the Menagerie's shape — which
 *  simply pays the printed cost).
 *
 *  The caster is the library's OWNER: `zone === "library"` is only ever
 *  produced by `locateCastSource`'s own-library branch, and no cross-player
 *  library-cast primitive exists (mirroring `castZoneOwner`'s reasoning for
 *  the graveyard).
 *
 *  One helper feeds BOTH halves of the substitution — `castRawManaCost` zeroes
 *  the mana, and each of the two cast-commit life accumulators (the targeted
 *  `finalizeTargetSelection` path and the no-target `announceCast` path) adds
 *  `.life` — so the two can never disagree about whether this cast is free.
 *  It is ALSO the CR 107.3b / 601.2b discriminator at announcement: an `{X}`
 *  is locked to 0 and no alternative cost may ride along on this cast. */
export function libraryTopCastPayment(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): { life: number } | undefined {
    if (zone !== "library") return undefined;
    const owner = state.players.find((p) => p.id === card.ownerId);
    if (!owner) return undefined;
    const grant = canCastSpellsFromTopOfLibrary(state, owner);
    if (grant?.manaCostReplacement !== "life-equal-to-mana-value") {
        return undefined;
    }
    return { life: libraryTopCastLifeCost(state, owner, card) };
}

export function castRawManaCost(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): ManaCost | undefined {
    // CR 601.3 / 117.6 (issue #1156) — Dauthi Voidwalker's "play it without
    // paying its mana cost" free-cast waiver: this specific exile-sourced
    // card was granted a cost-free cast (`SpellContext.grantCastFromExile`'s
    // `withoutPayingManaCost` option). Checked BEFORE the Madness branch — a
    // card can't carry both markers in practice (they come from unrelated
    // exile sources), but the free-cast waiver wins if it ever did, since
    // "no cost is required" is stronger than any specific alternative cost.
    if (zone === "exile" && card.castFromExileWithoutPayingManaCost) {
        return {};
    }
    // CR 702.35a — a card discarded via Madness is cast from exile for its
    // madness cost, not its printed mana cost. `Madness {0}` is the empty cost.
    if (zone === "exile" && card.madnessExiled) {
        return getMadnessCost(card) ?? {};
    }
    // CR 118.9-analog / 119.4 (issue #2398, Bolas's Citadel) — a cast made
    // under a cast-from-top-of-library permission whose `manaCostReplacement`
    // is `"life-equal-to-mana-value"` pays NO mana at all: the whole mana cost
    // is replaced by a life payment charged at commit
    // (`castLifeInsteadOfMana`, deducted alongside every other life leg).
    // Returning `{}` here — not `undefined` — is what makes the mana half free
    // at every cost site (`normalizeManaCost`, the pool-coverage gate, the
    // auto-tap solver) without any of them learning about the permission.
    if (libraryTopCastPayment(state, card, zone)) {
        return {};
    }
    if (zone !== "graveyard") return getInstanceManaCost(card);
    // CR 601.3 / 117.6-analog (issue #1344) — Malcolm, Alluring Scoundrel's
    // "cast the discarded card without paying its mana cost" free-cast
    // waiver: this specific graveyard-sourced card was granted a cost-free
    // cast (`SpellContext.grantCastFromGraveyard`'s `withoutPayingManaCost`
    // option). Checked BEFORE Escape/Flashback/the broad permission below —
    // the free-cast waiver wins if a card somehow carried more than one
    // marker, since "no cost is required" is stronger than any specific
    // alternative cost (mirrors the exile branch's own precedence above).
    if (card.castFromGraveyardWithoutPayingManaCost) {
        return {};
    }
    // CR 702.138a — an escape cast pays the escape mana cost; a card never has
    // both escape and flashback, so this preference is unambiguous.
    if (hasEscape(state, card)) return getEscapeManaCost(state, card);
    // CR 702.34a — a Flashback cast pays the flashback mana cost, which may be
    // ABSENT for a purely non-mana flashback (Lava Dart: "Sacrifice a
    // Mountain", no mana portion) — `undefined` here correctly means "no mana
    // to pay", NOT "fall back to the printed cost".
    if (hasFlashback(card)) return getFlashbackCost(card);
    // CR 305.1-analog / 601 (issue #1149) — neither Escape nor Flashback: a
    // plain cast under the BROAD graveyard-cast permission (Yawgmoth's Will)
    // pays the card's normal printed mana cost.
    return getInstanceManaCost(card);
}
