import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AttackManaTaxPayment } from "~/types/game";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import ManaSymbol from "~/components/cards/mana-symbol";

type Props = {
    gameId: Id<"games">;
    playerId: string;
    payment: AttackManaTaxPayment;
};

const COLOR_ORDER = ["W", "U", "B", "R", "G", "C"] as const;

/** Ordered mana-symbol pips for the attack tax cost (CR 508.1c/1g). Generic
 *  first (the {N} pip — attack taxes are all generic), then any coloured pips
 *  for completeness. Uses the shared mana-symbol SVGs, never a bare number. */
function costSymbols(payment: AttackManaTaxPayment): string[] {
    const cost = payment.cost;
    const symbols: string[] = [];
    // `beginAttackManaTax` aggregates the tax with all generic folded into
    // `generic` (attack taxes are all {N}); a numeric `X` is generic too.
    const xGeneric = typeof cost.X === "number" ? cost.X : 0;
    const genericField = typeof cost.generic === "number" ? cost.generic : 0;
    const generic = genericField + xGeneric;
    if (generic > 0) symbols.push(String(generic));
    for (const color of COLOR_ORDER) {
        const raw = cost[color];
        const n = typeof raw === "number" ? raw : 0;
        for (let i = 0; i < n; i++) symbols.push(color);
    }
    return symbols;
}

/** CR 508.1c/1g — the per-attacker MANA attack tax prompt (Propaganda / Ghostly
 *  Prison / Collective Restraint). The attacking player must pay the tax to
 *  legalize the declared attack: tap mana sources by hand (highlighted on the
 *  battlefield) or press Auto-tap, and the attack finalizes the moment the pool
 *  covers the cost. Cancel drops the whole declaration and returns to attacker
 *  selection (no lands stay tapped). Mirrors {@link PaymentBanner} for the
 *  parked attack tax. */
export default function AttackManaTaxBanner({
    gameId,
    playerId,
    payment,
}: Props) {
    // Issue #1813 — always pinned: paying the tax routes clicks to mana
    // sources on the battlefield (see docstring above), so a vertically
    // centered panel would sit directly on top of what the player must tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });
    const autoTap = useMutation(api.game.autoTapForAttackTax);
    const cancel = useMutation(api.game.cancelAttackTax);
    const [busy, setBusy] = useState(false);

    async function run(mutation: () => Promise<unknown>) {
        if (busy) return;
        setBusy(true);
        try {
            await mutation();
        } catch {
            // Server-side guard rejected (nothing to auto-tap yet, etc.) — leave
            // the banner up so the player can tap manually or cancel.
        } finally {
            setBusy(false);
        }
    }

    const symbols = costSymbols(payment);

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel density="compact" className="w-72 max-w-full px-6 py-4">
                    <p className="text-center font-beleren text-sm tracking-wide text-parchment">
                        Attack Tax
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-border-accent/50 to-transparent my-2.5" />

                    <div className="flex items-center justify-center gap-1.5 py-1">
                        {symbols.map((s, i) => (
                            <ManaSymbol
                                key={`${s}-${i}`}
                                symbol={s}
                                className="size-7"
                            />
                        ))}
                    </div>
                    <p className="mt-1 text-center text-[11px] leading-snug text-text-muted">
                        Pay this cost to legalize the attack, or cancel.
                    </p>

                    <div className="mt-3 flex gap-2.5">
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() =>
                                run(() => autoTap({ gameId, playerId }))
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={busy}
                            className="flex-1"
                        >
                            Auto-tap
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                                run(() => cancel({ gameId, playerId }))
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={busy}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                    </div>
                </Panel>
            </div>
        </div>
    );
}
