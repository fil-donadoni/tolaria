/* The ring half of this pair moved to `src/lib/card-ring.ts` in #2724
   (`COMBAT_GROUP_ROLE`): combat-group rings are now inset `.card-ring-combat-N`
   pseudo-elements like every other card ring, not outer Tailwind `ring-*`
   utilities. The four HUES are unchanged and still live in `src/index.css`. */

export const COMBAT_GROUP_BG = [
    "bg-combat-1",
    "bg-combat-2",
    "bg-combat-3",
    "bg-combat-4",
];
