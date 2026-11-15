import { memo, useEffect, useId, useRef, useState } from "react";
import { BotEngine, type BotFrame } from "../vendor/bloub/engine";
import { PROFILE_SAMPLES } from "../vendor/bloub/profiles";
import { NOTIF_BLUE } from "../vendor/bloub/decor";
import { DEMI_VIEWBOX as VB, RAYON as R } from "../vendor/bloub/repere";
import { mixHex } from "../vendor/bloub/skins";
import {
  EXPRESSION_BY_ID,
  type ExpressionId,
} from "../vendor/bloub/expressions";
import { STATE_BY_ID, type StateId } from "../vendor/bloub/states";

// A soft, asymmetric three-leaf silhouette, using Bloub's native radial morphs.
const COSIGN_SHAPE = Array.from({ length: PROFILE_SAMPLES }, (_, i) => {
  const angle = (i / PROFILE_SAMPLES) * Math.PI * 2;
  return (
    0.89 +
    0.17 * Math.cos(3 * angle + Math.PI / 2) +
    0.055 * Math.sin(angle - 0.5)
  );
});

// React renderer adapted from jeremy-prt/bloub's BloubBot.vue (MIT).
// Keep the upstream geometry, timing, mask and front/back orbit ordering intact.
export const BloubAvatar = memo(function BloubAvatar({
  state = "idle",
  paused = false,
  reducedMotion = false,
  expression = "neutre",
  paper = "#f3f6f2",
  signature = false,
}: {
  state?: StateId;
  paused?: boolean;
  reducedMotion?: boolean;
  expression?: ExpressionId;
  paper?: string;
  signature?: boolean;
}) {
  const [engine] = useState(() => {
    const bot = new BotEngine(R);
    if (signature) bot.setShape(COSIGN_SHAPE, 0);
    return bot;
  });
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(0));
  const svg = useRef<SVGSVGElement>(null);
  const clock = useRef(0);
  const currentState = useRef(state);
  const uid = `bloub-${useId().replace(/:/g, "")}`;
  const mask = `${uid}-mask`;
  const ink = "#121713";

  useEffect(() => {
    engine.setShape(signature ? COSIGN_SHAPE : null, clock.current);
    engine.setExpression(
      EXPRESSION_BY_ID.get(expression) ?? null,
      clock.current,
    );
    currentState.current = state;
    if (reducedMotion) {
      engine.reset("idle", 0);
      clock.current = 0;
      engine.setExpression(EXPRESSION_BY_ID.get(expression) ?? null, 0);
      setFrame(engine.sample(1));
    } else {
      engine.setState(state, clock.current);
      if (paused) setFrame(engine.sample(clock.current + 1));
    }
  }, [engine, state, paused, reducedMotion, expression, signature]);

  useEffect(() => {
    if (paused || reducedMotion) return;
    let raf = 0;
    let last = 0;
    let inView = true;
    let pointer: { x: number; y: number } | null = null;
    let aiming = false;
    let previousAim = "";
    const restLook = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 0.15 };
    engine.setLook(restLook, clock.current);
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "touch")
        pointer = { x: event.clientX, y: event.clientY };
    };
    const release = () => {
      pointer = null;
    };
    function tick(now: number) {
      if (!inView || document.hidden) {
        last = 0;
        raf = 0;
        return;
      }
      clock.current += last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      const t = clock.current;
      if (pointer && STATE_BY_ID.get(currentState.current)?.baseFace) {
        const rect = svg.current?.getBoundingClientRect();
        if (rect?.width && rect.height) {
          const x = Math.max(
            -1,
            Math.min(
              1,
              (pointer.x - rect.x - rect.width / 2) /
                Math.max(1, innerWidth / 2),
            ),
          );
          const y = Math.max(
            -1,
            Math.min(
              1,
              (pointer.y - rect.y - rect.height / 2) /
                Math.max(1, innerHeight / 2),
            ),
          );
          const aim = `${x.toFixed(3)}:${y.toFixed(3)}`;
          if (aim !== previousAim || !aiming) {
            engine.setLook(
              { yaw: x * 9, pitch: 8 - y * 6, mix: 0.65, spin: 0, wander: 0 },
              t,
              0.32,
            );
            previousAim = aim;
            aiming = true;
          }
        }
      } else if (aiming) {
        engine.setLook(restLook, t);
        aiming = false;
      }
      setFrame(engine.sample(t));
      raf = requestAnimationFrame(tick);
    }
    const resume = () => {
      if (!raf && inView && !document.hidden) raf = requestAnimationFrame(tick);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            resume();
          });
    if (svg.current) observer?.observe(svg.current);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("pointerleave", release);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerleave", release);
      document.removeEventListener("visibilitychange", resume);
      engine.setLook(null, clock.current);
    };
  }, [engine, paused, reducedMotion]);

  const dots = frame.dots.map((dot, i) => {
    const fill =
      dot.color ??
      (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
    return dot.d ? (
      <path
        key={i}
        d={dot.d}
        transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
        fill={fill}
        opacity={dot.opacity}
      />
    ) : (
      <circle
        key={i}
        cx={dot.x}
        cy={dot.y}
        r={dot.r}
        fill={fill}
        opacity={dot.opacity}
      />
    );
  });
  return (
    <svg
      ref={svg}
      className="bloub-avatar"
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      aria-hidden="true"
      data-state={reducedMotion ? "idle" : state}
    >
      <defs>
        <mask
          id={mask}
          maskUnits="userSpaceOnUse"
          x={-VB}
          y={-VB}
          width={VB * 2}
          height={VB * 2}
        >
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path
              key={i}
              d={eye.d}
              transform={eye.matrix}
              opacity={eye.alpha}
              fill="#000"
            />
          ))}
          {frame.notch && (
            <circle
              cx={frame.notch.x}
              cy={frame.notch.y}
              r={frame.notch.r}
              fill="#000"
            />
          )}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((color, i) => (
              <stop
                key={i}
                offset={i / (arc.grad.stops.length - 1)}
                stopColor={color}
              />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={arc.id}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
      {frame.dotsBehind && <g>{dots}</g>}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${mask})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>
      {!frame.dotsBehind && <g>{dots}</g>}
      {frame.notif && (
        <circle
          cx={frame.notif.x}
          cy={frame.notif.y}
          r={frame.notif.r}
          fill={NOTIF_BLUE}
        />
      )}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={arc.id}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  );
});
