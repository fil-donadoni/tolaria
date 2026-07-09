import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { getDefinition } from "@convex/cards";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { affordableAltCostsForCard } from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";
import ModePicker from "~/components/cards/mode-picker";
import AltCostPicker from "~/components/cards/alt-cost-picker";
import type { AlternativeCost } from "@convex/cards/types";

type ModePickerState = {
    chosenX: number | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
};

type AltCostPickerState = {
    chosenX: number | undefined;
    keepPriority: boolean | undefined;
    position: { x: number; y: number };
    /** The alternative costs the caster can currently afford (CR 118.9) — the
     *  picker offers exactly these plus "Pay mana cost". Filtered at open time
     *  so a condition-failing / unaffordable alt is never shown. */
    altCosts: AlternativeCost[];
};

/** The shared hand-card commit pipeline (PRD #249, slice #254).
 *
 * Both clicking a hand card (classic board / `selectable-card`) and dragging it
 * out of the hand past the commit threshold (spatial board / drag-to-cast)
 * dispatch the SAME GRE-boundary mutation — `playCard` for lands, `announceCast`
 * for spells — through this one hook. Extracting it guarantees drag and click
 * are provably identical: the X-cost prompt (CR 601.2b), the modal mode picker
 * (CR 700.2), the `ctrl/meta` keep-priority modifier, and the debug
 * skip-validation flag all run once here and behave the same regardless of which
 * gesture invoked them. Downstream flow (payment banner, target selection) is
 * untouched because the mutation args are identical.
 *
 * Returns the two commit handlers plus the mode-picker overlay node, which the
 * caller renders so the picker anchors correctly to its card. `modePickerOverlay`
 * is `null` until a modal spell's cast is in progress. */
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
            })
        ).catch(reportError);
    }

    const onCastClick = (e: React.MouseEvent | React.PointerEvent) => {
        const keepPriority = e.ctrlKey || e.metaKey || undefined;
        // CR 107.3 / 601.2b: if the spell has X in its mana cost, the caster
        // chooses X before announcement. Stay tiny: a native prompt is enough
        // for the study-engine MVP.
        const def = getDefinition(cardInstance.card.id);
        const hasX = typeof def.manaCost?.X === "string";
        let chosenX: number | undefined;
        if (hasX) {
            const raw = window.prompt(`Choose X for ${def.name}`, "0");
            if (raw === null) return;
            const parsed = Number.parseInt(raw, 10);
            if (!Number.isFinite(parsed) || parsed < 0) return;
            chosenX = parsed;
        }
        // CR 702.33 — Kicker: an optional additional cost the caster may choose
        // to pay as the spell is cast. A single kicker is a yes/no confirm; a
        // Multikicker (CR 702.33e) prompts for how many times to pay. Stay tiny:
        // native prompts, matching the X-cost MVP above.
        let kickerCount: number | undefined;
        if (def.kicker) {
            if (def.kicker.multi) {
                const raw = window.prompt(
                    `How many times to pay the kicker for ${def.name}? (0 = don't kick)`,
                    "0"
                );
                if (raw === null) return;
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isFinite(parsed) || parsed < 0) return;
                kickerCount = parsed;
            } else {
                kickerCount = window.confirm(
                    `Pay the kicker cost for ${def.name}?`
                )
                    ? 1
                    : 0;
            }
        }
        // CR 700.2 — modal spell: pick a mode before announcement.
        if (def.modes && def.modes.length > 0) {
            // Anchor on currentTarget (the handler-bound element) — more
            // stable than `e.target` which may be a nested child. Falls
            // back to the pointer coords if the rect is degenerate.
            const anchor = e.currentTarget as HTMLElement | null;
            const rect = anchor?.getBoundingClientRect();
            const position =
                rect && rect.width > 0 && rect.height > 0
                    ? { x: rect.right + 8, y: rect.top }
                    : { x: e.clientX + 8, y: e.clientY + 8 };
            setModePickerState({ chosenX, keepPriority, position });
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
        // cast for its normal mana cost.
        if (def.alternativeCosts && def.alternativeCosts.length > 0) {
            const affordableAlts = affordableAltCostsForCard(
                cardInstance,
                playerId,
                allPlayers,
                activePlayerId
            );
            if (affordableAlts.length > 0) {
                const anchor = e.currentTarget as HTMLElement | null;
                const rect = anchor?.getBoundingClientRect();
                const position =
                    rect && rect.width > 0 && rect.height > 0
                        ? { x: rect.right + 8, y: rect.top }
                        : { x: e.clientX + 8, y: e.clientY + 8 };
                setAltCostPickerState({
                    chosenX,
                    keepPriority,
                    position,
                    altCosts: affordableAlts,
                });
                return;
            }
        }
        commitAnnounceCast({
            chosenX,
            keepPriority,
            chosenModeId: undefined,
            kickerCount,
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
                    const { chosenX, keepPriority } = modePickerState;
                    setModePickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: modeId,
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
                    const { chosenX, keepPriority } = altCostPickerState;
                    setAltCostPickerState(null);
                    commitAnnounceCast({
                        chosenX,
                        keepPriority,
                        chosenModeId: undefined,
                        alternativeCostId: altCostId,
                    });
                }}
                onCancel={() => setAltCostPickerState(null)}
            />
        ) : null;

    return {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
    };
}
