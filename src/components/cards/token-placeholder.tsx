// In-app placeholder rendered for tokens (CR 111, 707.1) that have no
// printed Scryfall art available. Mirrors the rough proportions of a real
// MTG card so layout is consistent with the surrounding battlefield, while
// surfacing the only information the player actually needs: name, type
// line, abilities, and P/T.

type TokenPlaceholderProps = {
    name: string;
    types: ReadonlyArray<string>;
    subtypes?: ReadonlyArray<string>;
    power?: number;
    toughness?: number;
    staticAbilities?: ReadonlyArray<string>;
};

function formatTypeLine(
    types: ReadonlyArray<string>,
    subtypes: ReadonlyArray<string>
): string {
    const head = types.join(" ");
    if (subtypes.length === 0) return head;
    return `${head} — ${subtypes.join(" ")}`;
}

function formatAbility(keyword: string): string {
    // Capitalize and strip our internal `cant-be-blocked-…` prefixes so the
    // text looks like a printed Oracle line rather than an engine token.
    return keyword
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

export default function TokenPlaceholder({
    name,
    types,
    subtypes = [],
    power,
    toughness,
    staticAbilities = [],
}: TokenPlaceholderProps) {
    const isCreature = types.includes("Creature");
    const ptVisible =
        isCreature && power !== undefined && toughness !== undefined;
    return (
        <div className="relative w-full h-full bg-stone-200 text-stone-900 rounded-sm border border-stone-700 flex flex-col">
            <div className="px-1.5 py-1 border-b border-stone-500/60 bg-stone-300 text-[0.55em] font-semibold leading-tight">
                {name}
            </div>
            <div className="px-1.5 py-0.5 border-b border-stone-500/40 bg-stone-300/60 text-[0.45em] italic leading-tight">
                Token — {formatTypeLine(types, subtypes)}
            </div>
            <div className="flex-1 px-1.5 py-1 text-[0.5em] leading-tight overflow-hidden">
                {staticAbilities.length > 0 ? (
                    staticAbilities.map((a) => (
                        <div key={a}>{formatAbility(a)}</div>
                    ))
                ) : (
                    <span className="opacity-50">—</span>
                )}
            </div>
            {ptVisible && (
                <div className="absolute bottom-1 right-1.5 px-1.5 py-0.5 bg-stone-100 border border-stone-700 rounded-sm text-[0.55em] font-bold leading-none">
                    {power}/{toughness}
                </div>
            )}
        </div>
    );
}
