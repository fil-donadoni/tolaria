import { getAllRawCards } from "./convex/cards/catalogue";
import { compiledTwin } from "./convex/oracle/gold";
const want = process.argv.slice(2);
for (const card of getAllRawCards())
    if (want.includes(card.name)) {
        const twin = compiledTwin(card) as any;
        const pick = (d: any) =>
            JSON.stringify(
                d?.effects ??
                    d?.activatedAbilities?.map((a: any) => ({
                        cost: a.cost,
                        effects: a.effects,
                    })) ??
                    d?.triggeredAbilities ??
                    d?.compiledTriggeredAbilities
            );
        console.log(
            "==",
            card.name,
            "\n H:",
            pick(card),
            "\n C:",
            twin.ok === false
                ? JSON.stringify(twin)
                : pick(twin.definition ?? twin.compiled ?? twin)
        );
    }
