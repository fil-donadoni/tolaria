import type { Color } from "~/types/cards";
import { colors } from "~/types/cards";
import type { Player, RestrictedMana } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { cardDefName, restrictedManaLabel } from "~/lib/restricted-mana";

/** Resolves the printed name of the card a `castableCardId` (instance id) refers
 *  to by locating that instance in the player's exile and mapping it to its def
 *  id. Returns undefined when the instance can't be found (e.g. already cast). */
function resolveExiledCardName(
    player: Player,
    instanceId: string
): string | undefined {
    const inst = player.exile.find((c) => c.id === instanceId);
    return inst ? cardDefName(inst.card.id) : undefined;
}

export default function PlayerManaPool({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;
    const colorsWithMana = colors.filter(
        (color) => (player.manaPool[color] ?? 0) > 0
    );

    // Restricted mana (CR 106.6, ADR 0022 / 0042) floats in a parallel pool and
    // is invisible in the ordinary `manaPool`. Surface it here so the player can
    // see that activating e.g. Ice Cauldron's second ability produced mana — and
    // why that mana is set apart (its spend restriction).
    const restricted: RestrictedMana[] = player.restrictedMana ?? [];

    if (!colorsWithMana.length && restricted.length === 0) {
        return null;
    }

    // Local player sits at the bottom of the viewport, so the pool hovers above
    // their life cell. The opponent sits at the top with the side-row mirrored
    // (flex-col-reverse): anchor the pool below their life cell so it stays
    // on-screen instead of being clipped above the viewport edge.
    const positionClass = isMe
        ? "left-0 bottom-full mb-2"
        : "right-0 top-full mt-2";

    return (
        <div
            className={`absolute ${positionClass} z-20 inline-flex w-max flex-col gap-1 bg-black/60 px-2 py-1 rounded-md whitespace-nowrap`}
        >
            {colorsWithMana.length > 0 && (
                <div className="inline-flex gap-2">
                    {colorsWithMana.map((color: Color, key) => (
                        <div
                            className="flex items-center gap-1 shrink-0"
                            key={key}
                        >
                            <img
                                src={`/img/symbols/${color}.svg`}
                                className="size-5 shrink-0"
                            />
                            <p className="font-bold text-sm text-white">
                                {player.manaPool[color] ?? 0}
                            </p>
                        </div>
                    ))}
                </div>
            )}
            {restricted.map((unit, key) => (
                <div
                    key={`restricted-${key}`}
                    className="flex items-center gap-1 shrink-0 rounded border border-accent/70 bg-accent/10 px-1"
                    data-restricted-mana
                    title={restrictedManaLabel(unit, (id) =>
                        resolveExiledCardName(player, id)
                    )}
                >
                    <img
                        src={`/img/symbols/${unit.color}.svg`}
                        className="size-4 shrink-0"
                    />
                    <p className="font-bold text-xs text-accent-strong">
                        {unit.amount}
                    </p>
                    <span className="text-[10px] text-accent-strong/90">
                        {restrictedManaLabel(unit, (id) =>
                            resolveExiledCardName(player, id)
                        )}
                    </span>
                </div>
            ))}
        </div>
    );
}
