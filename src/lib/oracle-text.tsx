import type { ReactNode } from "react";

const SYMBOL_REGEX = /\{([^}]+)\}/g;

/** Converts a mana/symbol token (e.g. `U`, `2/W`, `T`) to its SVG file name
 *  under /public/img/symbols. Hybrid symbols use `_` in place of `/`. */
function tokenToFileName(token: string): string {
    return token.toUpperCase().replace(/\//g, "_");
}

/** Formats an MTG oracle text by replacing `{X}` tokens (mana, tap, etc.)
 *  with inline `<img>` elements pointing to /img/symbols/<token>.svg.
 *  Images render inline in the text flow with vertical-align middle so
 *  they sit centered on the text line and wrap naturally with the words. */
export function formatOracleText(text: string): ReactNode[] {
    if (!text) return [];
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    SYMBOL_REGEX.lastIndex = 0;
    while ((match = SYMBOL_REGEX.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const token = match[1];
        parts.push(
            <img
                key={`sym-${key++}`}
                src={`/img/symbols/${tokenToFileName(token)}.svg`}
                alt={`{${token}}`}
                className="inline h-[1em] w-[1em] align-[-0.15em] mx-[1px]"
            />
        );
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return parts;
}
