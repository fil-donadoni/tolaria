// Cast picker specimens — the census's live mounts for the
// `src/components/cards/**` overlays a cast walks through (issue #4420, slice
// of the `check:ui` coverage census debt issue #4402).
//
// WHY THIS SECTION EXISTS. The cost, mode and preview pickers open at one
// instant of one cast — an alternative cost, a Phyrexian split, a Kicker —
// which the lane's board cannot set up on demand, so they were measured at no
// viewport. Each takes plain data props, so this section hands them fixtures,
// the way § 16 does for the board's own dialogs.
//
// THE ANCHORED ONES OPEN WHERE THE OPENER WAS PRESSED. An `AnchoredPicker`
// sits next to the card that was cast and clamps itself to the viewport; its
// failure shape is a body that outgrows a phone, which is only measured if
// the picker opens from a real point on the page rather than a centred one.
//
// `SelectableCard` is the one inline specimen: it is a card with its cast
// affordances, not a layer, so its opener mounts it in the section itself.
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    usePendingChoiceBufferState,
} from "~/hooks/usePendingChoiceBuffer";
import AdditionalCostPicker from "~/components/cards/additional-cost-picker";
import AltCostPicker from "~/components/cards/alt-cost-picker";
import CardPreviewYieldMenu from "~/components/cards/card-preview-yield-menu";
import CastCostDialog from "~/components/cards/cast-cost-dialog";
import ModePicker from "~/components/cards/mode-picker";
import MultiModePicker from "~/components/cards/multi-mode-picker";
import PhyrexianPicker from "~/components/cards/phyrexian-picker";
import SelectableCard from "~/components/cards/selectable-card";
import { Section } from "./lib";
import OverlaySpecimens, { type OverlaySpecimen } from "./overlay-specimens";
import { GAME_CONTEXT, GAME_ID, ME, PRINT, card } from "./specimen-fixtures";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const CRYPTIC_MODES = [
    {
        id: "counter",
        label: "Counter",
        oracleText: "Counter target spell.",
    },
    {
        id: "bounce",
        label: "Bounce",
        oracleText: "Return target permanent to its owner's hand.",
    },
    {
        id: "tap",
        label: "Tap",
        oracleText: "Tap all creatures your opponents control.",
    },
    { id: "draw", label: "Draw", oracleText: "Draw a card." },
];

/* ── The specimen table ───────────────────────────────────────────────── */

