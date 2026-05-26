import { useState } from "react";

const LOBBY_IMAGES = [
    "/img/lobby-bg/01.webp",
    "/img/lobby-bg/02.webp",
    "/img/lobby-bg/03.webp",
    "/img/lobby-bg/04.webp",
    "/img/lobby-bg/05.webp",
    "/img/lobby-bg/06.webp",
    "/img/lobby-bg/07.webp",
    "/img/lobby-bg/08.webp",
];

function pickRandom() {
    return LOBBY_IMAGES[Math.floor(Math.random() * LOBBY_IMAGES.length)];
}

export default function LobbyBackground() {
    const [src] = useState(pickRandom);

    return (
        <img
            src={src}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.1] mix-blend-luminosity select-none"
        />
    );
}
