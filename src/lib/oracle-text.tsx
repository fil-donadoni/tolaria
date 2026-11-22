import { Children, Fragment, type ReactNode } from "react";
import {
    BRACE_TOKEN_RE,
    hasSymbolToken,
    symbolName,
    symbolSrc,
} from "./symbol-names";

/** Pushes a raw text slice into `parts`, converting any `\n` into a `<br/>`
 *  so multi-line oracle text (e.g. dual-mode mana abilities) keeps its line
 *  breaks instead of collapsing under the default `white-space: normal`. */
function pushTextWithBreaks(
    parts: ReactNode[],
    text: string,
    keyPrefix: string
): void {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) parts.push(<br key={`${keyPrefix}-br-${i}`} />);
        if (lines[i]) parts.push(lines[i]);
    }
}

/** Formats an MTG oracle text by replacing each MAPPABLE `{…}` token (mana,
 *  tap, energy… — a row in `SYMBOL_NAMES`, issue #9834) with an inline `<img>`
 *  pointing to /img/symbols/<token>.svg. The image's `alt` is the symbol's
 *  spoken name ("{R}" → "red mana"), so a symbol-only row still has an
 *  accessible name; `data-symbol` keeps the token as written. An unmappable
 *  `{…}` stays text. Images render inline with vertical-align middle so they
 *  sit centered on the text line and wrap with the words. Embedded `\n`
 *  newlines become `<br/>` so multi-clause text stays multi-line. */
export function formatOracleText(text: string): ReactNode[] {
    if (!text) return [];
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    for (const match of text.matchAll(BRACE_TOKEN_RE)) {
        const token = match[1];
        const name = symbolName(token);
        if (name === undefined) continue;
        const index = match.index ?? 0;
        // Two adjacent symbols ("{2}{R}") would otherwise fuse their names in
        // the accessible-name computation ("2 generic manared mana"): images
        // are inline, so no separator is inserted between them.
        const follows = parts.length > 0 && index === lastIndex;
        if (index > lastIndex) {
            pushTextWithBreaks(
                parts,
                text.slice(lastIndex, index),
                `txt-${key}`
            );
        }
        parts.push(
            <img
                key={`sym-${key++}`}
                src={symbolSrc(token)}
                alt={follows ? ` ${name}` : name}
                data-symbol={`{${token}}`}
                className="inline h-[1em] w-[1em] align-[-0.15em] mx-[1px]"
            />
        );
        lastIndex = index + match[0].length;
    }
    if (lastIndex < text.length) {
        pushTextWithBreaks(parts, text.slice(lastIndex), `txt-end`);
    }
    return parts;
}

/**
 * The primitives' hook into the parser (issue #9834): string content — a bare
 * string, or the strings among an array of children — renders through
 * `formatOracleText`; every other node passes through untouched. Content with
 * no mappable token is returned AS IS, so a primitive whose label carries no
 * symbol renders exactly what it rendered before.
 */
export function withSymbols(node: ReactNode): ReactNode {
    if (typeof node === "string") {
        return hasSymbolToken(node) ? formatOracleText(node) : node;
    }
    if (!Array.isArray(node)) return node;
    if (!node.some((n) => typeof n === "string" && hasSymbolToken(n))) {
        return node;
    }
    return Children.toArray(node).map((child, i) =>
        typeof child === "string" ? (
            <Fragment key={`sym-text-${i}`}>{formatOracleText(child)}</Fragment>
        ) : (
            child
        )
    );
}
