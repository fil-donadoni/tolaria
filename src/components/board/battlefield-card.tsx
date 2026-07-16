import type { CardInstance } from "~/types/game";
import CardImage from "../cards/card-image";
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "~/components/ui/tooltip";
import { useGameContext } from "~/hooks/useGameContext";
import { effectivePower, effectiveToughness } from "~/lib/effective-stats";
import { isCreature } from "~/lib/card-utils";
import { getColorOverrideDisplay } from "~/lib/color-override";
import ActivatableAbilityMenu from "./activatable-ability-menu";
import CounterBadges from "./counter-badges";
import PlaneswalkerLoyaltyBadge from "./planeswalker-loyalty-badge";
import NotedManaBadge from "./noted-mana-badge";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";

export type CardVisualState = {
    interactive: boolean;
    enabled: boolean;
    dimmed: boolean;
    combatOffset: string;
    ringClass: string;
    badge: { color: string; index: number } | null;
    tooltip?: string;
    /** CR 601.2d — this permanent is a legal target of an active divide-as-you-
     *  choose selection (Pyrokinesis), so it carries an on-card `[−] N [+]`
     *  stepper instead of being click-to-target. Absent ⇒ false. */
    divideTarget?: boolean;
    /** This permanent is a legal target of the spell/ability currently choosing
     *  targets (`pendingTarget`), so it renders the SAME accent-strong glow ring
     *  a targetable player nameplate gets (player-nameplate.tsx) instead of a
     *  faded Tailwind ring. A box-shadow glow can't live in `ringClass`, so it's
     *  a separate overlay in `board-battlefield-card`. Absent ⇒ false. */
    targetGlow?: boolean;
};

export type ActivatableAbility = {
    id: string;
    oracleText: string;
};

export default function BattlefieldCard({
    card,
    vs,
    onClick,
    style,
    activatableAbilities,
    onActivateAbility,
}: {
    card: CardInstance;
    vs: CardVisualState;
    onClick: (e: React.MouseEvent) => void;
    style?: React.CSSProperties;
    activatableAbilities?: ActivatableAbility[];
    onActivateAbility?: (abilityId: string, keepPriority: boolean) => void;
}) {
    const hasAbilities = !!activatableAbilities?.length;
    const { allPlayers, emblems } = useGameContext();

    const abilities = activatableAbilities ?? [];
    const activate = (abilityId: string, keepPriority: boolean) =>
        onActivateAbility?.(abilityId, keepPriority);
    const ability = useAbilityCardClick(abilities, activate);

    // Scope transitions to transform+opacity only. `transition-all` kept the
    // layer in an "animating" state and Chrome's compositor served a downsampled
    // tile for the image inside (random blur on adjacent identical cards).
    const cardClassName = `relative transition-[transform,opacity] duration-[250ms] flex items-center justify-center shrink-0 ${vs.combatOffset} ${
        hasAbilities && !vs.interactive
            ? "cursor-pointer"
            : vs.interactive
              ? vs.enabled
                  ? "cursor-pointer"
                  : "cursor-not-allowed"
              : ""
    }`;

    const darkenOverlay =
        (vs.interactive && !vs.enabled) || vs.dimmed ? (
            <div className="absolute inset-0 bg-black/40 rounded-sm pointer-events-none z-20" />
        ) : null;

    const tapped = card.isTapped;
    const baseWidth = (style?.width as string | undefined) ?? "var(--card-w)";
    const baseHeight = `calc(${baseWidth} * 7 / 5)`;

    // Layout box stays portrait regardless of tap state: untapped height fits
    // the band, tapping only rotates the visual without resizing the layout
    // box.
    const boxStyle: React.CSSProperties = {
        ...style,
        height: "100%",
        width: "auto",
        maxHeight: baseHeight,
        maxWidth: baseWidth,
        aspectRatio: "5 / 7",
    };

    // Inner fills the outer box; rotation is purely visual.
    // `will-change: transform` + `backface-visibility: hidden` pin the layer
    // bitmap at native resolution during the rotate transition, preventing the
    // compositor from keeping a low-res tile.
    const innerStyle: React.CSSProperties = {
        position: "absolute",
        inset: 0,
        transform: tapped ? "rotate(90deg)" : "rotate(0deg)",
        transformOrigin: "center",
        transition: "transform 250ms",
        willChange: "transform",
        backfaceVisibility: "hidden",
    };

    const badgeEl = vs.badge && (
        <div
            className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${vs.badge.color} text-white text-xs font-bold flex items-center justify-center z-10`}
        >
            {vs.badge.index + 1}
        </div>
    );

    // Effective P/T (CR 611, 613 — layer 7c static buffs) and marked damage
    // (CR 120.3, cleared at CLEANUP CR 514.2). Damage stacks above P/T on the
    // bottom-right; hidden when 0/undefined.
    const ptDamageStack = isCreature(card) ? (
        <div className="absolute bottom-1.5 right-1.5 flex flex-col items-end gap-0.5 pointer-events-none z-10">
            {(card.damageMarked ?? 0) > 0 && (
                <div className="bg-red-600 px-1 py-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                    {card.damageMarked}
                </div>
            )}
            <div className="bg-black p-0.5 rounded-xs text-[10px] font-bold text-white leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
                {effectivePower(allPlayers, card, emblems)}/
                {effectiveToughness(allPlayers, card, emblems)}
            </div>
        </div>
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

    const inner = (
        <div className={`relative ${vs.ringClass}`} style={innerStyle}>
            <CardImage card={card} />
            {colorOverrideOverlay}
            {darkenOverlay}
            {badgeEl}
            <CounterBadges card={card} />
            <NotedManaBadge card={card} />
            {ptDamageStack}
            <PlaneswalkerLoyaltyBadge card={card} />
        </div>
    );

    // The clickable element binds tap/pay `onClick` normally; when the permanent
    // has activatable abilities it instead binds the ability gesture handlers
    // (touch → affordance, desktop → left-click menu) and the shared
    // `ActivatableAbilityMenu` wraps it with the context menu + action-sheet.
    const clickHandlers = hasAbilities
        ? { onClick: ability.onClick, onTouchStart: ability.onTouchStart }
        : { onClick };

    const cardContent = vs.tooltip ? (
        <Tooltip>
            <TooltipTrigger
                render={<div data-arrow-anchor-permanent={card.id} />}
                className={cardClassName}
                style={boxStyle}
                {...clickHandlers}
            >
                {inner}
            </TooltipTrigger>
            <TooltipContent>{vs.tooltip}</TooltipContent>
        </Tooltip>
    ) : (
        <div
            data-arrow-anchor-permanent={card.id}
            className={cardClassName}
            style={boxStyle}
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
