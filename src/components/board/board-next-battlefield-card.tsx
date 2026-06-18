import type { CardInstance } from "~/types/game";
import type { CardVisualState, ActivatableAbility } from "./battlefield-card";
import { useGameContext } from "~/hooks/useGameContext";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { isCreature } from "~/lib/card-utils";
import { getColorOverrideDisplay } from "~/lib/color-override";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import ActivatableAbilityMenu from "./activatable-ability-menu";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";

type BoardNextBattlefieldCardProps = {
    card: CardInstance;
    /** Board-coupled visual state computed by `useBattlefieldVisualState`
     *  (combat rings, tap, legal-target highlight, dim, badge). The SAME
     *  computation the classic board uses — reused as-is (#256). */
    vs: CardVisualState;
    /** Per-card click handler from the shared `useBattlefieldInteraction` hook
     *  (#272). The battlefield is click-only on the spatial board (no drag):
     *  clicking a mana source taps/untaps it (or routes cast/activation
     *  payment), and the event carries the pointer coords the mana-choice
     *  picker anchors to. Wired by `BoardNextBattlefield`; omitted means inert
     *  (e.g. opponent's permanents the viewer can't act on). The ability menu /
     *  targeting / combat branches live in the same handler and ship in the
     *  follow-up slices (#278/#279/#281). */
    onClick?: (e: React.MouseEvent) => void;
    /** Activated abilities the viewer may fire on this permanent, from the
     *  shared `useBattlefieldInteraction` hook's `getActivatable` (#278). When
     *  non-empty, the card gains the same right-click context menu / touch
     *  action-sheet affordance as the classic board via the shared
     *  {@link ActivatableAbilityMenu}.
     *
     *  During combat sub-steps (DECLARE_ATTACKERS / DECLARE_BLOCKERS) this same
     *  click handler dispatches the combat declaration mutations
     *  (toggleAttacker / selectBlocker / assignBlockerTarget) via the hook's
     *  `handleClickWithEvent`, which routes combat clicks straight to the
     *  declaration branch instead of opening a multi-color source's mana picker
     *  (#281). */
    activatableAbilities?: ActivatableAbility[];
    /** Dispatches the selected ability — wired to the hook's
     *  `handleActivateAbility` (X prompt, keep-priority, mana entry). */
    onActivateAbility?: (abilityId: string, keepPriority: boolean) => void;
};

/** Battlefield card for the new spatial board (PRD #249, slice #256).
 *
 *  Carries every board-coupled visual signal a permanent needs to read at a
 *  glance, sourced from the shared pure {@link CardVisualState} computation
 *  (`useBattlefieldVisualState`) so the classic and spatial boards never
 *  diverge:
 *  - combat grouping ring (`vs.ringClass`) + combat-group badge (`vs.badge`),
 *  - tapped rotation (90° visual rotate, layout box unchanged),
 *  - marked damage (CR 120.3) + effective P/T (CR 613, layer 7c) on creatures,
 *  - legal-target / legal-choice highlight rides on `vs.ringClass` during
 *    targeting/choice; a dim overlay marks ineligible/dimmed permanents.
 *
 *  Emits `data-arrow-anchor-permanent` so target arrows
 *  (`target-arrows-overlay.tsx`) attach to this card. Hover tilt + zoom preview
 *  ride along via {@link CardTilt3D} / {@link CardImage} (#253).
 *
 *  Reads ONLY projected (`PublicGameState` / `FullGameState`) fields — no GRE
 *  import — consistent with the CLAUDE.md wire-format rule. The battlefield is
 *  click-only on the spatial board (no drag): the click handler is wired by the
 *  parent in a later slice; this slice renders state only. */
