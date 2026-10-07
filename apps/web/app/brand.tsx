export const LIONETTA_LOGO_SRC = "/brand/lionetta-logo.png";
export const LIONETTA_HERO_SRC = "/brand/lionetta-hero-avatar.png";
export const LIONETTA_ASSISTANT_SRC = "/brand/lionetta-happy-talking.gif";

type IconName = "arrow" | "spark" | "inventory" | "pricing" | "crm" | "shield" | "layers" | "car" | "home";

const paths: Record<IconName, string> = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  inventory: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5",
  pricing: "M3 4h9l9 9-8 8-9-9V4Zm5 4h.01",
  crm: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  car: "m3 12 2-6h14l2 6M3 12h18v7h-3v-3H6v3H3v-7Zm3 1h2m8 0h2",
  home: "m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7",
};

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function LionMark({ className = "" }: { className?: string }) {
  return <img className={`lion-mark ${className}`} src={LIONETTA_LOGO_SRC} width="64" height="64" alt="" />;
}

export function AssistantPortrait() {
  return <picture className="assistant-portrait-frame">
    <source media="(prefers-reduced-motion: reduce)" srcSet={LIONETTA_HERO_SRC} />
    <img className="assistant-portrait" src={LIONETTA_ASSISTANT_SRC} width="64" height="64" alt="" />
  </picture>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand${compact ? " brand-compact" : ""}`}><LionMark /><span className="brand-type"><strong>Lionetta</strong>{!compact && <small>Intelligence connects everything</small>}</span></span>;
}
