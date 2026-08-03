import type { PendingTarget } from "~/types/game";

const TARGET_LABEL: Record<string, string> = {
    Creature: "a creature",
    Artifact: "an artifact",
    Enchantment: "an enchantment",
    Land: "a land",
    Planeswalker: "a planeswalker",
    Battle: "a battle",
    player: "a player",
    any: "any target",
    spell: "a spell on the stack",
    "spell-or-permanent": "a spell or permanent",
    card: "a card",
};

// A `spell`-type requirement that opts into an ability kind (Stifle,
// Brown Ouphe — CR 113 / 701.5a) targets an ability on the stack, never a
// spell. Reword the generic "a spell on the stack" so the prompt matches
// what's actually clickable.
const STACK_KIND_LABEL: Record<string, string> = {
    ability: "an ability on the stack",
    "activated-ability": "an activated ability on the stack",
    // CR 702.21a (Ward) — "spell or ability", the unnarrowed kind. In
    // practice Ward's own target auto-resolves (spellTargetsSelfSource); this
    // label only surfaces in the rare multi-legal-target fallback prompt.
    any: "a spell or ability on the stack",
};

export function formatTargetLabel(
    targetType: string | string[],
    zone: PendingTarget["zone"],
    controller: PendingTarget["controller"],
    spellStackKind: PendingTarget["spellStackKind"]
): string {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const labels = types
        .map((t) =>
            t === "spell" && spellStackKind && STACK_KIND_LABEL[spellStackKind]
                ? STACK_KIND_LABEL[spellStackKind]
                : (TARGET_LABEL[t] ?? t.toLowerCase())
        )
        .filter(Boolean);
    let head: string;
    if (labels.length === 0) head = "a target";
    else if (labels.length === 1) head = labels[0];
    else
        head =
            labels.slice(0, -1).join(", ") + " or " + labels[labels.length - 1];
    if (zone === "graveyard") {
        const owner =
            controller === "you"
                ? "your graveyard"
                : controller === "opponent"
                  ? "your opponent's graveyard"
                  : "a graveyard";
        return `${head} from ${owner}`;
    }
    return head;
}

export function describeTargetProgress(
    count: PendingTarget["count"],
    selected: number,
    label: string
): { hint: string; minReached: boolean; maxReached: boolean } {
    if (typeof count === "number") {
        const remaining = count - selected;
        return {
            hint:
                remaining > 1
                    ? `select ${remaining} targets`
                    : `select ${label}`,
            minReached: selected >= count,
            maxReached: selected >= count,
        };
    }
    const minReached = selected >= count.min;
    const maxReached = count.max !== undefined && selected >= count.max;
    const boundsLabel =
        count.max !== undefined ? `up to ${count.max}` : "any number of";
    const hint = minReached
        ? `add more targets or press Done (${selected} selected)`
        : `select ${boundsLabel} ${label} (min ${count.min})`;
    return { hint, minReached, maxReached };
}
