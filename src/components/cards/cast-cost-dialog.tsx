import { useState } from "react";
import GameDialog from "~/components/ui/game-dialog";
import NumberStepper from "~/components/ui/number-stepper";
import CastCostKickerField from "~/components/cards/cast-cost-kicker-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";

type CastCostDialogProps = {
    open: boolean;
    /** The card being cast / ability being activated — the dialog title. */
    cardName: string;
    /** Optional secondary line (e.g. the ability's oracle text). */
    subtitle?: string;
    /** CR 601.2b — render a numeric X stepper (integer ≥ 0) when the spell /
     *  ability has X in its mana cost. */
    askX: boolean;
    /** CR 702.34a / 118.5 / 107.3 — upper bound on {X} for a flashback cast
     *  whose additional cost demands exactly X cards from the graveyard (Flash
     *  of Insight: "Exile X blue cards"). Caps the stepper AND blocks submit
     *  above it, so the caster can't announce an X the exile cost can't cover.
     *  Undefined = X uncapped (an ordinary {X} spell). */
    maxX?: number;
    /** CR 702.33 — the card's optional Kicker additional costs, one entry per
     *  independently payable Kicker (ADR 0079). Each renders its OWN control with
     *  its `description` legible before commit: a yes/no toggle, or — for a
     *  Multikicker (CR 702.33e) — a numeric "times to pay" stepper. Omitted /
     *  empty for a card with no Kicker. */
    kickers?: { id: string; description: string; multi: boolean }[];
    /** CR 702.27 — true when the card has an optional Buyback cost: render a
     *  single yes/no "pay the buyback cost" toggle, mirroring the single
     *  (non-multi) Kicker checkbox — Buyback has no repeatable variant. */
    buyback?: boolean;
    /** CR 601.3c — the conditional-flash SURCHARGE this cast owes, already
     *  rendered ("{2}"). Present only when the server says the surcharge is
     *  required for casting right now, so this is a NOTICE, not a toggle: the
     *  rule prices the flash permission, it does not make the payment
     *  optional, and inside the caster's own sorcery window the field is absent
     *  entirely rather than offering a pointless {2}. Confirming the dialog IS
     *  the acknowledgement; Cancel declines the cast. */
    flashSurcharge?: string;
    onConfirm: (v: {
        chosenX?: number;
        /** CR 702.33 — times to pay EACH Kicker, keyed by `KickerCost.id`. Only
         *  the Kickers the caster chose to pay appear; `undefined` = not kicked,
         *  which is also what an all-declined dialog returns (ADR 0079). */
        kickerPayments?: Record<string, number>;
        buyback?: boolean;
        /** CR 601.3c — the caster acknowledged the mandatory surcharge by
         *  confirming the dialog. Only ever `true`, and only when
         *  `flashSurcharge` was shown; `announceCast` derives the charge itself
         *  and merely validates this declaration. */
        payFlashSurcharge?: boolean;
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
    maxX,
    kickers,
    buyback,
    flashSurcharge,
    onConfirm,
    onCancel,
}: CastCostDialogProps) {
    const [xRaw, setXRaw] = useState("");
    // Times to pay each Kicker, keyed by `KickerCost.id`, held as RAW stepper text
    // so a half-typed Multikicker value round-trips (CR 702.33e). Absent = "0".
    const [kickerRaw, setKickerRaw] = useState<Record<string, string>>({});
    const [buybackPay, setBuybackPay] = useState(false);

    // Reset the form each time the dialog is (re)opened so a previous cast's
    // entries never leak into the next one.
    const [prevOpen, setPrevOpen] = useState(open);
    if (open !== prevOpen) {
        setPrevOpen(open);
        if (open) {
            setXRaw("0");
            setKickerRaw({});
            setBuybackPay(false);
        }
    }

    const xValue = askX ? parseNonNegInt(xRaw) : 0;
    // CR 702.33 — resolve every Kicker's raw entry to a count. A malformed
    // Multikicker entry (empty, `-1`, `1.5`) blocks submit exactly as a malformed
    // X does; a toggle is 0/1 and can never be malformed.
    const kickerCounts = (kickers ?? []).map((k) => ({
        id: k.id,
        count: parseNonNegInt(kickerRaw[k.id] ?? "0"),
    }));
    const kickersValid = kickerCounts.every((k) => k.count !== null);
    // CR 702.34a / 118.5 — a typed X above the flashback exile cap is invalid,
    // not silently clamped: the stepper buttons already stop at `maxX`, but a
    // hand-typed value must block submit so the caster can't announce an
    // unpayable X.
    const xWithinCap = maxX === undefined || xValue === null || xValue <= maxX;
    const valid = xValue !== null && kickersValid && xWithinCap;

    const submit = () => {
        if (!valid) return;
        // CR 702.33 — only the PAID Kickers reach the mutation; an all-declined
        // dialog sends `undefined` (not kicked), so declining after seeing the
        // cost casts the spell unkicked.
        const payments: Record<string, number> = {};
        for (const k of kickerCounts) {
            if (k.count && k.count > 0) payments[k.id] = k.count;
        }
        onConfirm({
            chosenX: askX ? (xValue as number) : undefined,
            kickerPayments:
                Object.keys(payments).length > 0 ? payments : undefined,
            buyback: buyback ? buybackPay : undefined,
            payFlashSurcharge: flashSurcharge !== undefined ? true : undefined,
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
                            max={maxX}
                            autoFocus
                        />
                        {maxX !== undefined && (
                            <span className="text-xs text-text-muted">
                                Max {maxX} — you must exile X cards from your
                                graveyard to pay the flashback cost.
                            </span>
                        )}
                    </div>
                )}

                {(kickers ?? []).map((k, i) => (
                    <CastCostKickerField
                        key={k.id}
                        kickerId={k.id}
                        description={k.description}
                        multi={k.multi}
                        value={kickerRaw[k.id] ?? "0"}
                        onChange={(next) =>
                            setKickerRaw((prev) => ({ ...prev, [k.id]: next }))
                        }
                        autoFocus={!askX && i === 0 && k.multi}
                    />
                ))}

                {buyback && (
                    <label className="flex items-center gap-2.5">
                        <Checkbox
                            checked={buybackPay}
                            onCheckedChange={setBuybackPay}
                        />
                        <span className="text-sm font-medium text-text">
                            Pay buyback cost
                        </span>
                    </label>
                )}

                {flashSurcharge !== undefined && (
                    <p
                        data-testid="cast-cost-flash-surcharge"
                        className="text-sm font-medium text-text"
                    >
                        Casting this now costs an additional {flashSurcharge} —
                        you may cast it as though it had flash only if you pay
                        that much more.
                    </p>
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