export default function BoardNextBattlefieldCard({
    card,
    vs,
    onClick,
    activatableAbilities,
    onActivateAbility,
}: BoardNextBattlefieldCardProps) {
    const { allPlayers } = useGameContext();
    const creature = isCreature(card);

    const abilities = activatableAbilities ?? [];
    const hasAbilities = abilities.length > 0;
    const activate = (abilityId: string, keepPriority: boolean) =>
        onActivateAbility?.(abilityId, keepPriority);
    const ability = useAbilityCardClick(abilities, activate);

    const damage = card.damageMarked ?? 0;

    const ptDamageStack = creature ? (
        <div className="absolute bottom-1.5 right-1.5 flex flex-col items-end gap-0.5 pointer-events-none z-20">
            {damage > 0 && (
                <div className="bg-red-600 px-1 py-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                    {damage}
                </div>
            )}
            <div className="bg-black p-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                {effectivePower(allPlayers, card)}/
                {effectiveToughness(allPlayers, card)}
            </div>
        </div>
    ) : null;

    const badgeEl = vs.badge && (
        <div
            className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${vs.badge.color} text-white text-xs font-bold flex items-center justify-center z-20`}
        >
            {vs.badge.index + 1}
        </div>
    );

    const darkenOverlay =
        (vs.interactive && !vs.enabled) || vs.dimmed ? (
            <div className="absolute inset-0 bg-black/40 rounded-sm pointer-events-none z-10" />
        ) : null;

    const colorDisplay = card.colorOverride?.length
        ? getColorOverrideDisplay(card.colorOverride)
        : null;

    const colorOverrideOverlay = colorDisplay ? (
        <div
            className="absolute inset-0 pointer-events-none rounded-[7%] z-[5]"
            style={{
                boxShadow: `inset 0 0 0 4px ${colorDisplay.inner}`,
                background: [
                    `linear-gradient(180deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                    `linear-gradient(0deg, ${colorDisplay.inner} 0%, transparent 22%)`,
                    `linear-gradient(90deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                    `linear-gradient(270deg, ${colorDisplay.inner} 0%, transparent 18%)`,
                ].join(", "),
            }}
        />
    ) : null;

    // Tapped state rotates the visual only; the slot placement (#251/#252) sizes
    // the layout box, so rotation here never reflows neighbors.
    const tapTransform = card.isTapped ? "rotate(90deg)" : undefined;

    // Cursor affordance mirrors the classic battlefield card: a pointer when
    // the permanent is interactive and enabled, not-allowed when interactive
    // but blocked, default otherwise (#272).
    const cursorClass = onClick
        ? vs.interactive
            ? vs.enabled
                ? "cursor-pointer"
                : "cursor-not-allowed"
            : "cursor-pointer"
        : "";

    const inner = (
        <CardTilt3D>
            <div
                className={`relative w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)] ${vs.ringClass}`}
            >
                <CardImage card={card} />
                {colorOverrideOverlay}
                {darkenOverlay}
                {badgeEl}
                {ptDamageStack}
            </div>
        </CardTilt3D>
    );

    // The clickable element binds tap/pay `onClick` normally; when the permanent
    // has activatable abilities it instead binds the ability gesture handlers
    // (touch → affordance, desktop → right-click menu) and the shared
    // `ActivatableAbilityMenu` wraps it — identical affordance to the classic
    // board (#278).
    const clickHandlers = hasAbilities
        ? { onClick: ability.onClick, onTouchStart: ability.onTouchStart }
        : { onClick };

    const cardContent = (
        <div
            data-arrow-anchor-permanent={card.id}
            data-tapped={card.isTapped ? "true" : undefined}
            className={`w-full h-full ${vs.combatOffset} ${cursorClass} transition-[transform] duration-[250ms]`}
            style={{ transform: tapTransform }}
            {...clickHandlers}
        >
            {inner}
        </div>
    );

    return (
        <ActivatableAbilityMenu
            abilities={abilities}
            onActivate={activate}
            sheetOpen={ability.sheetOpen}
            onSheetClose={ability.onSheetClose}
        >
            {cardContent}
        </ActivatableAbilityMenu>
    );
}
