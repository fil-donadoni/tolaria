import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import { declaresAsEntersMode } from "@convex/gre/constants";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";
import {
    affordableAltCostsForCard,
    affordableKickersForCard,
    manaCostToString,
    payableAdditionalCostLegsForCard,
    phyrexianSplitChoices,
    type PhyrexianSplitChoice,
} from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";
import ModePicker from "~/components/cards/mode-picker";
import AltCostPicker from "~/components/cards/alt-cost-picker";
import PhyrexianPicker from "~/components/cards/phyrexian-picker";
import AdditionalCostPicker from "~/components/cards/additional-cost-picker";
import CastCostDialog from "~/components/cards/cast-cost-dialog";
import type { AdditionalCostLeg, AlternativeCost } from "@convex/cards/types";

type ModePickerState = {
    chosenX: number | undefined;
    kickerPayments: Record<string, number> | undefined;
    buyback: boolean | undefined;
    payFlashSurcharge: boolean | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
};

type AltCostPickerState = {
    chosenX: number | undefined;
    kickerPayments: Record<string, number> | undefined;
    buyback: boolean | undefined;
    payFlashSurcharge: boolean | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    /** The alternative costs the caster can currently afford (CR 118.9) — the
     *  picker offers exactly these plus "Pay mana cost". Filtered at open time
     *  so a condition-failing / unaffordable alt is never shown. */
    altCosts: AlternativeCost[];
};

/** CR 601.2b / 118.8 — open state for the caster-chosen ADDITIONAL-cost picker
 *  ("discard a card or pay 3 life"). Present while the caster picks a leg; the
 *  chosen id rides `announceCast`'s `additionalCostLegId`. */
type AdditionalCostPickerState = {
    chosenX: number | undefined;
    kickerPayments: Record<string, number> | undefined;
    buyback: boolean | undefined;
    payFlashSurcharge: boolean | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    /** The legs the caster can currently AFFORD (CR 601.2h) — an unpayable leg
     *  is never offered, so clicking a row can't throw a hard rejection. */
    legs: AdditionalCostLeg[];
};

/** CR 107.4f — open state for the Phyrexian mana-vs-life split picker. Present
 *  while the caster picks how many `{C/P}` pips to pay with life; the chosen
 *  value rides `announceCast`'s `phyrexianLifePips`. */
type PhyrexianPickerState = {
    chosenX: number | undefined;
    kickerPayments: Record<string, number> | undefined;
    buyback: boolean | undefined;
    payFlashSurcharge: boolean | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    choices: PhyrexianSplitChoice[];
    /** CR 601.2b — the additional-cost leg already chosen upstream, carried so
     *  the final dispatch still sends it (the Phyrexian step is downstream of
     *  the leg picker in CR 601.2b's own announcement order). */
    additionalCostLegId: string | undefined;
};

/** Cost-choice dialog state (CR 601.2b {X} + CR 702.33 Kicker + CR 702.27 buyback
 *  ). Opened before the mode / alt-cost pickers when the card needs a
 *  numeric X and/or a kicker/buyback decision; `position` is captured at click
 *  time so the downstream pickers can still anchor to the card after the
 *  dialog closes. */
type CostDialogState = {
    keepPriority: boolean | undefined;
    askX: boolean;
    kickers: { id: string; description: string; multi: boolean }[] | undefined;
    buyback: boolean;
    /** CR 601.3c — the rendered surcharge ("{2}") when the server says casting
     *  this card right now owes it; `undefined` at sorcery speed. */
    flashSurcharge: string | undefined;
    position: { x: number; y: number };
};

