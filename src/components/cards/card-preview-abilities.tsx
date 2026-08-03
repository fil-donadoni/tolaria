import {
    capitalizeKeyword,
    type AbilityDisplayState,
    type DisplayAbilities,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";

const ABILITY_STATE_CLASS: Record<AbilityDisplayState, string> = {
    native: "text-text",
    granted: "text-success-strong",
    lost: "text-text-muted line-through opacity-70",
};

function KeywordRow({
    name,
    state,
}: {
    name: string;
    state: AbilityDisplayState;
}) {
    const prefix = state === "granted" ? "[+] " : "";
    return (
        <div className={ABILITY_STATE_CLASS[state]}>
            {prefix}
            {/* Parametrized keywords carry mana in their name ("ward {1}",
                "protection from {R}"), so the row goes through the oracle-text
                formatter to render the mana symbol instead of a literal
                "{1}". */}
            {formatOracleText(capitalizeKeyword(name))}
        </div>
    );
}

/** An activated / triggered ability line. `lost` uses the SAME struck-through
 *  treatment as a lost keyword (CR 613.1f — a Blood Moon'd land, a permanent
 *  under Humility): the text stays readable so the player can see WHAT was
 *  removed, which a hidden row cannot convey. */
function AbilityRow({
    text,
    state,
}: {
    text: string;
    state: AbilityDisplayState;
}) {
    const prefix = state === "granted" ? "[+] " : "";
    return (
        <div className={ABILITY_STATE_CLASS[state]}>
            {prefix}
            {formatOracleText(text)}
        </div>
    );
}

type Row = {
    key: string;
    text: string;
    state: AbilityDisplayState;
    order: number;
};

/** Merges activated + triggered rows into printed-line order (`order`, the
 *  ability's paragraph index in the card's own `oracleText` — see
 *  `DisplayActivated.order`). A row with no match (a runtime grant, or a
 *  legacy fixture with no `order` at all) falls into the same "sorts last"
 *  bucket, and `Array#sort` is stable, so ties keep the activated-then-
 *  triggered order this component always rendered before this ordering
 *  existed. Fixes the fixed-block order always printing activated ABOVE
 *  triggered even when a card's own oracle text lists the trigger first
 *  (Skyship Weatherlight: the ETB search trigger prints before the {4},{T}
 *  activated ability). */
function orderedAbilityRows(abilities: DisplayAbilities): Row[] {
    const rows: Row[] = [
        ...abilities.activated.map((a, i) => ({
            key: `act-${i}-${a.id}`,
            text: a.oracleText,
            state: a.state,
            order: a.order ?? Number.MAX_SAFE_INTEGER,
        })),
        ...abilities.triggered.map((t, i) => ({
            key: `tr-${i}-${t.id}`,
            text: t.oracleText,
            state: t.state,
            order: t.order ?? Number.MAX_SAFE_INTEGER,
        })),
    ];
    return rows.sort((a, b) => a.order - b.order);
}

/**
 * The structured-abilities block of the card preview: keyword rows
 * (native / granted / lost), then activated and triggered ability text in
 * the card's own printed line order. Granted entries (runtime grants from
 * auras/effects, CR 113.1) render in green with a `[+]` prefix; lost
 * keywords render struck-through.
 *
 * The caller decides WHICH abilities to pass: the full set when no printed
 * oracle text is shown, or only the runtime deltas (granted/lost) when oracle
 * text already covers the native printed abilities — so runtime-granted
 * keywords like landwalk stay visible without double-printing the rest (#156).
 */
export default function CardPreviewAbilities({
    abilities,
}: {
    abilities: DisplayAbilities;
}) {
    return (
        <div className="border-t border-border-subtle pt-2 space-y-1.5">
            {abilities.keywords.length > 0 && (
                <div className="space-y-0.5">
                    {abilities.keywords.map((k, i) => (
                        <KeywordRow
                            key={`kw-${i}-${k.name}`}
                            name={k.name}
                            state={k.state}
                        />
                    ))}
                </div>
            )}
            {orderedAbilityRows(abilities).map((row) => (
                <AbilityRow key={row.key} text={row.text} state={row.state} />
            ))}
        </div>
    );
}
