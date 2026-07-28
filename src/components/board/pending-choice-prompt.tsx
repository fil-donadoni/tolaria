import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";
import {
    mayPayCostLabel,
    mayPayRequiredSacrifices,
    mayPaySacrificeThreshold,
    mayPaySacrificeSelectionPower,
    mayPayRequiredDiscards,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";
import {
    pendingChoiceMin,
    pendingChoiceMax,
} from "~/lib/pending-choice-confirm";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import PendingChoiceOptions from "~/components/board/pending-choice-options";
import CardNameInput from "~/components/board/card-name-input";
import CardImage from "~/components/cards/card-image";
import RandomRevealOverlay from "~/components/board/random-reveal-overlay";
import MinimizeChoiceButton from "~/components/board/minimize-choice-button";
import TriggerOrderPrompt from "~/components/board/trigger-order-prompt";

/** Banner shown at the top-center of the board while a mid-resolution
 *  player choice is active (CR 608.2). Displays the prompt and, for the
 *  chooser, the progress (selected / max) and an explicit Skip/Done button
 *  for kinds that use the client-buffered submit model (ADR 0007). For the
 *  opponent, only a static "Waiting for X" line is shown — selection
 *  progress is private until submit.
 *
 *  For `may-pay` choices, the prompt renders Pay/Skip buttons that submit
 *  through `submitMayPay`. For kinds not yet migrated to client-buffered
 *  submit (`mulligan-bottom` until slice #84 lands), the legacy per-click
 *  counter is shown without a Done button — commit is server-side at
 *  `selected.length === max`. */
export default function PendingChoicePrompt({
    choice,
    playerId,
    gameId,
}: {
    choice: PendingChoice;
    playerId: string;
    gameId: Id<"games">;
}) {
    const { allPlayers } = useGameContext();
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition();
    const submitMayPay = useMutation(api.game.submitMayPay);
    const submitLandEntryChoice = useMutation(api.game.submitLandEntryChoice);
    const submitDrawReplacementPay = useMutation(
        api.game.submitDrawReplacementPay
    );
    const submitMadnessDecline = useMutation(api.game.submitMadnessDecline);
    const submitReboundDecline = useMutation(api.game.submitReboundDecline);
    const announceCast = useMutation(api.game.announceCast);
    const submitNameCard = useMutation(api.game.submitNameCard);
    const submitResolutionChoice = useMutation(api.game.submitResolutionChoice);
    const [isBusy, setIsBusy] = useState(false);
    const bufferCtx = usePendingChoiceBuffer();
    // Primary (affirmative) action — shared with the Space hotkey so the button
    // and the key commit through one code path. Non-null when this viewer is
    // the chooser; the Skip/No path below stays local (it's the secondary).
    const primary = usePendingChoicePrimaryAction();
    const isChooser = choice.playerId === playerId;
    const min = pendingChoiceMin(choice.count);
    const max = pendingChoiceMax(choice.count);
    const isMayPay = choice.kind === "may-pay";
    // CR 614.12 / ADR 0051 — shock-land pay-choice: same yes-no Pay/Skip UI as
    // may-pay, only the submit mutation differs (dispatched below).
    const isLandEntry = choice.kind === "land-entry-tapped";
    // CR 614 / issue #735 — Zur's Weirding pay-choice: same yes-no Pay/Skip UI
    // as may-pay, only the submit mutation differs (dispatched below).
    const isDrawReplacement = choice.kind === "draw-replacement";
    const isYesNoPay = isMayPay || isLandEntry || isDrawReplacement;
    const isOptionPick = choice.kind === "option-pick";
    // CR 702.35d — reflexive Madness cast-choice: Cast (fires the ordinary
    // announceCast on the exiled card, which consumes this choice) or Decline
    // (submitMadnessDecline → graveyard). Its own two-button branch — the Cast
    // affordance is a cast, not a choice submit.
    const isMadnessCast = choice.kind === "madness-cast";
    const madnessCostSymbols =
        isMadnessCast && choice.cost
            ? formatOracleText(mayPayCostLabel(choice.cost))
            : null;
    // CR 702.88a — reflexive Rebound cast-choice: same two-button Cast/Decline
    // UI as Madness above (Cast fires the ordinary announceCast, which
    // consumes this choice; Decline routes through its own mutation — the
    // card remains exiled rather than binning to the graveyard). Rebound's
    // recast is always free, so there is no cost to display.
    const isReboundCast = choice.kind === "rebound-cast";
    const isReflexiveCastChoice = isMadnessCast || isReboundCast;
    // ADR 0053 pile division (`divide-piles` / `pick-pile`) is NOT handled here:
    // the chooser's surface is owned by `PileDivisionPicker` (this component
    // returns null for the chooser of those kinds, above); the non-chooser gets
    // the generic "Waiting for X" line at the bottom.
    const isNameCard = choice.kind === "name-card";

    // All zone-pick kinds use the client-side buffer (ADR 0007).
    const selected = bufferCtx.buffer.length;
    const remaining = Math.max(0, max - selected);

    const chooserName =
        allPlayers.find((p) => p.id === choice.playerId)?.name ?? "opponent";
    const sourceLabel = pendingChoiceLabel(choice.kind);

    // "Pay" enables once the chooser's mana pool covers the cost (CR 117.6);
    // the chooser may activate mana abilities while the may-pay window is open
    // (CR 117.3a) and the button enables as soon as the pool can cover it. The
    // gating itself lives in usePendingChoicePrimaryAction (shared with Space).
    const canConfirm = primary?.canConfirm ?? false;
    const costSymbols =
        isYesNoPay && choice.cost
            ? formatOracleText(mayPayCostLabel(choice.cost))
            : null;

    // CR 701.16b — a may-pay sacrifice leg with a real victim choice sets
    // `zone: "battlefield"`; the chooser clicks the permanent(s) to sacrifice
    // (routed into the shared buffer) before Pay enables. Show the pick progress.
    const sacrificePickCount =
        isMayPay && choice.zone === "battlefield"
            ? mayPayRequiredSacrifices(choice.cost)
            : 0;
    const needsSacrificePick = sacrificePickCount > 0;
    // CR 118 threshold mode (Phyrexian Dreadnought): no fixed count — the pick
    // is complete once the selected permanents' summed power reaches the
    // threshold. Show power progress instead of a count.
    const sacrificeThreshold =
        isMayPay && choice.zone === "battlefield"
            ? mayPaySacrificeThreshold(choice.cost)
            : undefined;
    const chooser = allPlayers.find((p) => p.id === choice.playerId);
    const selectedSacrificePower =
        sacrificeThreshold !== undefined
            ? mayPaySacrificeSelectionPower(
                  bufferCtx.buffer,
                  chooser?.battlefield ?? []
              )
            : 0;

    // CR 701.9 / 118.3 (issue #899) — a may-pay discard leg with a real card
    // choice sets `zone: "hand"`; the chooser clicks the card(s) in hand to
    // discard (routed into the shared buffer) before Pay enables. Show the
    // pick progress, mirroring the sacrifice pick above.
    const discardPickCount =
        isMayPay && choice.zone === "hand"
            ? mayPayRequiredDiscards(choice.cost)
            : 0;
    const needsDiscardPick = discardPickCount > 0;

    // Done/Skip label (ADR 0007): switches to "Skip" only when min === 0 and
    // the buffer is empty.
    const submitLabel = min === 0 && selected === 0 ? "Skip" : "Done";

    // Random-reveal (CR 705 / ADR 0023): an engine-drawn outcome with NO
    // decision — route to the center-screen reveal overlay (coin animation,
    // auto-acknowledge on landing) instead of the buttons. Both clients render
    // it; only the chooser's client acks.
    if (choice.kind === "random-reveal") {
        return (
            <RandomRevealOverlay
                choice={choice}
                playerId={playerId}
                gameId={gameId}
            />
        );
    }

    // divide-piles / pick-pile (Fact or Fiction, ADR 0053) own the dedicated
    // `PileDivisionPicker` (mounted by the board) for the CHOOSER — a 3-zone
    // drag stage for the divider, a face-up two-pile pick for the chooser.
    // Suppress this generic banner for the chooser so it doesn't double up; the
    // non-chooser still gets the "Waiting for X" line below.
    if (
        isChooser &&
        (choice.kind === "divide-piles" || choice.kind === "pick-pile")
    )
        return null;

    // order-top (scry / surveil / ponder), look-distribute (Impulse / Stock Up)
    // and reorder-library ("put them back in any order" — Portent, Natural
    // Selection, Drafna's Restoration) all own the same full-screen drag picker
    // (`LibraryOrderPicker`, mounted by `PlayerLibrary`), which carries the
    // prompt, the ordering and the submit. Suppress this generic banner so it
    // doesn't double up with a stale "N / max selected" counter whose buffered
    // Done would submit an empty (illegal) selection.
    if (
        choice.kind === "order-top" ||
        choice.kind === "look-distribute" ||
        choice.kind === "reorder-library"
    )
        return null;

    // trigger-order (CR 603.3b, ADR 0058) — the chooser owns the same full-screen
    // drag strip (order-only mode) to order their simultaneous triggers on the
    // stack. The non-chooser falls through to the generic "Waiting for X" banner.
    if (choice.kind === "trigger-order" && isChooser) {
        return <TriggerOrderPrompt choice={choice} gameId={gameId} />;
    }

    // Brainstorm's putBack pick (`choose-hand-card` + `putOnTop`) — the chooser
    // orders cards from their OWN hand onto the library top via the full-screen
    // `PutBackPicker` (mounted by the board). Suppress the generic banner + the
    // in-hand toggle so they don't double up with the ordered drag surface.
    if (choice.kind === "choose-hand-card" && choice.putOnTop) return null;

    // A hand-zone pick from ANOTHER player's hand (Thoughtseize / Duress /
    // Hymn to Tourach's `choose-hand-card`; Mind Warp / Leshrac's Sigil's
    // `discard-hand` — the caster picks which of the TARGET's cards get
    // discarded) owns its own modal picker (`HandCardPick`, mounted by the
    // board), which reuses the search-library surface + a reachable Done.
    // Suppress this generic banner so it doesn't double up with a
    // "0 / max selected" counter over cards the viewer can't reach here (the
    // opponent's hand is not clickable in-place). Gated on "chooser ≠ zone
    // owner", NOT `kind` (issue #1698 / #1719 review finding 1 — a `kind`-only
    // check missed `discard-hand`, leaving both the modal AND this banner
    // unreachable for Mind Warp/Leshrac's Sigil). `reveal-hand` is excluded —
    // its own dedicated suppression is below. Own-hand picks keep the banner
    // + in-hand toggle.
    if (
        choice.kind !== "reveal-hand" &&
        choice.zone === "hand" &&
        !!choice.zoneOwnerId &&
        choice.zoneOwnerId !== playerId
    ) {
        return null;
    }

    // A `reveal-hand` look (CR 401.4 / 701.18a — Gitaxian Probe / Glasses of
    // Urza) for the CHOOSER owns its own modal picker (`RevealHandView`, mounted
    // by the board), which shows the target's hand face-up as a CardsPile grid +
    // a Done ack. Suppress this generic "Reveal" banner so it doesn't double up
    // with the pile modal. The non-chooser falls through to the "Waiting for X"
    // line below.
    if (isChooser && choice.kind === "reveal-hand") return null;

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. `pointer-events-none`
                / `pointer-events-auto` now come from the hook itself (issue
                #1762 review) — every banner gets the gutter-tap fix for
                free instead of re-declaring it per file. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel
                    density="compact"
                    className="flex max-h-[90vh] flex-col items-center gap-2 overflow-y-auto px-5 py-3"
                >
                    {isChooser ? (
                        <>
                            <MinimizeChoiceButton className="absolute top-1.5 right-1.5" />
                            <div className="flex flex-col items-center text-center gap-1">
                                <p className="font-beleren text-sm tracking-wide text-parchment">
                                    {sourceLabel}
                                </p>
                                <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-border-accent/40 to-transparent" />
                                <p className="text-text-muted text-xs">
                                    {formatOracleText(choice.prompt)}
                                </p>
                            </div>
                            {choice.subjectCardId && (
                                // CR 303.4f — show WHICH card the choice is about
                                // (e.g. the reanimated Aura, held off every zone).
                                <div className="w-28 shrink-0">
                                    <CardImage
                                        card={{ id: choice.subjectCardId }}
                                        sizes="112px"
                                        includeThumb={false}
                                    />
                                </div>
                            )}
                            {isReflexiveCastChoice ? (
                                <div className="flex gap-2 mt-1">
                                    <Button
                                        type="button"
                                        variant="primary"
                                        size="sm"
                                        disabled={isBusy}
                                        onClick={async () => {
                                            if (
                                                isBusy ||
                                                !choice.cardInstanceId
                                            )
                                                return;
                                            setIsBusy(true);
                                            try {
                                                // CR 702.35d / 702.88a — accept:
                                                // cast the exiled card via the
                                                // ordinary cast path (consumes
                                                // this choice server-side, then
                                                // runs targets/mana — Rebound's
                                                // recast pays no mana).
                                                await announceCast({
                                                    gameId,
                                                    playerId,
                                                    cardInstanceId:
                                                        choice.cardInstanceId,
                                                });
                                            } finally {
                                                setIsBusy(false);
                                            }
                                        }}
                                    >
                                        <span>Cast</span>
                                        {madnessCostSymbols && (
                                            <span className="inline-flex items-center">
                                                {madnessCostSymbols}
                                            </span>
                                        )}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={isBusy}
                                        onClick={async () => {
                                            if (isBusy) return;
                                            setIsBusy(true);
                                            try {
                                                if (isReboundCast) {
                                                    // CR 702.88c — decline:
                                                    // the card remains exiled
                                                    // (no zone change).
                                                    await submitReboundDecline({
                                                        gameId,
                                                        playerId,
                                                    });
                                                } else {
                                                    // CR 702.35d — decline:
                                                    // send the card to the
                                                    // graveyard.
                                                    await submitMadnessDecline({
                                                        gameId,
                                                        playerId,
                                                    });
                                                }
                                            } finally {
                                                setIsBusy(false);
                                            }
                                        }}
                                    >
                                        Decline
                                    </Button>
                                </div>
                            ) : isOptionPick ? (
                                <PendingChoiceOptions
                                    options={choice.options ?? []}
                                    disabled={isBusy}
                                    onPick={async (id) => {
                                        if (isBusy) return;
                                        setIsBusy(true);
                                        try {
                                            // Single-select: submit the chosen
                                            // option id directly (one id), bypassing
                                            // the multi-pick buffer — no stale
                                            // closure on the buffer contents.
                                            await submitResolutionChoice({
                                                gameId,
                                                playerId,
                                                stackItemId: choice.stackItemId,
                                                step: choice.step,
                                                choiceId: choice.choiceId,
                                                cardInstanceIds: [id],
                                            });
                                        } finally {
                                            setIsBusy(false);
                                        }
                                    }}
                                />
                            ) : isNameCard ? (
                                <CardNameInput
                                    disabled={isBusy}
                                    onSubmit={async (cardName) => {
                                        if (isBusy) return;
                                        setIsBusy(true);
                                        try {
                                            await submitNameCard({
                                                gameId,
                                                playerId,
                                                cardName,
                                            });
                                        } finally {
                                            setIsBusy(false);
                                        }
                                    }}
                                />
                            ) : isYesNoPay ? (
                                <>
                                    {needsSacrificePick && (
                                        <p className="text-text-disabled text-xs">
                                            {selected} / {sacrificePickCount}{" "}
                                            selected — click a permanent to
                                            sacrifice
                                        </p>
                                    )}
                                    {sacrificeThreshold !== undefined && (
                                        <p className="text-text-disabled text-xs">
                                            {selectedSacrificePower} /{" "}
                                            {sacrificeThreshold} power selected
                                            — click creatures to sacrifice
                                        </p>
                                    )}
                                    {needsDiscardPick && (
                                        <p className="text-text-disabled text-xs">
                                            {selected} / {discardPickCount}{" "}
                                            selected — click a card in hand to
                                            discard
                                        </p>
                                    )}
                                    <div className="flex gap-2 mt-1">
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            disabled={!canConfirm}
                                            onClick={() => primary?.confirm()}
                                        >
                                            {choice.cost ? (
                                                <>
                                                    <span>Pay</span>
                                                    <span className="inline-flex items-center">
                                                        {costSymbols}
                                                    </span>
                                                </>
                                            ) : (
                                                "Yes"
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={isBusy}
                                            onClick={async () => {
                                                if (isBusy) return;
                                                setIsBusy(true);
                                                try {
                                                    // CR 614.12 / ADR 0051 / #735 —
                                                    // decline routes to the kind's own
                                                    // mutation.
                                                    if (isLandEntry) {
                                                        await submitLandEntryChoice(
                                                            {
                                                                gameId,
                                                                playerId,
                                                                accept: false,
                                                            }
                                                        );
                                                    } else if (
                                                        isDrawReplacement
                                                    ) {
                                                        await submitDrawReplacementPay(
                                                            {
                                                                gameId,
                                                                playerId,
                                                                accept: false,
                                                            }
                                                        );
                                                    } else {
                                                        await submitMayPay({
                                                            gameId,
                                                            playerId,
                                                            accept: false,
                                                        });
                                                    }
                                                } finally {
                                                    setIsBusy(false);
                                                }
                                            }}
                                        >
                                            {choice.cost ? "Skip" : "No"}
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-text-disabled text-xs">
                                        {selected} / {max} selected
                                        {min < max && remaining > 0
                                            ? ` — click ${remaining === 1 ? "one more" : `up to ${remaining} more`}`
                                            : ""}
                                    </p>
                                    <Button
                                        type="button"
                                        variant="primary"
                                        size="sm"
                                        disabled={!canConfirm}
                                        className="mt-1"
                                        onClick={() => primary?.confirm()}
                                    >
                                        {submitLabel}
                                    </Button>
                                </>
                            )}
                        </>
                    ) : (
                        <p className="text-text-muted text-xs text-center">
                            Waiting for{" "}
                            <span className="font-beleren text-parchment">
                                {chooserName}
                            </span>{" "}
                            — {choice.prompt}
                        </p>
                    )}
                </Panel>
            </div>
        </div>
    );
}