/** The shared hand-card commit pipeline (PRD #249, slice #254).
 *
 * Both clicking a hand card (classic board / `selectable-card`) and dragging it
 * out of the hand past the commit threshold (spatial board / drag-to-cast)
 * dispatch the SAME GRE-boundary mutation — `playCard` for lands, `announceCast`
 * for spells — through this one hook. Extracting it guarantees drag and click
 * are provably identical: the cost-choice dialog (X — CR 601.2b — and Kicker —
 * CR 702.33), the modal mode picker (CR 700.2), the `ctrl/meta` keep-priority
 * modifier, and the debug skip-validation flag all run once here and behave the
 * same regardless of which gesture invoked them. Downstream flow (payment
 * banner, target selection) is untouched because the mutation args are
 * identical.
 *
 * Returns the two commit handlers plus overlay nodes (cost-choice dialog, mode
 * picker, alt-cost picker), which the caller renders so each anchors correctly
 * to its card. Each overlay is `null` until its step of the cast is in
 * progress.
 *
 * `opts.onCommitted` fires exactly when the cast/play is actually DISPATCHED to
 * the server — NOT when the button is clicked. This distinction matters for a
 * reveal-dialog host (graveyard Flashback / exile Cast buttons): a cast gated
 * behind a cost dialog (X — CR 601.2b, Kicker, alt-cost, Phyrexian, mode) is
 * deferred, and the dialog overlays are rendered by the SAME component that owns
 * this button. If the host closed the reveal on click, it would unmount those
 * overlays before the caster chose X — the dialog would flash and vanish with no
 * cast. Firing `onCommitted` only at the real dispatch point keeps the reveal
 * (and its overlays) mounted through the whole choice sequence. */
