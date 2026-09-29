import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Puts a ready-to-paste Claude Code brief on the clipboard (ADR 0141 § 9,
 * issue #4178). The text is computed by the caller from the pure payload
 * functions (`@/lib/ai/bot-finding-payload`); this button only writes it and
 * says whether it did — a clipboard the browser refused is reported, not
 * swallowed.
 */
export default function BotFindingCopyButton({
    text,
    label,
}: {
    text: () => string;
    label: string;
}) {
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
    return (
        <Button
            type="button"
            variant="secondary"
            size="sm"
            data-bot-finding-copy=""
            aria-label={label}
            onClick={() => {
                navigator.clipboard.writeText(text()).then(
                    () => setState("copied"),
                    () => setState("failed")
                );
            }}
        >
            {state === "copied"
                ? "Copied"
                : state === "failed"
                  ? "Copy failed"
                  : "Copy brief"}
        </Button>
    );
}
