// BIG — green card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import {
    ancientCornucopia,
    sandstormSalvager,
    vaultbornTyrant,
} from "../green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, registerTokenDefinition } from "../../../index";

// Throwaway vanilla creature fixture, power 4 — deliberately NOT a
// `vaultbornTyrant` instance: reusing the card's own id would give the
// fixture Vaultborn's OWN triggeredAbilities too (they share one
// CardDefinition), making it fire its own copy of the "yours"-scoped ETB
// ability on its own entry and double the stack — a fixture artifact, not
// the card's real behavior.
const BIG_CREATURE_ID = "test-big-green-power-4-creature";
registerTokenDefinition({
    id: BIG_CREATURE_ID,
    name: BIG_CREATURE_ID,
    rarity: "common",
    manaCost: { generic: 4 },
    types: ["Creature"],
    power: 4,
    toughness: 4,
});
const SMALL_CREATURE_ID = "test-big-green-power-2-creature";
registerTokenDefinition({
    id: SMALL_CREATURE_ID,
    name: SMALL_CREATURE_ID,
    rarity: "common",
    manaCost: { generic: 2 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

/** Push an activated ability onto the stack (cost assumed paid) and resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

// The auto-generated canned-scenario smoke sweep (`scenarioGenerator.ts`)
// categorically skips every `forEach`-bearing script ("covered by the card's
// own tests") — this ability's mass counter placement + trample grant needs
// its own hand-written test per gre-development.md's forEach carve-out. The
// ETB Golem-creation trigger has NO forEach and is already covered by the
// smoke sweep (a fixed-count, fixed-controller `createToken` — no hand test
// required for that half).
describe("Sandstorm Salvager (Cube FREE residue token-maker, issue #1304)", () => {
    it("mass-buffs creature tokens you control: +1/+1 counter + trample until end of turn (CR 122.6 / 611.2c), leaving non-tokens and opponent's tokens untouched", () => {
        const salvager = makeInstance(sandstormSalvager.id, {
            id: "salvager1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const myToken = makeInstance(sandstormSalvager.id, {
            id: "my-token",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const myNonToken = makeInstance(sandstormSalvager.id, {
            id: "my-real-creature",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const theirToken = makeInstance(sandstormSalvager.id, {
            id: "their-token",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [salvager, myToken, myNonToken],
                }),
                makePlayer("p2", { battlefield: [theirToken] }),
            ],
        });
        resolveActivated(state, salvager, "sandstorm-salvager-token-buff");

        const mine = state.players[0].battlefield;
        const myTokenAfter = mine.find((c) => c.id === "my-token")!;
        const myNonTokenAfter = mine.find((c) => c.id === "my-real-creature")!;
        const theirTokenAfter = state.players[1].battlefield.find(
            (c) => c.id === "their-token"
        )!;

        expect(myTokenAfter.counters?.["+1/+1"]).toBe(1);
        expect(myTokenAfter.staticAbilities).toContain("trample");
        expect(myNonTokenAfter.counters?.["+1/+1"]).toBeUndefined();
        expect(myNonTokenAfter.staticAbilities).not.toContain("trample");
        expect(theirTokenAfter.counters?.["+1/+1"]).toBeUndefined();
        expect(theirTokenAfter.staticAbilities).not.toContain("trample");

        // Wire format: the counter and the granted keyword both survive the
        // projection (CR 122.6 / 611.2c are board-visible effects).
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === "my-token"
        )!;
        expect(slimToken.counters?.["+1/+1"]).toBe(1);
        expect(slimToken.staticAbilities).toContain("trample");
    });
});

// Vaultborn Tyrant (issue #1531/#1525, unblocked by #2364's
// TokenSpec/EffectTokenSpec `triggeredAbilities` field). Both halves of the
// card exercise a NEW capability (the dies half needs a token carrying its
// own printed triggers, CR 707.2) so both get a hand-written test rather than
// relying on the generated smoke sweep.
describe("Vaultborn Tyrant (dies → artifact token copy w/ own triggers, CR 707.2, issue #2364)", () => {
    it("gains 3 life and draws a card when another creature you control with power 4+ enters", () => {
        const tyrant = makeInstance(vaultbornTyrant.id, {
            id: "vt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bigCreature = makeInstance(BIG_CREATURE_ID, {
            id: "big",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tyrant],
                    library: [
                        makeInstance(vaultbornTyrant.id, { id: "lib-1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        state.players[0].battlefield.push(bigCreature);
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "big",
                controllerId: "p1",
                types: ["Creature"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // 20 + 3
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("does not trigger for an entering creature under power 4", () => {
        const tyrant = makeInstance(vaultbornTyrant.id, {
            id: "vt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const smallCreature = makeInstance(SMALL_CREATURE_ID, {
            id: "small",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyrant] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].battlefield.push(smallCreature);
        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED",
                instanceId: "small",
                controllerId: "p1",
                types: ["Creature"],
            },
        ];
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(0);
    });

    it("dying as a nontoken creates an Artifact Dinosaur token copy carrying its own two triggered abilities", () => {
        const tyrant = makeInstance(vaultbornTyrant.id, {
            id: "vt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tyrant] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "vt", "graveyard", "destroy");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        // Type ORDER is not rules-relevant (CR 205.1a is a set, not a
        // sequence) — `applyCopy` appends `additionalTypes` after the
        // copied definition's own printed types, so this is `[Creature,
        // Artifact]`, not the oracle-text presentation order.
        expect(token!.types.slice().sort()).toEqual(
            ["Artifact", "Creature"].sort()
        );
        expect(token!.subtypes).toContain("Dinosaur");
        expect(token!.power).toBe(6);
        expect(token!.toughness).toBe(6);
        expect(token!.staticAbilities).toContain("trample");

        // CR 707.2 (issue #2426 review) — `createTokenCopyOf` id-swaps the
        // token onto Vaultborn Tyrant's OWN registered definition id (NOT a
        // synthesized `token:` id), which is exactly what gives the token
        // its art for free: `resolveCardImageId` (`src/lib/images.ts`) only
        // special-cases a `token:`-prefixed id, so a real printed id resolves
        // straight to the card's own Scryfall art with no token-print
        // lockfile entry needed.
        const tokenCardId = (token!.card as { id: string }).id;
        expect(tokenCardId).toBe(vaultbornTyrant.id);
        expect(tokenCardId.startsWith("token:")).toBe(false);

        const def = getDefinition(tokenCardId);
        expect(def.triggeredAbilities?.map((a) => a.id).sort()).toEqual(
            [
                "vaultborn-tyrant-dies-copy",
                "vaultborn-tyrant-etb-power-4",
            ].sort()
        );
        // Real, working closures — literally the SAME ability objects the
        // printed card carries (CR 707.2), not a JSON-encoded re-synthesis:
        // the id-swap means `getDefinition` on the token returns the actual
        // `vaultbornTyrant` definition.
        expect(def).toBe(getDefinition(vaultbornTyrant.id));

        // Wire format: the token's own triggered abilities survive
        // projectPublicState (card.card strips to `{ id }`; the definition
        // round-trips through the registry keyed by that id).
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === token!.id
        )!;
        const projectedDef = getDefinition(
            (slimToken.card as { id: string }).id
        );
        expect(projectedDef.triggeredAbilities).toHaveLength(2);
    });

    it("the token's own death does NOT create a further copy (its 'if it's not a token' self-check is now real)", () => {
        const tyrant = makeInstance(vaultbornTyrant.id, {
            id: "vt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tyrant],
                    library: [
                        makeInstance(vaultbornTyrant.id, { id: "lib-1" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "vt", "graveyard", "destroy");
        processPendingActionTriggers(state);
        resolveTopOfStack(state); // dies trigger resolves — creates the token
        // CR 707.2 / 603.6a — the token's OWN copy of the "yours"-scoped ETB
        // ability legitimately fires off its OWN entry too (a token being
        // created IS entering the battlefield): drain it before checking the
        // dies half, so the leftover stack item doesn't mask what we're
        // actually testing.
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;

        removePermanentTo(state, token.id, "graveyard", "destroy");
        processPendingActionTriggers(state);
        // The token's own dies trigger IS present (CR 707.2) but its
        // `condition: (_event, self) => !self.isToken` fails for the token
        // itself, so it never even reaches the stack — no second copy.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(false);
    });
});

// Ancient Cornucopia's life-gain amount reads the firing spell's live colour
// count, which no Effect Script value can read yet (`SPELL_CAST` has no
// `EVENT_FIELD_REGISTRY` row, #2066 open) — a genuine `resolve()` protocol
// card (gre-development.md § DSL-first authoring), so it earns a
// hand-written test per the project's testing convention (unlike the six
// other #2761 cards, five of which turned out to need one too once corrected
// — see the PR description).
describe("Ancient Cornucopia (may gain life = colours of a cast spell, once/turn; {T}: mana of any colour; CR 603.2h / 602.5b / 207)", () => {
    function setup(): { state: GameState; cornucopia: CardInstanceState } {
        const cornucopia = makeInstance(ancientCornucopia.id, {
            id: "cornucopia",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [cornucopia] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, cornucopia };
    }

    function castSpell(
        state: GameState,
        spellColors: string[],
        casterId = "p1"
    ): void {
        state.pendingEvents = [
            {
                type: "SPELL_CAST",
                casterId,
                spellInstanceId: `spell-${state.stack.length}`,
                spellCardId: sandstormSalvager.id,
                spellTypes: ["Sorcery"],
                spellSubtypes: [],
                spellColors,
            },
        ];
        processPendingActionTriggers(state);
    }

    it("accepting the may-gain: gains life equal to the spell's colour count", () => {
        const { state } = setup();
        castSpell(state, ["U", "B"]); // two colours
        expect(state.stack).toHaveLength(1);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].life).toBe(22); // 20 + 2
    });

    it("declining the may-gain: no life change", () => {
        const { state } = setup();
        castSpell(state, ["G"]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].life).toBe(20);
    });

    it('does not trigger for a COLORLESS spell (CR 202.2 — "a spell that\'s one or more colors")', () => {
        const { state } = setup();
        castSpell(state, []);
        expect(state.stack).toHaveLength(0);
    });

    it("does not trigger for a spell an OPPONENT casts (scope: you)", () => {
        const { state } = setup();
        castSpell(state, ["R"], "p2");
        expect(state.stack).toHaveLength(0);
    });

    // CR 603.2h "Do this only once each turn" — approximated as a per-turn
    // trigger cap (`maxTriggersPerTurn: 1`, a documented simplification, see
    // the definition's own comment and docs/findings/2761-ancient-cornucopia-
    // cr603-2h.md): a SECOND colored spell the same turn does not trigger the
    // ability again at all, regardless of whether the first's may-gain was
    // accepted.
    it("(regression) a second colored spell the same turn does not trigger again", () => {
        const { state } = setup();
        castSpell(state, ["U"]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].life).toBe(21);
        castSpell(state, ["W", "B", "G"]);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].life).toBe(21);
    });

    // The `{T}: Add one mana of any color` ability is the established
    // `manaChoices` any-colour shape (City of Brass, `arn/colorless.ts`) —
    // that card's own test suite covers only its OTHER (triggered) ability,
    // treating `useStack: false` + `manaChoices` mana production as
    // already-covered generic engine machinery, not a per-card test surface.
});
