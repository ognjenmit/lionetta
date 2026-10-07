"use client";

import { useState } from "react";
import Image from "next/image";
import { LIONETTA_ASSISTANT_SRC, LIONETTA_HERO_SRC } from "./brand";

export function HeroAvatar() {
  const [hovered, setHovered] = useState(false);

  return <picture>
    <source media="(prefers-reduced-motion: reduce)" srcSet={LIONETTA_HERO_SRC} />
    <Image className="hero-lioness" src={hovered ? LIONETTA_ASSISTANT_SRC : LIONETTA_HERO_SRC} unoptimized={hovered} alt="Lionetta’s angular neon-lime and purple lioness avatar" width={720} height={720} sizes="(max-width: 700px) 100vw, 50vw" loading="eager" fetchPriority="high" onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }} onPointerLeave={() => setHovered(false)} onPointerCancel={() => setHovered(false)} />
  </picture>;
}
