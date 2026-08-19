import type { ReactNode } from "react";
import { Panel } from "~/components/ui/panel";

/** Page frame for the Limited Event detail surface. `Panel size="wide"` only
 *  CAPS the width (`max-w-[90vw]`) — with no centring wrapper the panel sat
 *  flush against the left edge of the viewport, unlike every other Limited
 *  page (the events lobby centres its own `mx-auto max-w-3xl` container). This
 *  wrapper supplies the missing centring + page gutter in one place, so both
 *  render branches of the detail page (the live event and the
 *  "event no longer exists" fallback) stay aligned with each other.
 *
 *  It used to take a `dropOrnamentOnCompact` prop that hid the Panel frame on
 *  a compact viewport during a draft. That knob existed to reclaim the 40px of
 *  corner filigree (#2515) — real vertical space on a phone. Panel v3
 *  (#2581, ADR 0101 §2) replaced the filigree with 10px inset brackets drawn
 *  in an absolutely-positioned `pointer-events-none` overlay, which costs no
 *  layout space at any viewport. Hiding it reclaimed nothing, so the prop and
 *  its caller condition were removed rather than left as a knob whose comment
 *  no longer described what it did. */
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