export function useHandCardCommit(
    cardInstance: CardInstance,
    opts?: { onCommitted?: () => void }
) {
    const { gameId, playerId, debugAllActions, allPlayers, activePlayerId } =
        useGameContext();
    const { reportError } = usePendingChoiceBuffer();
    const playCard = useMutation(api.game.playCard);
    const announceCast = useMutation(api.game.announceCast);

    const [modePickerState, setModePickerState] =
        useState<ModePickerState | null>(null);
    const [altCostPickerState, setAltCostPickerState] =
        useState<AltCostPickerState | null>(null);
    const [phyrexianPickerState, setPhyrexianPickerState] =
        useState<PhyrexianPickerState | null>(null);
    const [additionalCostPickerState, setAdditionalCostPickerState] =
        useState<AdditionalCostPickerState | null>(null);
    const [costDialogState, setCostDialogState] =
        useState<CostDialogState | null>(null);

    const onPlayClick = () => {
        // A second commit fired inside the first one's round trip is always a
        // doomed dispatch (the engine is parked on the first: "Another spell is
        // already being cast" / "the game is waiting for target input"), and in
        // production the player sees it only as an opaque "Server Error". Drop
        // it here — the single dispatch point every gesture funnels through
        // (click, action sheet, tap-stage confirm, drag/swipe), so the guard
        // can't be bypassed by adding another surface.
        if (hasPendingGameIntent()) return;
        // Route a server-side rejection to the shared error toast instead of
        // leaving it as an uncaught promise rejection in the console.
        trackGameIntent(
            Promise.resolve(
                playCard({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                    skipValidation: debugAllActions || undefined,
                })
            )
        ).catch(reportError);
        // The play is dispatched (a land drop has no deferred cost dialog), so
        // the reveal-dialog host may close now.
        opts?.onCommitted?.();
    };

    function commitAnnounceCast(args: {
        chosenX: number | undefined;
        keepPriority: boolean | undefined;
        chosenModeId: string | undefined;
        alternativeCostId?: string | undefined;
        kickerPayments?: Record<string, number> | undefined;
        buyback?: boolean | undefined;
        /** CR 601.3c — the caster's acknowledgement of a MANDATORY
         *  conditional-flash surcharge. The server derives and charges it
         *  either way; sending it lets `announceCast` reject a claim on a card
         *  that declares none. */
        payFlashSurcharge?: boolean | undefined;
        /** CR 107.4f — how many `{C/P}` pips the caster chose to pay with life. */
        phyrexianLifePips?: number | undefined;
        /** CR 601.2b / 118.8 — which leg of a caster-chosen ADDITIONAL cost to
         *  pay ("discard a card or pay 3 life"). Required by the server for a
         *  card declaring `additionalCosts.oneOf`, rejected for any other. */
        additionalCostLegId?: string | undefined;
    }) {
        // Every pre-cast picker is DONE the moment the cast is dispatched —
        // clear them all here rather than trusting each picker to close itself.
        // The cast's next step often opens its own surface immediately (Lorehold
        // Charm's second mode announces a graveyard target, so the graveyard
        // dialog appears at once); a picker left standing behind it re-offers a
        // decision that has already been made, which reads as if the click
        // hadn't registered. One clear-all at the single dispatch point closes
        // the whole class, whichever picker opened it.
        setModePickerState(null);
        setAltCostPickerState(null);
        setPhyrexianPickerState(null);
        setAdditionalCostPickerState(null);
        setCostDialogState(null);
        // Same in-flight drop as `onPlayClick` — a double swipe / double click
        // never reaches the server twice.
        if (hasPendingGameIntent()) return;
        trackGameIntent(
            Promise.resolve(
                announceCast({
                    gameId,
                    playerId,
                    cardInstanceId: cardInstance.id,
                    keepPriority: args.keepPriority,
                    chosenX: args.chosenX,
                    chosenModeId: args.chosenModeId,
                    alternativeCostId: args.alternativeCostId,
                    kickerPayments: args.kickerPayments,
                    buyback: args.buyback,
                    payFlashSurcharge: args.payFlashSurcharge,
                    phyrexianLifePips: args.phyrexianLifePips,
                    additionalCostLegId: args.additionalCostLegId,
                })
            )
        ).catch(reportError);
        // The cast is now dispatched (after any cost dialog / picker sequence),
        // so the reveal-dialog host may close. Firing here — not on click —
        // keeps the dialog overlays mounted through the whole choice sequence
        // for a deferred (X / kicker / alt-cost / Phyrexian / modal) cast.
        opts?.onCommitted?.();
    }

    // Resume the cast pipeline once the cost choices (X / kicker) are known:
    // CR 700.2 modal mode picker, then CR 118.9 alternative-cost picker, then
    // the actual `announceCast`. Factored out of `onCastClick` so the same tail
    // runs whether the choices came from the `CastCostDialog` or (for a card
    // with neither X nor kicker) directly. `position` is captured at click time
    // so the mode / alt-cost pickers still anchor to the card.
    function proceedAfterCost(params: {
        chosenX: number | undefined;
        kickerPayments: Record<string, number> | undefined;
        buyback: boolean | undefined;
        payFlashSurcharge: boolean | undefined;
        keepPriority: boolean | undefined;
        position: { x: number; y: number };
        /** CR 601.2b / 118.8 — set once the caster has picked a leg of a
         *  caster-chosen ADDITIONAL cost; the leg picker below re-enters this
         *  same tail with it filled in, so the remaining announcement steps
         *  (Phyrexian split, dispatch) run identically either way. `undefined`
         *  on the first pass — which is exactly the "not asked yet" signal the
         *  leg gate reads. */
        additionalCostLegId?: string | undefined;
    }) {
        const {
            chosenX,
            kickerPayments,
            buyback,
            payFlashSurcharge,
            keepPriority,
            position,
            additionalCostLegId,
        } = params;
        const def = getDefinition(cardInstance.card.id);
        // CR 700.2 — modal spell: pick a mode before announcement.
        // CR 614.12a (issue #2019) — but NOT when the card's pick is an
        // as-enters choice (Voice of All, Prismatic Ward, Quirion Elves,
        // Jihad): that choice is raised by the engine as the permanent ENTERS,
        // on every entry path, and `announceCast` rejects a `chosenModeId` sent
        // at announcement for such a card.
        if (def.modes && def.modes.length > 0 && !declaresAsEntersMode(def)) {
            setModePickerState({
                chosenX,
                kickerPayments,
                buyback,
                payFlashSurcharge,
                keepPriority,
                position,
            });
            return;
        }
        // CR 118.9 — a spell with alternative casting costs (Gush, Thwart,
        // Fireblast): pick between paying mana and each alternative before
        // announcement. Not composed with modal spells (none of the alt-cost
        // cards are modal). Only alternatives whose cast-availability condition
        // AND affordability currently hold are offered — a condition-failing /
        // unpayable alt (Force of Negation on your turn, Snuff Out without a
        // Swamp) would otherwise throw a hard `announceCast` rejection on click.
        // With no affordable alternative the picker is skipped and the spell is
        // cast for its normal mana cost. CR 702.74a — Evoke IS an alternative
        // cost ("casting a spell for its evoke cost follows the rules for
        // paying alternative costs"); `def.evoke` lives in its own dedicated
        // field (not `alternativeCosts[]`, see the type doc), so the gate below
        // checks it too — `affordableAltCostsForCard` (delegating to the server's
        // `affordableAlternativeCosts`) already folds `def.evoke` into its
        // result either way. CR 702.109a — Dash gets the SAME treatment via
        // `def.dash` (its own dedicated field, mirroring `evoke`); unlike
        // Evoke, Dash's alt cost still carries a real mana leg
        // (`AlternativeCost.mana`), so picking it opens the normal cast-cost
        // payment flow with a DIFFERENT `manaCost` rather than skipping
        // payment entirely — `affordableAltCostsForCard` doesn't filter on
        // that leg (mana affordability is checked downstream by the normal
        // payment machinery, same as "Pay mana cost" itself is never
        // affordability-filtered here).
        // CR 702.103a — Bestow is likewise an alternative cost ("casting a
        // spell using its bestow ability follows the rules for paying
        // alternative costs"), in its own dedicated `def.bestow` field
        // mirroring `evoke`/`dash`. Picking it here is what makes the cast an
        // AURA cast: `announceCast` derives the "enchant creature" target
        // requirement from the chosen alt-cost id, so the target prompt the
        // player sees next differs by this click. `affordableAltCostsForCard`
        // already folds `def.bestow` in — and filters it out when no creature
        // is on the battlefield to enchant (CR 601.2c).
        //
        // CR 601.2b (issue #2398 review round 1, finding 3) — "A player can't
        // apply two alternative methods of casting or two alternative costs to
        // a single spell." Casting off the top of the library under a
        // permission that REPLACES the mana cost (Bolas's Citadel) already is
        // one such method, so NO alternative cost may be announced alongside
        // it — Bestow included, since it reaches `announceCast` as an ordinary
        // `alternativeCostId`. `announceCast` fails closed on that combination,
        // but a thrown mutation reachable from a legal click is a crash, not a
        // rule: with Gush on top under a Citadel this picker rendered "Return
        // two Islands" and selecting it threw. The gate belongs where the
        // option is OFFERED; the server throw stays as defense-in-depth.
        if (
            !cardInstance.castManaCostReplaced &&
            ((def.alternativeCosts && def.alternativeCosts.length > 0) ||
                def.evoke ||
                def.dash ||
                def.bestow)
        ) {
            const affordableAlts = affordableAltCostsForCard(
                cardInstance,
                playerId,
                allPlayers,
                activePlayerId
            );
            if (affordableAlts.length > 0) {
                setAltCostPickerState({
                    chosenX,
                    kickerPayments,
                    buyback,
                    payFlashSurcharge,
                    keepPriority,
                    position,
                    altCosts: affordableAlts,
                });
                return;
            }
        }
        // CR 601.2b / 118.8 — a spell with a CASTER-CHOSEN additional cost
        // ("As an additional cost to cast this spell, discard a card or pay 3
        // life", Bitter Triumph): the caster names one leg BEFORE targets
        // (CR 601.2c) and before any payment (CR 601.2h), so the picker opens
        // here and its answer rides `announceCast`'s `additionalCostLegId`.
        // Only PAYABLE legs are offered — an empty hand hides the discard leg,
        // 3-or-less life hides the life leg — so a click can never throw a
        // hard "Can't pay that additional cost" rejection; a card whose EVERY
        // leg is unpayable is not castable at all and `getLegalActions`
        // suppressed its Cast affordance upstream. The `undefined` guard is
        // what makes the picker's own re-entry fall through instead of
        // re-asking forever.
        if (additionalCostLegId === undefined) {
            const legs = payableAdditionalCostLegsForCard(
                cardInstance,
                playerId,
                allPlayers
            );
            if (legs.length > 0) {
                setAdditionalCostPickerState({
                    chosenX,
                    kickerPayments,
                    buyback,
                    payFlashSurcharge,
                    keepPriority,
                    position,
                    legs,
                });
                return;
            }
        }
        // CR 107.4f — a Phyrexian-mana spell whose `{C/P}` pips can be paid with
        // EITHER colour or 2 life (both legs affordable): let the caster pick the
        // split before announcement instead of silently auto-charging life. The
        // projection only attaches `phyrexianOptions` (≥ 2 entries) when the
        // branch is real; a degenerate zero-branch cost carries none and is
        // auto-resolved server-side.
        const phyrexianChoices = phyrexianSplitChoices(cardInstance);
        if (phyrexianChoices.length >= 2) {
            setPhyrexianPickerState({
                chosenX,
                kickerPayments,
                buyback,
                payFlashSurcharge,
                keepPriority,
                position,
                choices: phyrexianChoices,
                additionalCostLegId,
            });
            return;
        }
        commitAnnounceCast({
            chosenX,
            keepPriority,
            chosenModeId: undefined,
            kickerPayments,
            buyback,
            payFlashSurcharge,
            additionalCostLegId,
        });
    }

    const onCastClick = (e: React.MouseEvent | React.PointerEvent) => {
        const keepPriority = e.ctrlKey || e.metaKey || undefined;
        const def = getDefinition(cardInstance.card.id);
        // CR 107.3 / 601.2b: X in the mana cost is chosen before announcement.
        // CR 702.33: Kicker is an optional additional cost decided at cast time.
        // CR 702.27: Buyback is likewise an optional additional cost decided at
        // cast time.
        // Anchor on currentTarget (the handler-bound element) — more stable than
        // `e.target` which may be a nested child. Falls back to the pointer
        // coords if the rect is degenerate. Captured now so the downstream
        // mode / alt-cost pickers can still anchor after the cost dialog closes.
        // X is chosen before announcement whether it lives in the mana cost
        // (CR 107.3, e.g. Fireball) or is a "pay X life" additional cost
        // (CR 601.2b / 118.4, e.g. Toxic Deluge, Fire Covenant). Both send
        // `chosenX`, so both must open the cost dialog.
        // CR 107.3b (issue #2398 review round 1, finding 1) — when an effect
        // lets the caster cast this spell while paying neither its mana cost
        // nor an alternative cost that includes X (a cast off the top of the
        // library whose mana cost the permission replaced with life), "the only
        // legal choice for X is 0", so there is no choice to collect: offering
        // the stepper invites an announcement `announceCast` now rejects, and
        // before that clamp it silently bought X = 5 for zero mana and one life
        // (CR 202.3e prices the card at X = 0 off the stack). The `payXLife`
        // ADDITIONAL cost (Toxic Deluge, Fire Covenant) is unaffected — it is
        // not part of the replaced mana cost, so its X is still chosen here.
        const hasX =
            (typeof def.manaCost?.X === "string" &&
                !cardInstance.castManaCostReplaced) ||
            def.additionalCosts?.payXLife === true;
        const anchor = e.currentTarget as HTMLElement | null;
        const rect = anchor?.getBoundingClientRect();
        const position =
            rect && rect.width > 0 && rect.height > 0
                ? { x: rect.right + 8, y: rect.top }
                : { x: e.clientX + 8, y: e.clientY + 8 };
        // A spell needing an X value and/or a kicker/buyback decision collects
        // all of them in one in-game dialog (replacing the old native
        // prompt/confirm) before the cast pipeline resumes.
        // CR 702.33a — offer only the Kickers whose NON-MANA legs the caster can
        // actually pay (ADR 0079): a "sacrifice two lands" Kicker with one land
        // on the battlefield is not a real option, and the server would reject
        // it. Mana legs are NOT gated — they are paid by the deferred payment
        // path, so an empty pool must not hide the toggle.
        const offeredKickers = affordableKickersForCard(
            cardInstance,
            playerId,
            allPlayers,
            activePlayerId
        );
        // CR 601.3c — the conditional-flash SURCHARGE this cast owes right now,
        // read off the server-authoritative projection (`flashSurchargeRequired`
        // on the hand card) rather than re-derived: the client has no view of
        // cast timing at all. Rendered from the card's own declared cost so the
        // dialog quotes the real amount.
        const flashSurcharge = cardInstance.flashSurchargeRequired
            ? manaCostToString(def.flashSurcharge)
            : undefined;
        // The gate is an OR over "does this cast need a decision from the
        // caster at all". `flashSurcharge` belongs here and is easy to miss:
        // four of the five cards carrying the rider (Rout, Breaking Wave,
        // Twilight's Call, Saproling Symbiosis) have NO X, NO kicker and NO
        // buyback, so without this term they skip the dialog entirely and get
        // surcharged {2} with no warning at all.
        if (
            hasX ||
            offeredKickers.length > 0 ||
            def.buyback ||
            flashSurcharge !== undefined
        ) {
            setCostDialogState({
                keepPriority,
                askX: hasX,
                // CR 702.33 — one dialog row per independently payable Kicker,
                // each carrying its own cost text so a NON-MANA leg is legible
                // before the caster commits (ADR 0079).
                kickers: offeredKickers.map((k) => ({
                    id: k.id,
                    description: k.description,
                    multi: k.multi === true,
                })),
                buyback: def.buyback !== undefined,
                flashSurcharge,
                position,
            });
            return;
        }
        proceedAfterCost({
            chosenX: undefined,
            kickerPayments: undefined,
            buyback: undefined,
            payFlashSurcharge: undefined,
            keepPriority,
            position,
        });
    };

    const def = getDefinition(cardInstance.card.id);
    const modePickerOverlay =
        modePickerState && def.modes ? (
            <ModePicker
                modes={def.modes}
                cardName={def.name}
                variant="portal"
                position={modePickerState.position}
                onSelect={(modeId) => {
                    const {
                        chosenX,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        keepPriority,
                    } = modePickerState;
                    setModePickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: modeId,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                    });
                }}
                onCancel={() => setModePickerState(null)}
            />
        ) : null;

    const altCostPickerOverlay =
        altCostPickerState && altCostPickerState.altCosts.length > 0 ? (
            <AltCostPicker
                altCosts={altCostPickerState.altCosts}
                cardName={def.name}
                position={altCostPickerState.position}
                onSelect={(altCostId) => {
                    const {
                        chosenX,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        keepPriority,
                    } = altCostPickerState;
                    setAltCostPickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: undefined,
                        alternativeCostId: altCostId,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                    });
                }}
                onCancel={() => setAltCostPickerState(null)}
            />
        ) : null;

    const phyrexianPickerOverlay =
        phyrexianPickerState && phyrexianPickerState.choices.length >= 2 ? (
            <PhyrexianPicker
                choices={phyrexianPickerState.choices}
                cardName={def.name}
                position={phyrexianPickerState.position}
                onSelect={(lifePips) => {
                    const {
                        chosenX,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        keepPriority,
                        additionalCostLegId,
                    } = phyrexianPickerState;
                    setPhyrexianPickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: undefined,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        phyrexianLifePips: lifePips,
                        additionalCostLegId,
                    });
                }}
                onCancel={() => setPhyrexianPickerState(null)}
            />
        ) : null;

    const additionalCostPickerOverlay =
        additionalCostPickerState &&
        additionalCostPickerState.legs.length > 0 ? (
            <AdditionalCostPicker
                legs={additionalCostPickerState.legs}
                cardName={def.name}
                position={additionalCostPickerState.position}
                onSelect={(legId) => {
                    const {
                        chosenX,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        keepPriority,
                        position,
                    } = additionalCostPickerState;
                    setAdditionalCostPickerState(null);
                    // Re-enter the SAME announcement tail with the leg filled
                    // in, rather than dispatching from here: the Phyrexian
                    // split (CR 107.4f) is downstream of this choice in
                    // CR 601.2b's order, and a card carrying both must still
                    // see it.
                    proceedAfterCost({
                        chosenX,
                        kickerPayments,
                        buyback,
                        payFlashSurcharge,
                        keepPriority,
                        position,
                        additionalCostLegId: legId,
                    });
                }}
                onCancel={() => setAdditionalCostPickerState(null)}
            />
        ) : null;

    const costDialogOverlay = costDialogState ? (
        <CastCostDialog
            open
            cardName={def.name}
            askX={costDialogState.askX}
            // CR 702.34a / 118.5 — a flashback cast whose exile cost demands X
            // cards from the graveyard caps X at the payable count (projection's
            // `flashbackExileMaxX`); undefined for every other cast.
            maxX={cardInstance.flashbackExileMaxX}
            kickers={costDialogState.kickers}
            buyback={costDialogState.buyback}
            flashSurcharge={costDialogState.flashSurcharge}
            onConfirm={({
                chosenX,
                kickerPayments,
                buyback,
                payFlashSurcharge,
            }) => {
                const { keepPriority, position } = costDialogState;
                setCostDialogState(null);
                proceedAfterCost({
                    chosenX,
                    kickerPayments,
                    buyback,
                    payFlashSurcharge,
                    keepPriority,
                    position,
                });
            }}
            onCancel={() => setCostDialogState(null)}
        />
    ) : null;

    return {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
        additionalCostPickerOverlay,
        costDialogOverlay,
    };
}
