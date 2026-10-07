"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { decompressFrames, parseGIF } from "gifuct-js";
import { LIONETTA_HERO_SRC } from "./brand";

const HOVER_IN_SRC = "/brand/lionetta-hover-in.gif";

export function HeroAvatar() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const context = useRef<CanvasRenderingContext2D | null>(null);
  const [ready, setReady] = useState(false);
  const playback = useRef({
    frames: [] as HTMLCanvasElement[],
    progress: 0,
    target: 0,
    duration: 700,
    lastTime: null as number | null,
    request: null as number | null,
  });

  function paint() {
    const { frames, progress } = playback.current;
    const ctx = context.current;
    if (!ctx || !frames.length) return;
    const position = progress * (frames.length - 1);
    const index = Math.floor(position);
    const mix = position - index;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1 - mix;
    ctx.drawImage(frames[index]!, 0, 0);
    if (mix > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = mix;
      ctx.drawImage(frames[index + 1]!, 0, 0);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function tick(time: number) {
    const player = playback.current;
    const elapsed = player.lastTime === null ? 0 : time - player.lastTime;
    player.lastTime = time;
    player.progress = Math.max(0, Math.min(1, player.progress + (player.target === 1 ? 1 : -1) * elapsed / player.duration));
    paint();
    if (player.progress !== player.target) player.request = requestAnimationFrame(tick);
    else {
      player.request = null;
      player.lastTime = null;
    }
  }

  function animateSmile(smile: boolean) {
    const player = playback.current;
    player.target = smile && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0;
    if (!player.frames.length || player.request !== null || player.progress === player.target) return;
    player.lastTime = null;
    player.request = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const controller = new AbortController();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reset = () => {
      const player = playback.current;
      if (player.request !== null) cancelAnimationFrame(player.request);
      player.request = null;
      player.lastTime = null;
      player.progress = player.target = 0;
      paint();
    };
    const resetMotion = () => { if (motion.matches) reset(); };
    motion.addEventListener("change", resetMotion);

    void (async () => {
      try {
        const response = await fetch(HOVER_IN_SRC, { signal: controller.signal });
        if (!response.ok) return;
        const gif = parseGIF(await response.arrayBuffer());
        const decoded = decompressFrames(gif, true);
        const ctx = canvas.current?.getContext("2d");
        if (controller.signal.aborted || !ctx || !decoded.length) return;
        // These supplied GIF frames restore to a transparent background between poses.
        playback.current.frames = decoded.map((frame) => {
          const image = document.createElement("canvas");
          image.width = gif.lsd.width;
          image.height = gif.lsd.height;
          image.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height), frame.dims.left, frame.dims.top);
          return image;
        });
        ctx.canvas.width = gif.lsd.width;
        ctx.canvas.height = gif.lsd.height;
        context.current = ctx;
        playback.current.duration = decoded.reduce((sum, frame) => sum + frame.delay, 0) || 700;
        paint();
        setReady(true);
        animateSmile(playback.current.target === 1);
      } catch {
        // Keep the static portrait if the local animation cannot load.
      }
    })();

    return () => {
      controller.abort();
      motion.removeEventListener("change", resetMotion);
      reset();
      playback.current.frames = [];
      context.current = null;
    };
  }, []);

  return <>
    <link rel="preload" as="fetch" href={HOVER_IN_SRC} crossOrigin="anonymous" />
    <div className="hero-lioness" data-ready={ready} role="img" aria-label="Lionetta’s neon-lime and purple lioness avatar" onPointerEnter={(event) => { if (event.pointerType !== "touch") animateSmile(true); }} onPointerLeave={() => animateSmile(false)} onPointerCancel={() => animateSmile(false)}>
      <Image className="hero-avatar-still" src={LIONETTA_HERO_SRC} alt="" aria-hidden="true" width={720} height={720} sizes="(max-width: 700px) 100vw, 50vw" loading="eager" fetchPriority="high" />
      <canvas ref={canvas} className="hero-avatar-animation" width="320" height="320" aria-hidden="true" />
    </div>
  </>;
}
