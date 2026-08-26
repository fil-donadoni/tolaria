import { getDefinition } from "@convex/cards";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { Panel } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { describeTapOtherProgress } from "~/lib/tap-other-progress";
import { displayCardId } from "~/lib/card-utils";
import type { CardInstance } from "~/types/game";
import type { ManaTapOtherPick } from "~/hooks/useBattlefieldVisualState";

/** Prompt for a NON-stack mana ability's `cost.tapOtherFilter` pick (CR 602.1 /
 *  118.8 / 605.3c, issue #2371 — Urza, Lord High Artificer's "Tap an untapped
 *  artifact you control: Add {U}").
 *
 *  Sibling of {@link PaymentBanner}'s `kind: "activation"` prompt, which covers
 *  the same cost shape on a `useStack: true` ability. The difference is where
 *  the picks live: a stack ability parks them server-side on
 *  `pendingActivation.tapOtherChoice`, while a mana ability resolves in ONE
 *  mutation call with no stack item to defer onto (CR 605.3c), so the picks are
 *  collected client-side and submitted whole. Purely informational — the legal
 *  permanents are highlighted/clickable on the battlefield
 *  (`useBattlefieldVisualState`) and a click commits one pick.
 *
 *  Unlike the attack-cost banner this one DOES cancel: nothing is committed
 *  server-side until the last pick fires `activateManaAbility`, and a mana
 *  ability is never a mandatory cost (CR 601.2 — the player chose to activate
 *  it and may back out before any cost is paid). */
export default function ManaTapOtherBanner({
    pick,
    source,
    onCancel,
}: {
    pick: ManaTapOtherPick;
    /** The ability's source permanent, for the "<card name>" heading. */
    source: CardInstance | undefined;
    onCancel: () => void;
}) {
    // Issue #1813 — always pinned: the legal permanents are highlighted and
    // clicked ON THE BATTLEFIELD, so a vertically centered panel would sit on
    // top of exactly what the player has to tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });

    const pickedPower = pick.picked.reduce((n, p) => n + p.power, 0);
    const heading = source
        ? getDefinition(displayCardId(source)).name
        : "Mana ability";

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel density="compact" className="px-5 py-3">
                    {/* v4 (ADR 0103 §4, issue #2730): title off Beleren onto
                        the chrome display face; the shared `.panel-rule`
                        hairline replaces the repeated gold-gradient divider. */}
                    <p className="text-display text-sm text-text">{heading}</p>
                    <div className="panel-rule my-1.5 h-px w-full" />
                    <p className="text-text-muted text-xs">
                        Activation cost —{" "}
                        {describeTapOtherProgress(
                            pick.spec,
                            pick.picked.length,
                            pickedPower
                        )}
                    </p>
                    <div className="mt-2 flex justify-end">
                        <Button
                            variant="ghost"
                            className="px-3 py-1 text-xs"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                    </div>
                </Panel>
            </div>
        </div>
    );
}
