import {
    capitalizeKeyword,
    type AbilityDisplayState,
    type DisplayAbilities,
} from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";

const KEYWORD_STATE_CLASS: Record<AbilityDisplayState, string> = {
    native: "text-text",
    granted: "text-emerald-400",
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
        <div className={KEYWORD_STATE_CLASS[state]}>
            {prefix}
            {capitalizeKeyword(name)}
        </div>
    );
}

function AbilityRow({
    text,
    state,
}: {
    text: string;
    state: "native" | "granted";
}) {
    const cls = state === "granted" ? "text-emerald-400" : "text-text";
    const prefix = state === "granted" ? "[+] " : "";
    return (
        <div className={cls}>
            {prefix}
            {formatOracleText(text)}
        </div>
    );
}

/**
 * The structured-abilities block of the card preview: keyword rows
 * (native / granted / lost), then activated and triggered ability text.
 * Granted entries (runtime grants from auras/effects, CR 113.1) render in
 * green with a `[+]` prefix; lost keywords render struck-through.
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
            {abilities.activated.map((a, i) => (
                <AbilityRow
                    key={`act-${i}-${a.id}`}
                    text={a.oracleText}
                    state={a.state}
                />
            ))}
            {abilities.triggered.map((t, i) => (
                <AbilityRow
                    key={`tr-${i}-${t.id}`}
                    text={t.oracleText}
                    state={t.state}
                />
            ))}
        </div>
    );
}
