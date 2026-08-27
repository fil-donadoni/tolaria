import type { Color, ModeOption } from "@convex/cards/types";
import GameDialog from "~/components/ui/game-dialog";
import AnchoredPicker, {
    AnchoredPickerRow,
} from "@/components/ui/anchored-picker";
import ManaSymbol from "~/components/cards/mana-symbol";
import { formatOracleText } from "~/lib/oracle-text";

/** What the picker renders: the shared {@link ModeOption} display surface, plus
 *  the OPTIONAL colour pip. `color` lives on `SpellMode`, not on the shared
 *  base — a colour choice (Prismatic Ward, Sleight of Mind) is a modal-SPELL
 *  concern, and `AbilityMode` (CR 602.2b, issue #1341) has no such half. The
 *  picker is shared by both, so it reads the field structurally rather than
 *  forcing it onto the base type. */
type PickerMode = ModeOption & { color?: Color };

type ModePickerProps = {
    modes: ReadonlyArray<PickerMode>;
    cardName: string;
    variant?: "dialog" | "portal";
    position?: { x: number; y: number };
    onSelect: (modeId: string) => void;
    onCancel: () => void;
};

function ModeRow({
    mode,
    onSelect,
}: {
    mode: PickerMode;
    onSelect: (id: string) => void;
}) {
    return (
        <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            // `border-border-strong` on hover, NOT the decorative
            // `--hairline` pair (review finding, #2731 round 1 — the same
            // fix `AnchoredPickerRow` got in `0671b4e8`, one function below
            // in the shared shell): this row IS a `<button>`, so its own
            // edge is a control boundary under WCAG 1.4.11, not decoration.
            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-strong transition-colors cursor-pointer"
        >
            {/* `.text-display` (review finding, #2731 round 1): the dialog
                variant now matches the portal variant's face — both render
                the SAME `ModeOption` label, so a leftover retired display
                utility here rendered the two variants of the same picker in
                two different fonts (`design-tokens.test.ts`'s residual-site
                ratchet). */}
            <span className="text-display flex items-center gap-1.5 text-sm tracking-wide text-text">
                {mode.color && (
                    <ManaSymbol symbol={mode.color} className="size-4" />
                )}
                {formatOracleText(mode.label)}
            </span>
            <span className="text-xs text-text-disabled">
                {formatOracleText(mode.oracleText)}
            </span>
        </button>
    );
}

function ModePickerPortal({
    modes,
    cardName,
    position,
    onSelect,
    onCancel,
}: ModePickerProps & { position: { x: number; y: number } }) {
    return (
        <AnchoredPicker
            position={position}
            rowCount={modes.length}
            onCancel={onCancel}
            title={cardName}
        >
            {modes.map((mode) => (
                <AnchoredPickerRow
                    key={mode.id}
                    onSelect={() => onSelect(mode.id)}
                >
                    <span className="text-display flex items-center gap-1.5 text-sm text-text">
                        {mode.color && (
                            <ManaSymbol
                                symbol={mode.color}
                                className="size-4"
                            />
                        )}
                        {formatOracleText(mode.label)}
                    </span>
                    <span className="text-xs text-text-disabled">
                        {formatOracleText(mode.oracleText)}
                    </span>
                </AnchoredPickerRow>
            ))}
        </AnchoredPicker>
    );
}

export default function ModePicker({
    modes,
    cardName,
    variant = "dialog",
    position,
    onSelect,
    onCancel,
}: ModePickerProps) {
    if (variant === "portal" && position) {
        return (
            <ModePickerPortal
                modes={modes}
                cardName={cardName}
                position={position}
                onSelect={onSelect}
                onCancel={onCancel}
            />
        );
    }

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title={cardName}
            dismissable
        >
            <div className="flex flex-col gap-1.5 mt-2">
                {modes.map((mode) => (
                    <ModeRow key={mode.id} mode={mode} onSelect={onSelect} />
                ))}
            </div>
        </GameDialog>
    );
}
