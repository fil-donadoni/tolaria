// PROTOTYPE (zone-target highlight) — B (chosen 2026-11-12): the stack row's
// OWN target block. Rendered inside the real StackRow: one compact line per
// announced target, whatever its kind — a card in a graveyard, a spell or
// ability on the stack, a permanent, a player — each naming WHERE it is and
// WHICH one (the stack row number, the card's position in its zone). The block
// collapses like every other game box. The overlay draws the zone-card arrows
// from these lines to the pile.
import { useState } from "react";
import type { CardInstance, Player, StackItem } from "~/types/game";
import ProtoThumb, { Crosshair } from "./proto-thumb";
import { protoName } from "./use-zone-target-model";
import { stackNumber, zoneNumber } from "./proto-zone-index";
import { useZoneProtoVariant } from "./zone-proto-store";

type Line = {
    id: string;
    card: CardInstance | null;
    title: string;
    where: string;
    group?: string;
};

function whose(p: Player | undefined, viewerId: string) {
    return !p ? "?" : p.id === viewerId ? "your" : `${p.name}'s`;
}

export default function ProtoStackRowTargets({
    item,
    allPlayers,
    stack,
    viewerId,
}: {
    item: StackItem;
    allPlayers: readonly Player[];
    stack: readonly StackItem[];
    viewerId: string;
}) {
    const variant = useZoneProtoVariant();
    const [open, setOpen] = useState(true);
    if (variant !== "B2") return null;
    const lines: Line[] = (item.targets ?? []).flatMap((t): Line[] => {
        switch (t.type) {
            case "graveyard-card": {
                const owner = allPlayers.find((p) => p.id === t.playerId);
                const card = owner?.graveyard.find((c) => c.id === t.id);
                if (!owner || !card) return [];
                return [
                    {
                        id: t.id,
                        card,
                        title: protoName(card),
                        where: `#${zoneNumber(owner.graveyard, t.id)} in ${whose(owner, viewerId)} graveyard`,
                        group: `${item.id}:${owner.id}`,
                    },
                ];
            }
            case "spell": {
                const target = stack.find((s) => s.id === t.id);
                if (!target) return [];
                const kind =
                    target.abilityId || target.triggeredAbilityId
                        ? "ability"
                        : "spell";
                return [
                    {
                        id: t.id,
                        card: target,
                        title: protoName(target),
                        where: `#${stackNumber(stack, t.id)} on the stack (${kind})`,
                    },
                ];
            }
            case "permanent": {
                const owner = allPlayers.find((p) =>
                    p.battlefield.some((c) => c.id === t.id)
                );
                const card = owner?.battlefield.find((c) => c.id === t.id);
                if (!card) return [];
                return [
                    {
                        id: t.id,
                        card,
                        title: protoName(card),
                        where: `on ${whose(owner, viewerId)} battlefield`,
                    },
                ];
            }
            case "player": {
                const p = allPlayers.find((x) => x.id === t.id);
                return [
                    {
                        id: t.id,
                        card: null,
                        title: p?.name ?? "?",
                        where: p?.id === viewerId ? "player · you" : "player",
                    },
                ];
            }
            default:
                return [];
        }
    });
    if (lines.length === 0) return null;
    const toggle = (e: React.SyntheticEvent) => {
        // Inside the row's own button: never select the row.
        e.stopPropagation();
        e.preventDefault();
        setOpen((o) => !o);
    };
    return (
        <span className="mt-0.5 flex flex-col gap-1 border-t border-border-strong/60 pt-1">
            <span
                role="button"
                tabIndex={0}
                aria-expanded={open}
                data-proto-measure={`b2h:${item.id}`}
                onClick={toggle}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") toggle(e);
                }}
                className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase hover:text-text"
            >
                <span
                    aria-hidden
                    className="inline-block transition-transform"
                    style={{ transform: open ? "rotate(90deg)" : "none" }}
                >
                    ▸
                </span>
                Targets · {lines.length}
            </span>
            {open &&
                lines.map((l) => (
                    <span
                        key={l.id}
                        data-proto-group={l.group}
                        data-proto-measure={`b2:${item.id}:${l.id}`}
                        className="flex items-center gap-2"
                    >
                        {l.card ? (
                            <ProtoThumb card={l.card} width={26} />
                        ) : (
                            <span className="flex h-[36px] w-[26px] items-center justify-center rounded bg-white/10 text-[10px] font-bold text-text">
                                {l.title.slice(0, 1)}
                            </span>
                        )}
                        <span className="flex min-w-0 flex-col leading-tight">
                            <span className="flex items-center gap-1 text-[11px] font-medium text-text">
                                <span className="text-accent-strong">
                                    <Crosshair size={11} />
                                </span>
                                <span className="truncate">{l.title}</span>
                            </span>
                            <span className="text-[10px] text-text-muted">
                                {l.where}
                            </span>
                        </span>
                    </span>
                ))}
        </span>
    );
}
