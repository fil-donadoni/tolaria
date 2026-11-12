// PROTOTYPE (zone-target highlight) — B2: the stack row's OWN target block.
// Rendered inside the real StackRow (only while ?zoneProto&variant=B2): one
// compact line per announced target, WHATEVER its kind (owner feedback
// 2026-11-12: a spell targeting another stack object reports it here too) —
// a card in a graveyard, a spell/ability on the stack, a permanent, a player.
// The overlay draws the zone-card arrows from these lines to the pile.
import type { CardInstance, Player, StackItem } from "~/types/game";
import ProtoThumb, { Crosshair } from "./proto-thumb";
import { protoName } from "./use-zone-target-model";
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
    if (variant !== "B2") return null;
    const lines: Line[] = (item.targets ?? []).flatMap((t): Line[] => {
        switch (t.type) {
            case "graveyard-card": {
                const owner = allPlayers.find((p) => p.id === t.playerId);
                const card = owner?.graveyard.find((c) => c.id === t.id);
                if (!card) return [];
                return [
                    {
                        id: t.id,
                        card,
                        title: protoName(card),
                        where: `in ${whose(owner, viewerId)} graveyard`,
                        group: `${item.id}:${owner!.id}`,
                    },
                ];
            }
            case "spell": {
                const idx = stack.findIndex((s) => s.id === t.id);
                const target = stack[idx];
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
                        where: `${kind} on the stack`,
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
                        where: "on the battlefield",
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
                        where: p?.id === viewerId ? "you" : "player",
                    },
                ];
            }
            default:
                return [];
        }
    });
    if (lines.length === 0) return null;
    return (
        <span className="mt-0.5 flex flex-col gap-1 border-t border-border-strong/60 pt-1">
            {lines.map((l) => (
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
