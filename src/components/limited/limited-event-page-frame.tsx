import type { ReactNode } from "react";
import { Panel } from "~/components/ui/panel";

/** Page frame for the Limited Event detail surface. `Panel size="wide"` only
 *  CAPS the width (`max-w-[90vw]`) — with no centring wrapper the panel sat
 *  flush against the left edge of the viewport, unlike every other Limited
 *  page (the events lobby centres its own `mx-auto max-w-3xl` container). This
 *  wrapper supplies the missing centring + page gutter in one place, so both
 *  render branches of the detail page (the live event and the
 *  "event no longer exists" fallback) stay aligned with each other. */
export default function LimitedEventPageFrame({
    children,
}: {
    children: ReactNode;
}) {
    return (
        <div className="flex w-full justify-center px-6 py-8">
            <Panel size="wide" className="w-full">
                {children}
            </Panel>
        </div>
    );
}