const SPECIMENS: OverlaySpecimen[] = [
    {
        slug: "additional-cost",
        label: "Additional cost",
        file: "cards/additional-cost-picker.tsx",
        render: (close, anchor) => (
            <AdditionalCostPicker
                legs={[
                    {
                        id: "discard",
                        label: "Discard a card",
                        discard: { count: 1 },
                    },
                    { id: "life", label: "Pay 3 life", payLife: 3 },
                ]}
                cardName="Bitter Triumph"
                position={anchor}
                onSelect={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "alt-cost",
        label: "Alternative cost",
        file: "cards/alt-cost-picker.tsx",
        render: (close, anchor) => (
            <AltCostPicker
                altCosts={[
                    {
                        id: "gush",
                        description:
                            "Return two Islands you control to their owner's hand",
                    },
                ]}
                printedCostAvailable
                cardName="Gush"
                position={anchor}
                onSelect={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "card-preview-yield",
        label: "Card preview with a Yield",
        file: "cards/card-preview-yield-menu.tsx",
        render: (close, anchor) => (
            <CardPreviewYieldMenu
                position={anchor}
                yieldItems={[
                    {
                        key: "yield-off",
                        label: "Turn off auto-yield for Lightning Bolt",
                        onSelect: close,
                    },
                ]}
                onPreview={close}
                onClose={close}
            />
        ),
    },
    {
        slug: "cast-cost",
        label: "Cast costs",
        file: "cards/cast-cost-dialog.tsx",
        // Every field the dialog can render at once — X, a Kicker, a
        // Multikicker, buyback and the flash surcharge notice — so the row
        // measures the tallest body it can open with, not the shortest.
        render: (close) => (
            <CastCostDialog
                open
                cardName="Cast cost specimen"
                subtitle="Every cast-cost field at once"
                askX
                kickers={[
                    {
                        id: "kicker",
                        description: "Kicker {1}{G}",
                        multi: false,
                    },
                    {
                        id: "multikicker",
                        description: "Multikicker {1}{G}",
                        multi: true,
                    },
                ]}
                buyback
                flashSurcharge="{2}"
                onConfirm={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "mode",
        label: "Mode picker",
        file: "cards/mode-picker.tsx",
        render: (close, anchor) => (
            <ModePicker
                modes={[
                    {
                        id: "discard",
                        label: "Discard",
                        oracleText: "Target player discards a card.",
                    },
                    {
                        id: "pump",
                        label: "+2/-1",
                        oracleText:
                            "Target creature gets +2/-1 until end of turn.",
                    },
                    {
                        id: "swampwalk",
                        label: "Swampwalk",
                        oracleText:
                            "Target creature gains swampwalk until end of turn.",
                    },
                ]}
                cardName="Funeral Charm"
                variant="portal"
                position={anchor}
                onSelect={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "multi-mode",
        label: "Multi-mode picker",
        file: "cards/multi-mode-picker.tsx",
        render: (close) => (
            <MultiModePicker
                modes={CRYPTIC_MODES}
                cardName="Cryptic Command"
                constraint={{
                    min: 2,
                    max: 2,
                    repeats: false,
                    legalModeIds: CRYPTIC_MODES.map((m) => m.id),
                    requiredCount: 2,
                    shortfall: false,
                }}
                onConfirm={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "phyrexian",
        label: "Phyrexian mana",
        file: "cards/phyrexian-picker.tsx",
        render: (close, anchor) => (
            <PhyrexianPicker
                choices={[
                    { lifePips: 0, label: "{B}{B}" },
                    { lifePips: 1, label: "{B} + 2 life" },
                    { lifePips: 2, label: "4 life" },
                ]}
                cardName="Dismember"
                position={anchor}
                onSelect={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "selectable-card",
        label: "Selectable card",
        file: "cards/selectable-card.tsx",
        // Inline, not a portal: the seam wraps the card so the lane can wait
        // on it and scroll it on screen before the probe measures.
        render: () => (
            <div data-selectable-card-specimen className="mt-4 w-40 max-w-full">
                <SelectableCard
                    cardInstance={card("s1", PRINT.bolt, "hand")}
                    allowedActions={["cast", "discard"]}
                />
            </div>
        ),
    },
];

export function CastPickersSection() {
    // The REAL buffer state, not a stub: `SelectableCard` reads it through
    // `useHandCardCommit`, and with no active choice it holds nothing and
    // fires nothing.
    const buffer = usePendingChoiceBufferState({
        gameId: GAME_ID,
        playerId: ME,
        activeChoice: undefined,
    });

    return (
        <Section
            id="cast-pickers"
            index="18"
            title="Cast pickers"
            blurb={
                <>
                    The cost, mode and preview pickers a cast walks through (
                    <code>src/components/cards/**</code>), mounted from fixture
                    props so each is measured at all five viewports with no game
                    running (issue #4420). One at a time, like § 16; the
                    anchored pickers open where their opener was pressed.{" "}
                    <code>check:ui</code> walks one <code>pick-*</code> surface
                    per opener.
                </>
            }
        >
            <OverlaySpecimens
                specimens={SPECIMENS}
                openerAttribute="data-cast-picker-specimen"
                wrap={(mounted) => (
                    <GameContext.Provider value={GAME_CONTEXT}>
                        <PendingChoiceBufferContext.Provider value={buffer}>
                            {mounted}
                        </PendingChoiceBufferContext.Provider>
                    </GameContext.Provider>
                )}
            />
        </Section>
    );
}
