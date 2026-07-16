// PROTOTYPE — throwaway. Mock hosts + attachment clusters for the
// attached-cards prototype (`/prototype/attachments`). Answers: how should a
// battlefield permanent surface MULTIPLE attached satellites — auras stacked on
// one creature, or creatures held in exile by one permanent (Parallax Wave) —
// so all of them are visible/reachable instead of only the topmost?
//
// Delete this whole `src/components/prototype/` directory once a variant wins.
import { getCardByName } from "@convex/cards";
import type { CardInstance } from "~/types/game";

export type AttachmentKind = "aura" | "exile";

export type MockAttachment = {
    card: CardInstance;
    kind: AttachmentKind;
};

export type MockHost = {
    /** Human label shown above the host in the prototype gallery. */
    label: string;
    host: CardInstance;
    attachments: MockAttachment[];
};

const P1 = "proto-p1";

let seq = 0;
function instance(
    name: string,
    extra: Partial<CardInstance> = {}
): CardInstance {
    const def = getCardByName(name);
    seq += 1;
    return {
        id: `proto-${seq}`,
        card: { id: def.id },
        controllerId: P1,
        ownerId: P1,
        zone: "battlefield",
        isTapped: false,
        ...extra,
    };
}

function aura(name: string, hostId: string): MockAttachment {
    return {
        kind: "aura",
        card: instance(name, { zone: "battlefield", attachedTo: hostId }),
    };
}

function exiled(name: string, hostId: string): MockAttachment {
    return {
        kind: "exile",
        card: instance(name, { zone: "exile", exiledByPermanentId: hostId }),
    };
}

/** Build one host + its cluster. `host` is created first so satellites can link
 *  to its id. */
function makeHost(
    label: string,
    hostName: string,
    build: (hostId: string) => MockAttachment[]
): MockHost {
    const host = instance(hostName);
    return { label, host, attachments: build(host.id) };
}

export const MOCK_HOSTS: MockHost[] = [
    // The Parallax Wave case the user reported: one permanent holds several
    // exiled creatures; today only the last-painted one is visible.
    makeHost("Parallax Wave — 3 exiled", "Parallax Wave", (id) => [
        exiled("Grizzly Bears", id),
        exiled("Air Elemental", id),
        exiled("Mons's Goblin Raiders", id),
    ]),
    // Multi-aura on one creature — today they cascade diagonally and overlap.
    makeHost("Serra Angel — 3 auras", "Serra Angel", (id) => [
        aura("Holy Strength", id),
        aura("Flight", id),
        aura("Regeneration", id),
    ]),
    // Stress: enough satellites to force the collapsed/pile behaviour.
    makeHost("Serra Angel — 5 auras", "Serra Angel", (id) => [
        aura("Holy Strength", id),
        aura("Unholy Strength", id),
        aura("Flight", id),
        aura("Firebreathing", id),
        aura("Regeneration", id),
    ]),
    // Single attachment — the common case must still read cleanly.
    makeHost("Grizzly Bears — 1 aura", "Grizzly Bears", (id) => [
        aura("Holy Strength", id),
    ]),
];
