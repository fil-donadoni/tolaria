import type { CardInstance } from "~/types/game";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";
import { isSeenByOpponent } from "~/lib/hand-knowledge";
import type { ManualHandInteraction } from "~/lib/manual-card-verbs";
import CardImage from "../cards/card-image";
import SeenByOpponentBadge from "./seen-by-opponent-badge";
import ActivatableAbilityMenu from "./activatable-ability-menu";

type ManualHandCardProps = {
    /** The Manual Board hand card to render (issue #2347). */
    card: CardInstance;
    /** The injected verb source — always present for the caller (see
     *  `useManualHandInteraction`); typed non-null here so this component
     *  never has to fall back to a GRE-hook branch of its own. */
    manualInteraction: ManualHandInteraction;
    /** Forwarded to CardImage — see `BoardHandCard`'s own prop doc. */
    sizes?: string;
    includeThumb?: boolean;
};

/** Manual Board hand card (issue #2347; split out of `BoardHandCard` on the
 *  PR #2359 review — a BLOCKING finding).
 *
 * `BoardHandCard` used to render this same markup as a late branch, AFTER
 * every GRE hook — including `useHandCardCommit` — had already run
 * unconditionally for the render. That hook is not pure: it calls
 * `getDefinition(cardInstance.card.id)` to read modes/alt-costs/X-cost
 * flags, and `getDefinition` THROWS `Card not found: <id>` for an id the
 * card registry doesn't know (`convex/cards/registry.ts`). A Manual Game's
 * hand card ids are Full Catalogue PRINT ids (ADR 0080 forbids hydrating a
 * `CardDefinition` for them), and the Tabletop deck builder's pool is the
 * whole ~27K catalogue — including cards the GRE does not implement. So any
 * Tabletop hand holding an unimplemented card crashed the real board on
 * render, with no ErrorBoundary above it to catch it.
 *
 * This component is the fix: it is the ENTIRE manual hand card, and it
 * calls NO GRE hook — no `useGameContext`, no `useHandCardCommit`, no
 * `useMutation` — so there is no code path here that can read a
 * `CardDefinition` at all. `BoardHandCard` now renders this in place of
 * running its own body whenever `useManualHandInteraction()` returns
 * non-null, checked as the FIRST thing it does, before any GRE hook. The
 * only card-aware read left is `CardImage`'s own `tryGetDefinition` (never
 * throws — art falls back to a placeholder) and `isSeenByOpponent`, which
 * reads a server-computed flag off the wire card, not the registry. */
export default function ManualHandCard({
    card,
    manualInteraction,
    sizes = "120px",
    includeThumb = false,
}: ManualHandCardProps) {
    const manualAbilities = manualInteraction.getVerbs(card.id);
    const manualActivate = (abilityId: string, keepPriority: boolean) => {
        // Hand verbs never pay a cost — `keepPriority` only exists to match
        // `useAbilityCardClick`'s shared contract with the battlefield card.
        void keepPriority;
        manualInteraction.activate(card.id, abilityId);
    };
    const manualAbilityClick = useAbilityCardClick(
        manualAbilities,
        manualActivate
    );

    // ADR 0026 / PRD #338 (slice 3) — the eye badge shows iff an opponent
    // legitimately knows this specific own-hand card. Derived server-side;
    // raw `knownTo` never reaches here.
    const seen = isSeenByOpponent(card);

    // The root binds NO pointer handlers of its own (unlike the GRE board's
    // `useDragToCommit` wiring): a manual hand card's drag is the
    // board-level `useManualDrag` gesture bound on `<main>`
    // (`manual-board-view.tsx`), which hit-tests this same
    // `data-board-hand-card` attribute — this component only has to keep
    // carrying it, never intercept the pointerdown that gesture bubbles up
    // to. Click/touch are the ONE gesture this component owns, via the same
    // `ActivatableAbilityMenu` + `useAbilityCardClick` pair the battlefield
    // permanents already ride (`battlefield-card.tsx`).
    return (
        <ActivatableAbilityMenu
            abilities={manualAbilities}
            onActivate={manualActivate}
            sheetOpen={manualAbilityClick.sheetOpen}
            onSheetClose={manualAbilityClick.onSheetClose}
        >
            <div
                data-board-hand-card={card.id}
                className={manualAbilities.length > 0 ? "cursor-pointer" : ""}
                onClick={manualAbilityClick.onClick}
                onTouchStart={manualAbilityClick.onTouchStart}
            >
                <CardImage
                    card={card}
                    sizes={sizes}
                    includeThumb={includeThumb}
                />
                {seen && <SeenByOpponentBadge />}
            </div>
        </ActivatableAbilityMenu>
    );
}
