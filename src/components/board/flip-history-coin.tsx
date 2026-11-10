import CoinMoonGlyph from "~/components/board/coin-moon-glyph";
import CoinSunGlyph from "~/components/board/coin-sun-glyph";

/** One entry of a Flip Sequence's history (CR 705.2): a mini-coin in the
 *  outcome's tone with its numbered caption ("1 · Win"). A `ghost` is a flip
 *  the series never made ("5 · not flipped"). */
export default function FlipHistoryCoin({
    face,
    tone,
    caption,
    ghost = false,
}: {
    face?: "heads" | "tails";
    tone?: "good" | "bad";
    caption: string;
    ghost?: boolean;
}) {
    const Glyph = face === "tails" ? CoinMoonGlyph : CoinSunGlyph;
    const toneClass = ghost
        ? "border-dashed border-border-subtle text-text-disabled"
        : tone === "good"
          ? "border-success-strong text-success-strong"
          : "border-danger text-danger";
    return (
        <li
            data-testid={ghost ? "flip-history-ghost" : "flip-history-item"}
            data-tone={ghost ? "ghost" : tone}
            className="flex flex-col items-center gap-1"
        >
            <span
                className={`flex size-8 items-center justify-center rounded-full border-2 ${toneClass}`}
            >
                {!ghost && <Glyph className="size-4" />}
            </span>
            <span
                className={`text-[10px] whitespace-nowrap ${
                    ghost ? "text-text-disabled" : "text-text-muted"
                }`}
            >
                {caption}
            </span>
        </li>
    );
}
