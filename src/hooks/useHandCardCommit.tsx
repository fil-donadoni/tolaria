import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import {
    affordableAltCostsForCard,
    phyrexianSplitChoices,
    type PhyrexianSplitChoice,
} from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";
import ModePicker from "~/components/cards/mode-picker";
import AltCostPicker from "~/components/cards/alt-cost-picker";
import PhyrexianPicker from "~/components/cards/phyrexian-picker";
import CastCostDialog from "~/components/cards/cast-cost-dialog";
import type { AlternativeCost } from "@convex/cards/types";

type ModePickerState = {
    chosenX: number | undefined;
    kickerCount: number | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
};

type AltCostPickerState = {
    chosenX: number | undefined;
    kickerCount: number | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    /** The alternative costs the caster can currently afford (CR 118.9) — the
     *  picker offers exactly these plus "Pay mana cost". Filtered at open time
     *  so a condition-failing / unaffordable alt is never shown. */
    altCosts: AlternativeCost[];
};

/** CR 107.4f — open state for the Phyrexian mana-vs-life split picker. Present
 *  while the caster picks how many `{C/P}` pips to pay with life; the chosen
 *  value rides `announceCast`'s `phyrexianLifePips`. */
type PhyrexianPickerState = {
    chosenX: number | undefined;
    kickerCount: number | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    choices: PhyrexianSplitChoice[];
};

/** Cost-choice dialog state (CR 601.2b {X} + CR 702.33 Kicker). Opened before
 *  the mode / alt-cost pickers when the card needs a numeric X and/or a kicker
 *  decision; `position` is captured at click time so the downstream pickers can
 *  still anchor to the card after the dialog closes. */
type CostDialogState = {
    keepPriority: boolean | undefined;
    askX: boolean;
    kicker: { multi: boolean } | undefined;
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
 * progress. */
export function useHandCardCommit(cardInstance: CardInstance) {
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
    const [costDialogState, setCostDialogState] =
        useState<CostDialogState | null>(null);

    const onPlayClick = () => {
        // Route a server-side rejection to the shared error toast instead of
        // leaving it as an uncaught promise rejection in the console.
        Promise.resolve(
            playCard({
                gameId,
                playerId,
                cardInstanceId: cardInstance.id,
                skipValidation: debugAllActions || undefined,
            })
        ).catch(reportError);
    };

    function commitAnnounceCast(args: {
        chosenX: number | undefined;
        keepPriority: boolean | undefined;
        chosenModeId: string | undefined;
        alternativeCostId?: string | undefined;
        kickerCount?: number | undefined;
        /** CR 107.4f — how many `{C/P}` pips the caster chose to pay with life. */
        phyrexianLifePips?: number | undefined;
    }) {
        Promise.resolve(
            announceCast({
                gameId,
                playerId,
                cardInstanceId: cardInstance.id,
                keepPriority: args.keepPriority,
                chosenX: args.chosenX,
                chosenModeId: args.chosenModeId,
                alternativeCostId: args.alternativeCostId,
                kickerCount: args.kickerCount,
                phyrexianLifePips: args.phyrexianLifePips,
            })
        ).catch(reportError);
    }

    // Resume the cast pipeline once the cost choices (X / kicker) are known:
    // CR 700.2 modal mode picker, then CR 118.9 alternative-cost picker, then
    // the actual `announceCast`. Factored out of `onCastClick` so the same tail
    // runs whether the choices came from the `CastCostDialog` or (for a card
    // with neither X nor kicker) directly. `position` is captured at click time
    // so the mode / alt-cost pickers still anchor to the card.
    function proceedAfterCost(params: {
        chosenX: number | undefined;
        kickerCount: number | undefined;
        keepPriority: boolean | undefined;
        position: { x: number; y: number };
    }) {
        const { chosenX, kickerCount, keepPriority, position } = params;
        const def = getDefinition(cardInstance.card.id);
        // CR 700.2 — modal spell: pick a mode before announcement.
        if (def.modes && def.modes.length > 0) {
            setModePickerState({
                chosenX,
                kickerCount,
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
        // checks both — `affordableAltCostsForCard` (delegating to the server's
        // `affordableAlternativeCosts`) already folds `def.evoke` into its
        // result either way.
        if (
            (def.alternativeCosts && def.alternativeCosts.length > 0) ||
            def.evoke
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
                    kickerCount,
                    keepPriority,
                    position,
                    altCosts: affordableAlts,
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
                kickerCount,
                keepPriority,
                position,
                choices: phyrexianChoices,
            });
            return;
        }
        commitAnnounceCast({
            chosenX,
            keepPriority,
            chosenModeId: undefined,
            kickerCount,
        });
    }

    const onCastClick = (e: React.MouseEvent | React.PointerEvent) => {
        const keepPriority = e.ctrlKey || e.metaKey || undefined;
        const def = getDefinition(cardInstance.card.id);
        // CR 107.3 / 601.2b: X in the mana cost is chosen before announcement.
        // CR 702.33: Kicker is an optional additional cost decided at cast time.
        // Anchor on currentTarget (the handler-bound element) — more stable than
        // `e.target` which may be a nested child. Falls back to the pointer
        // coords if the rect is degenerate. Captured now so the downstream
        // mode / alt-cost pickers can still anchor after the cost dialog closes.
        const hasX = typeof def.manaCost?.X === "string";
        const anchor = e.currentTarget as HTMLElement | null;
        const rect = anchor?.getBoundingClientRect();
        const position =
            rect && rect.width > 0 && rect.height > 0
                ? { x: rect.right + 8, y: rect.top }
                : { x: e.clientX + 8, y: e.clientY + 8 };
        // A spell needing an X value and/or a kicker decision collects both in
        // one in-game dialog (replacing the old native prompt/confirm) before
        // the cast pipeline resumes.
        if (hasX || def.kicker) {
            setCostDialogState({
                keepPriority,
                askX: hasX,
                kicker: def.kicker
                    ? { multi: def.kicker.multi === true }
                    : undefined,
                position,
            });
            return;
        }
        proceedAfterCost({
            chosenX: undefined,
            kickerCount: undefined,
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
                    const { chosenX, kickerCount, keepPriority } =
                        modePickerState;
                    setModePickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: modeId,
                        kickerCount,
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
                    const { chosenX, kickerCount, keepPriority } =
                        altCostPickerState;
                    setAltCostPickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: undefined,
                        alternativeCostId: altCostId,
                        kickerCount,
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
                    const { chosenX, kickerCount, keepPriority } =
                        phyrexianPickerState;
                    setPhyrexianPickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: undefined,
                        kickerCount,
                        phyrexianLifePips: lifePips,
                    });
                }}
                onCancel={() => setPhyrexianPickerState(null)}
            />
        ) : null;

    const costDialogOverlay = costDialogState ? (
        <CastCostDialog
            open
            cardName={def.name}
            askX={costDialogState.askX}
            kicker={costDialogState.kicker}
            onConfirm={({ chosenX, kickerCount }) => {
                const { keepPriority, position } = costDialogState;
                setCostDialogState(null);
                proceedAfterCost({
                    chosenX,
                    kickerCount,
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
        costDialogOverlay,
    };
}
