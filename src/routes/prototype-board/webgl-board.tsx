/**
 * PROTOTYPE — WebGL board via Pixi v8. Sprites textured from Scryfall, tween
 * via ticker, MANUAL hit-testing + MANUAL text. Throwaway — delete after
 * decision. The verbosity here vs dom-board.tsx is itself a finding.
 */

import { useEffect, useRef } from "react";
import {
    Application,
    Assets,
    Container,
    Graphics,
    Sprite,
    Text,
    type FederatedPointerEvent,
} from "pixi.js";
import type { ProtoCard } from "./cards";
import { SCRYFALL_NORMAL } from "./cards";
import { CARD_H, CARD_W, fanLayout, rowLayout, type Placed } from "./layout";
import type { ZonedCard } from "./dom-board";

type Node = {
    container: Container;
    target: Placed;
    cur: Placed;
    dragging: boolean;
};

export default function WebglBoard({ cards }: { cards: ZonedCard[] }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<Application | null>(null);
    const nodesRef = useRef<Map<string, Node>>(new Map());
    const cardsRef = useRef<ZonedCard[]>(cards);
    cardsRef.current = cards;

    // Init once.
    useEffect(() => {
        let disposed = false;
        let inited = false;
        const app = new Application();
        const host = hostRef.current!;
        (async () => {
            await app.init({
                resizeTo: host,
                backgroundAlpha: 0,
                antialias: true,
                resolution: window.devicePixelRatio || 1,
                autoDensity: true,
            });
            inited = true;
            // StrictMode may unmount before init resolves — destroy here once
            // the app is actually initialized (destroying earlier throws
            // because the resize plugin isn't wired up yet).
            if (disposed) {
                app.destroy(true, { children: true });
                return;
            }
            host.appendChild(app.canvas);
            appRef.current = app;

            app.ticker.add(() => {
                const { width, height } = app.renderer;
                const w = width / app.renderer.resolution;
                const h = height / app.renderer.resolution;
                layout(nodesRef.current, cardsRef.current, w, h);
                for (const node of nodesRef.current.values()) {
                    if (node.dragging) continue;
                    const c = node.cur;
                    const t = node.target;
                    c.x += (t.x - c.x) * 0.22;
                    c.y += (t.y - c.y) * 0.22;
                    c.rot += (t.rot - c.rot) * 0.22;
                    c.scale += (t.scale - c.scale) * 0.22;
                    node.container.position.set(c.x, c.y);
                    node.container.rotation = (c.rot * Math.PI) / 180;
                    node.container.scale.set(c.scale);
                }
            });
            reconcile();
        })();
        return () => {
            disposed = true;
            appRef.current = null;
            if (inited) app.destroy(true, { children: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reconcile sprites whenever the card set changes.
    useEffect(() => {
        if (appRef.current) reconcile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cards]);

    function reconcile() {
        const app = appRef.current;
        if (!app) return;
        const nodes = nodesRef.current;
        const wanted = new Set(cards.map((c) => c.instanceId));
        for (const [id, node] of nodes) {
            if (!wanted.has(id)) {
                app.stage.removeChild(node.container);
                node.container.destroy({ children: true });
                nodes.delete(id);
            }
        }
        for (const c of cards) {
            if (nodes.has(c.instanceId)) continue;
            const node = makeNode(c);
            nodes.set(c.instanceId, node);
            app.stage.addChild(node.container);
        }
    }

    function makeNode(card: ProtoCard): Node {
        const container = new Container();
        container.pivot.set(CARD_W / 2, CARD_H / 2);
        container.eventMode = "static";
        container.cursor = "grab";

        // Placeholder background until the texture loads.
        const bg = new Graphics()
            .roundRect(0, 0, CARD_W, CARD_H, 6)
            .fill(0x222230);
        container.addChild(bg);

        const sprite = new Sprite();
        sprite.width = CARD_W;
        sprite.height = CARD_H;
        const mask = new Graphics()
            .roundRect(0, 0, CARD_W, CARD_H, 6)
            .fill(0xffffff);
        sprite.mask = mask;
        container.addChild(sprite, mask);

        Assets.load(SCRYFALL_NORMAL(card.cardId))
            .then((tex) => {
                if (!sprite.destroyed) sprite.texture = tex;
            })
            .catch(() => {});

        // P/T — manual rasterized text, must pick a resolution, no reflow/select.
        const ptBox = new Graphics()
            .roundRect(CARD_W - 38, CARD_H - 22, 32, 16, 3)
            .fill({ color: 0x000000, alpha: 0.8 });
        const pt = new Text({
            text: `${card.power}/${card.toughness}`,
            style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
        });
        pt.resolution = window.devicePixelRatio || 1;
        pt.position.set(CARD_W - 34, CARD_H - 20);
        container.addChild(ptBox, pt);

        const node: Node = {
            container,
            target: { x: 0, y: 0, rot: 0, scale: 1 },
            cur: { x: 0, y: -200, rot: 0, scale: 1 },
            dragging: false,
        };

        // Manual drag — no native DnD, every step hand-wired.
        let off = { x: 0, y: 0 };
        const onMove = (e: FederatedPointerEvent) => {
            const pos = e.global;
            node.cur.x = pos.x - off.x;
            node.cur.y = pos.y - off.y;
            container.position.set(node.cur.x, node.cur.y);
        };
        container.on("pointerdown", (e: FederatedPointerEvent) => {
            node.dragging = true;
            container.zIndex = 1000;
            if (container.parent) container.parent.sortableChildren = true;
            off = { x: e.global.x - container.x, y: e.global.y - container.y };
            appRef.current?.stage.on("pointermove", onMove);
        });
        const endDrag = () => {
            if (!node.dragging) return;
            node.dragging = false;
            container.zIndex = 0;
            appRef.current?.stage.off("pointermove", onMove);
        };
        container.on("pointerup", endDrag);
        container.on("pointerupoutside", endDrag);
        // Hover scale — also manual.
        container.on("pointerover", () => {
            if (!node.dragging) node.target.scale = 1.18;
        });
        container.on("pointerout", () => {
            if (!node.dragging) node.target.scale = 1;
        });

        return node;
    }

    return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}

function layout(
    nodes: Map<string, Node>,
    cards: ZonedCard[],
    w: number,
    h: number
) {
    const bf = cards.filter((c) => c.zone === "battlefield");
    const hand = cards.filter((c) => c.zone === "hand");
    const bfPos = rowLayout(bf.length, w, CARD_W, h * 0.34);
    const handPos = fanLayout(hand.length, w, CARD_W, h * 0.72, CARD_H);
    bf.forEach((c, i) => {
        const n = nodes.get(c.instanceId);
        if (n && !n.dragging)
            n.target = {
                ...bfPos[i],
                scale: n.target.scale > 1 ? n.target.scale : bfPos[i].scale,
            };
    });
    hand.forEach((c, i) => {
        const n = nodes.get(c.instanceId);
        if (n && !n.dragging)
            n.target = {
                ...handPos[i],
                scale: n.target.scale > 1 ? n.target.scale : 1,
            };
    });
}
