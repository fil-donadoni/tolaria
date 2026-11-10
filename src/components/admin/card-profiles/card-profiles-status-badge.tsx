import { Badge } from "~/components/ui/badge";
import { STATUS_LABEL, type ProfileStatus } from "./card-profiles-model";

const VARIANT = {
    unprofiled: "outline",
    unreviewed: "destructive",
    reviewed: "secondary",
} as const;

/** "Unreviewed" is the review pass's call to action: an LLM-seeded row
 *  contributes at half the contextual cap until a human confirms it (ADR
 *  0072), so it reads as the loud state. */
export default function CardProfilesStatusBadge({
    status,
}: {
    status: ProfileStatus;
}) {
    return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
