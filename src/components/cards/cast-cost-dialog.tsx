import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import NumberStepper from "~/components/ui/number-stepper";
import { Button } from "@/components/ui/button";

type CastCostDialogProps = {
    open: boolean;
    /** The card being cast / ability being activated — the dialog title. */
    cardName: string;
    /** Optional secondary line (e.g. the ability's oracle text). */
    subtitle?: string;
    /** CR 601.2b — render a numeric X stepper (integer ≥ 0) when the spell /
     *  ability has X in its mana cost. */
    askX: boolean;
    /** CR 702.33 — the optional Kicker additional cost, when the card has one.
     *  `multi: false` → a single yes/no "pay the kicker" toggle; `multi: true`
     *  (Multikicker, CR 702.33e) → a numeric "times to pay kicker" stepper. */
    kicker?: { multi: boolean };
    /** CR 702.27 — true when the card has an optional Buyback cost: render a
     *  single yes/no "pay the buyback cost" toggle, mirroring the single
     *  (non-multi) Kicker checkbox — Buyback has no repeatable variant. */
    buyback?: boolean;
    onConfirm: (v: {
        chosenX?: number;
        kickerCount?: number;
        buyback?: boolean;
    }) => void;
    onCancel: () => void;
};

/** Non-negative integer parse: returns the value or `null` when the raw text
 *  isn't a clean base-10 non-negative integer (empty, `-1`, `1.5`, `abc`). */
function parseNonNegInt(raw: string): number | null {
    if (!/^\d+$/.test(raw.trim())) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** In-game dialog collecting the caster's cost choices before a spell / ability
 *  is announced — the {X} value (CR 601.2b) and/or the optional Kicker cost
 *  (CR 702.33) — replacing the old native `window.prompt` / `window.confirm`.
 *  Built on the shared {@link GameDialog} (Zelda-TotK panel) so it matches every
 *  other modal; ESC / overlay / Cancel dismiss without casting, Enter submits. */
export default function CastCostDialog({
    open,
    cardName,
    subtitle,
    askX,
    kicker,
    buyback,
    onConfirm,
    onCancel,
}: CastCostDialogProps) {
    const [xRaw, setXRaw] = useState("");
    const [kickerCountRaw, setKickerCountRaw] = useState("0");
    const [kickerPay, setKickerPay] = useState(false);
    const [buybackPay, setBuybackPay] = useState(false);

    // Reset the form each time the dialog is (re)opened so a previous cast's
    // entries never leak into the next one.
    const [prevOpen, setPrevOpen] = useState(open);
    if (open !== prevOpen) {
        setPrevOpen(open);
        if (open) {
            setXRaw("0");
            setKickerCountRaw("0");
            setKickerPay(false);
            setBuybackPay(false);
        }
    }

    const xValue = askX ? parseNonNegInt(xRaw) : 0;
    const kickerValue =
        !kicker || !kicker.multi ? 0 : parseNonNegInt(kickerCountRaw);
    const valid = xValue !== null && kickerValue !== null;

    const submit = () => {
        if (!valid) return;
        onConfirm({
            chosenX: askX ? (xValue as number) : undefined,
            kickerCount: kicker
                ? kicker.multi
                    ? (kickerValue as number)
                    : kickerPay
                      ? 1
                      : 0
                : undefined,
            buyback: buyback ? buybackPay : undefined,
        });
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel();
            }}
            title={cardName}
            subtitle={subtitle}
        >
            {/* Buttons live INSIDE the form so a submit button drives both a
                click and Enter-to-submit natively (implicit form submission),
                and the disabled state blocks both paths. */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}
                className="flex flex-col gap-4"
            >
                {askX && (
                    <div className="flex flex-col gap-1.5">
                        <label
                            htmlFor="cast-cost-x"
                            className="text-sm font-medium text-text"
                        >
                            Choose X
                        </label>
                        <NumberStepper
                            id="cast-cost-x"
                            aria-label="Choose X"
                            value={xRaw}
                            onChange={setXRaw}
                            autoFocus
                        />
                    </div>
                )}

                {kicker && kicker.multi && (
                    <div className="flex flex-col gap-1.5">
                        <label
                            htmlFor="cast-cost-kicker-count"
                            className="text-sm font-medium text-text"
                        >
                            Times to pay kicker
                        </label>
                        <NumberStepper
                            id="cast-cost-kicker-count"
                            aria-label="Times to pay kicker"
                            value={kickerCountRaw}
                            onChange={setKickerCountRaw}
                            autoFocus={!askX}
                        />
                    </div>
                )}

                {kicker && !kicker.multi && (
                    <label className="flex items-center gap-2.5">
                        <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={kickerPay}
                            onChange={(e) => setKickerPay(e.target.checked)}
                        />
                        <span className="text-sm font-medium text-text">
                            Pay kicker cost
                        </span>
                    </label>
                )}

                {buyback && (
                    <label className="flex items-center gap-2.5">
                        <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={buybackPay}
                            onChange={(e) => setBuybackPay(e.target.checked)}
                        />
                        <span className="text-sm font-medium text-text">
                            Pay buyback cost
                        </span>
                    </label>
                )}

                <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={!valid}>
                        Cast
                    </Button>
                </div>
            </form>
        </GameDialog>
    );
}
