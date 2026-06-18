import { useMemo } from "react";
import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { getCardById } from "@convex/cards";
import { isCreature, isLand, groupByName } from "~/lib/card-utils";
import { useBattlefieldInteraction } from "~/hooks/useBattlefieldInteraction";
import BattlefieldCard from "./battlefield-card";
import CombatPanels from "./combat-panels";

// ---------------------------------------------------------------------------
// PlayerBattlefield
// ---------------------------------------------------------------------------

export default function PlayerBattlefield({ player }: { player: Player }) {
    const { playerId, allPlayers } = useGameContext();
    const isMe = player.id === playerId;

    // Battlefield interaction controller — the click handlers, ability menu,
    // mana-choice picker and validation toast are owned by the shared hook so
    // the classic and spatial boards (#272) dispatch identical mutations. The
    // hook also re-exposes `getVisualState`/`canInteract` from the shared
    // visual-state hook (#256) so this component needs a single call.
    const {
        getVisualState,
        handleClickWithEvent,
        getActivatable,
        handleActivateAbility,
        overlays,
    } = useBattlefieldInteraction(player);

    // --- Rendering ---

    const creatures = player.battlefield.filter(isCreature);
    const lands = player.battlefield.filter((c) => isLand(c) && !isCreature(c));
    // Auras attached to a host render alongside that host (not in `others`).
    // The aura's controller may differ from the host's (e.g. Warp Artifact on
    // an opponent's artifact, CR 303.4): scan all battlefields for auras
    // whose host sits on this side, not just `player.battlefield`.
    // Ungrouped Aura leftovers (attachedTo unset or host nowhere on the
    // board) fall through to `others` so they remain visible.
    const attachedAurasByHost = useMemo(() => {
        const map = new Map<string, CardInstance[]>();
        const hostsOnThisSide = new Set(player.battlefield.map((c) => c.id));
        for (const p of allPlayers) {
            for (const c of p.battlefield) {
                if (!c.attachedTo) continue;
                if (!hostsOnThisSide.has(c.attachedTo)) continue;
                const bucket = map.get(c.attachedTo);
                if (bucket) bucket.push(c);
                else map.set(c.attachedTo, [c]);
            }
        }
        return map;
    }, [player.battlefield, allPlayers]);
    const hostExistsAnywhere = useMemo(() => {
        const ids = new Set<string>();
        for (const p of allPlayers) {
            for (const c of p.battlefield) ids.add(c.id);
        }
        return ids;
    }, [allPlayers]);
    const others = player.battlefield.filter(
        (c) =>
            !isCreature(c) &&
            !isLand(c) &&
            !(c.attachedTo && hostExistsAnywhere.has(c.attachedTo))
    );

    function renderAttachedAura(aura: CardInstance, index: number) {
        const vs = getVisualState(aura);
        const abilities = getActivatable(aura);
        // Auras peek out from behind the host, up-and-left. Each additional
        // aura fans further up-left so the stack remains visible. Rendered
        // BEFORE the host in DOM order so natural painting puts the host on
        // top (no negative z-index needed).
        const offset = 22 * (index + 1);
        return (
            <div
                key={aura.id}
                className="absolute h-full pointer-events-auto"
                style={{
                    top: `-${offset}px`,
                    left: `-${offset}px`,
                    // Explicit width — without it, an absolute box with
                    // `width: auto` collapses to 0 because the child also
                    // resolves its width from its parent (host's `width: auto`
                    // + aspect-ratio chain). Manifested as the aura disappearing
                    // for the controller while opponent saw it correctly.
                    width: "var(--card-w)",
                }}
            >
                <BattlefieldCard
                    card={aura}
                    vs={vs}
                    onClick={(e) => handleClickWithEvent(aura, e)}
                    activatableAbilities={abilities}
                    onActivateAbility={(aId, keep) =>
                        handleActivateAbility(aura.id, aId, keep)
                    }
                />
            </div>
        );
    }

    function renderGroup(group: CardInstance[]) {
        // Creatures with attached auras render as individual columns (no
        // by-name stacking, since each instance's auras are distinct). The
        // aura overlays the host up-and-left via absolute positioning.
        const anyHasAuras = group.some((c) => attachedAurasByHost.has(c.id));
        if (group.length === 1 || anyHasAuras) {
            return (
                <div key={group[0].id} className="flex h-full gap-1">
                    {group.map((card) => {
                        const vs = getVisualState(card);
                        const abilities = getActivatable(card);
                        const attached = attachedAurasByHost.get(card.id) ?? [];
                        return (
                            <div key={card.id} className="relative flex h-full">
                                {attached.map((a, i) =>
                                    renderAttachedAura(a, i)
                                )}
                                <BattlefieldCard
                                    card={card}
                                    vs={vs}
                                    onClick={(e) =>
                                        handleClickWithEvent(card, e)
                                    }
                                    activatableAbilities={abilities}
                                    onActivateAbility={(aId, keep) =>
                                        handleActivateAbility(
                                            card.id,
                                            aId,
                                            keep
                                        )
                                    }
                                />
                            </div>
                        );
                    })}
                </div>
            );
        }
        const overlapWidth = `${0.5 * (group.length - 1) + 1}`;
        return (
            <div
                key={getCardById(group[0].card.id).name}
                className="flex shrink-0 h-full"
                style={{ width: `calc(var(--card-w) * ${overlapWidth})` }}
            >
                {group.map((card, i) => {
                    const vs = getVisualState(card);
                    const abilities = getActivatable(card);
                    return (
                        <BattlefieldCard
                            key={card.id}
                            card={card}
                            vs={vs}
                            onClick={(e) => handleClickWithEvent(card, e)}
                            activatableAbilities={abilities}
                            onActivateAbility={(aId, keep) =>
                                handleActivateAbility(card.id, aId, keep)
                            }
                            style={{
                                width: "var(--card-w)",
                                flexShrink: 0,
                                marginLeft:
                                    i > 0
                                        ? "calc(var(--card-w) * -0.5)"
                                        : undefined,
                                zIndex: i,
                            }}
                        />
                    );
                })}
            </div>
        );
    }

    function renderZone(cards: CardInstance[]) {
        return groupByName(cards).map(renderGroup);
    }

    return (
        <div
            className={`flex-1 min-h-0 w-full px-4 py-2 flex flex-col gap-2 relative ${isMe ? "" : "flex-col-reverse"}`}
        >
            <div className="flex-1 min-h-0 flex gap-2 justify-center items-center">
                {renderZone(creatures)}
            </div>
            <div className="flex-1 min-h-0 flex">
                <div className="flex-1 flex gap-2 justify-center items-center">
                    {renderZone(lands)}
                </div>
                <div className="flex-1 flex gap-2 justify-center items-center">
                    {renderZone(others)}
                </div>
            </div>

            <CombatPanels player={player} />

            {overlays}
        </div>
    );
}
