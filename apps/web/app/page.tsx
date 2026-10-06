"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import type { ChatResponse, Mode, PendingConfirmation, Tenant, TenantsResponse, ToolCall, Vehicle } from "../lib/contracts";
import { Brand, Icon, LionMark, LIONETTA_LOGO_SRC } from "./brand";

interface Message {
  id: string;
  role: "assistant" | "user";
  text: string;
  vehicles?: Vehicle[];
  toolCalls?: ToolCall[];
  pendingConfirmation?: PendingConfirmation;
  pending?: boolean;
  error?: boolean;
}

const examples = [
  { title: "Find my next BMW", detail: "Automatic · under €25,000", prompt: "I want a BMW 3 Series under €25,000, automatic and below 50,000 km." },
  { title: "Explore available cars", detail: "See this dealer’s inventory", prompt: "Show me available cars." },
  { title: "Try a CRM action", detail: "Review before creating a lead", prompt: "create lead: Alex | alex@example.com | bmw-320d-001" },
];

const currency = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-IE");
const vehicleImages: Record<string, string> = {
  "bmw-320d-001": "/vehicles/bmw-320d-001.png",
  "bmw-318i-002": "/vehicles/bmw-318i-002.png",
  "bmw-320i-003": "/vehicles/bmw-320i-003.png",
};

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const image = vehicleImages[vehicle.id];
  return (
    <article className="vehicle-card">
      <div className="vehicle-visual">
        {image ? <Image src={image} alt={`${vehicle.brand} ${vehicle.model} — illustrative demo image`} width={1584} height={992} sizes="(max-width: 700px) 110px, 320px" /> : <svg viewBox="0 0 260 105" fill="none" aria-hidden="true"><path d="m47 61 20-27c5-7 12-10 22-10h71c10 0 17 4 23 12l18 25 21 6c8 2 12 8 12 16v5H27v-9c0-8 4-14 12-16l8-2Z" fill="currentColor" opacity=".14"/><path d="m80 37-14 23h114l-17-23H80Z" fill="currentColor" opacity=".16"/><path d="M134 37v23" stroke="currentColor" opacity=".3" strokeWidth="3"/><circle cx="70" cy="85" r="14" fill="currentColor" opacity=".75"/><circle cx="70" cy="85" r="6" fill="#f5f6f1"/><circle cx="190" cy="85" r="14" fill="currentColor" opacity=".75"/><circle cx="190" cy="85" r="6" fill="#f5f6f1"/></svg>}
        <span>{image ? "Demo illustration" : "Demo inventory"}</span>
      </div>
      <div className="vehicle-body">
        <p className="vehicle-year">{vehicle.year} · {vehicle.brand}</p>
        <h3>{vehicle.model}</h3>
        <div className="vehicle-price">{currency.format(vehicle.price)}</div>
        <div className="vehicle-specs"><span>{number.format(vehicle.mileage)} km</span><span>{vehicle.transmission}</span><span>{vehicle.fuel}</span></div>
        <details className="vehicle-details"><summary>View vehicle <span aria-hidden="true">＋</span></summary><dl><div><dt>Model year</dt><dd>{vehicle.year}</dd></div><div><dt>Transmission</dt><dd>{vehicle.transmission}</dd></div><div><dt>Fuel</dt><dd>{vehicle.fuel}</dd></div><div><dt>Inventory ID</dt><dd>{vehicle.id}</dd></div></dl><p>Local fixture data. This is a sample listing.</p></details>
      </div>
    </article>
  );
}

function welcomeMessage(tenant: Tenant): Message {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    text: `Welcome to ${tenant.brandName || tenant.name}. Tell me what you’re looking for: a budget, brand, mileage, or transmission. I’ll search this dealer’s local demo inventory.`,
  };
}

export default function Home() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [mode, setMode] = useState<Mode>("demo");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [retry, setRetry] = useState(0);
  const sessions = useRef<Record<string, string>>({});
  const activeTenant = useRef("");
  const request = useRef<AbortController | null>(null);
  const chatLog = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingTenants(true);
    setConnectionError("");
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { signal: controller.signal });
        const data = await response.json() as TenantsResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load the local dealerships.");
        if (!Array.isArray(data.tenants) || !data.tenants.length) throw new Error("No local dealerships are configured.");
        if (controller.signal.aborted) return;
        const first = data.tenants[0]!;
        setTenants(data.tenants);
        setMode(data.mode);
        sessions.current[first.id] ||= crypto.randomUUID();
        activeTenant.current = first.id;
        setTenantId(first.id);
        setMessages([welcomeMessage(first)]);
      } catch (error) {
        if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : "Could not reach the local runtime.");
      } finally {
        if (!controller.signal.aborted) setLoadingTenants(false);
      }
    })();
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    chatLog.current?.scrollTo({ top: chatLog.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [messages]);

  useEffect(() => () => request.current?.abort(), []);

  const tenant = tenants.find((item) => item.id === tenantId);
  const color = tenant?.primaryColor && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(tenant.primaryColor) ? tenant.primaryColor : "#151c2a";
  const theme = { "--tenant-color": color } as CSSProperties;
  const vehicles = messages.findLast((message) => message.toolCalls?.some((tool) => tool.name === "inventory.search_vehicles" && tool.status === "success"))?.vehicles ?? [];

  function selectTenant(id: string) {
    const selected = tenants.find((item) => item.id === id);
    if (!selected || id === activeTenant.current) return;
    request.current?.abort();
    request.current = null;
    activeTenant.current = id;
    sessions.current[id] ||= crypto.randomUUID();
    setTenantId(id);
    setMessages([welcomeMessage(selected)]);
    setPrompt("");
    setBusy(false);
  }

  async function sendPrompt(value: string, confirmationId?: string) {
    const text = value.trim();
    if (!text || !tenantId || request.current) return;
    const selectedTenant = tenantId;
    const sessionId = sessions.current[selectedTenant]!;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPrompt("");
    const pendingId = crypto.randomUUID();
    setMessages((current) => [...current,
      { id: crypto.randomUUID(), role: "user", text: confirmationId ? "Confirm the CRM action shown above." : text },
      { id: pendingId, role: "assistant", text: "Working on your request…", pending: true },
    ]);
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId },
        body: JSON.stringify({ prompt: text, tenantId: selectedTenant, ...(confirmationId ? { confirmationId } : {}) }),
        signal: controller.signal,
      });
      const data = await response.json() as ChatResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || `The local runtime returned an error (${response.status}).`);
      if (typeof data.reply !== "string" || data.tenantId !== selectedTenant || data.sessionId !== sessionId) throw new Error("The local runtime returned an unexpected response.");
      if (activeTenant.current !== selectedTenant || request.current !== controller) return;
      setMode(data.mode);
      setMessages((current) => current.map((message) => {
        if (message.id === pendingId) return {
          id: pendingId,
          role: "assistant",
          text: data.reply,
          vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
          toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
          pendingConfirmation: data.pendingConfirmation,
        };
        if (confirmationId && message.pendingConfirmation?.id === confirmationId) return { ...message, pendingConfirmation: undefined };
        return message;
      }));
    } catch (error) {
      if (activeTenant.current !== selectedTenant || request.current !== controller) return;
      const message = controller.signal.aborted ? "The request timed out. Please try again." : error instanceof Error ? error.message : "Could not complete the request. Please try again.";
      setMessages((current) => current.map((item) => item.id === pendingId ? { ...item, pending: false, error: true, text: message } : item));
      if (!confirmationId) setPrompt((current) => current || text);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendPrompt(prompt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendPrompt(prompt);
    }
  }

  return (
    <div className="site" id="home" style={theme}>
      <a className="skip-link" href="#demo">Skip to the live demo</a>
      <header className="site-header">
        <a href="#home" className="brand-link" aria-label="Lionetta home"><Brand /></a>
        <nav aria-label="Main navigation"><a href="#platform">Platform</a><a href="#integrations">Integrations</a><a href="#demo">Live demo</a></nav>
        <a href="#demo" className="button button-green header-cta">Try the demo <Icon name="arrow" /></a>
      </header>
      <main>
        <section className="hero container" id="platform" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> AI assistants for real business</p>
            <h1 id="hero-title">One conversation.<br /><span>Every system.</span></h1>
            <p className="hero-description">Connect your data, tools, and workflows into one intelligent customer experience.</p>
            <div className="hero-actions"><a className="button button-green" href="#demo">Explore the live demo <Icon name="arrow" /></a><a className="button button-outline" href="#integrations"><span className="play-icon" aria-hidden="true">▷</span> See how it works</a></div>
            <p className="hero-footnote"><span /> Your data. Your tools. A more human experience.</p>
          </div>
          <div className="hero-art">
            <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
            <Image className="hero-lioness" src={LIONETTA_LOGO_SRC} alt="Lionetta’s green and purple lioness logo, with soft feminine facial contours" width={720} height={720} sizes="(max-width: 700px) 100vw, 50vw" fetchPriority="high" />
            <div className="art-caption">Your business.<br /><strong>Amplified by<br />intelligence.</strong></div>
            <div className="art-tag"><Icon name="spark" /><span>From complexity<br /><strong>to conversation.</strong></span></div>
          </div>
        </section>

        <section className="connection-section container" id="integrations" aria-labelledby="connection-title">
          <div className="connection-heading"><p className="eyebrow" id="connection-title">Everything you need. Working together.</p><span>Three real MCP demo integrations</span></div>
          <div className="connection-map">
            <div className="source-nodes"><div className="connection-node"><Icon name="inventory" /><span>Inventory</span></div><div className="connection-node"><Icon name="pricing" /><span>Pricing</span></div><div className="connection-node"><Icon name="crm" /><span>CRM</span></div></div>
            <div className="connection-wire"><span /><span /><span /></div>
            <div className="connection-core"><LionMark /><strong>Lionetta</strong></div>
            <div className="connection-wire wire-out"><span /><span /><span /></div>
            <div className="outcome-nodes"><div><Icon name="crm" />Your customers</div><div><Icon name="layers" />Your team</div><div><Icon name="spark" />Your business</div></div>
          </div>
          <div className="features"><div><Icon name="layers" /><h3>Multi-source intelligence</h3><p>Your systems, brought into<br />one useful conversation.</p></div><div><Icon name="spark" /><h3>Client-branded assistants</h3><p>An experience that looks<br />and feels like your business.</p></div><div><Icon name="shield" /><h3>You stay in control</h3><p>Review important actions<br />before they happen.</p></div><div><Icon name="inventory" /><h3>Built to connect</h3><p>A foundation for your<br />next integration.</p></div></div>
        </section>

        <section className="demo-section container" id="demo" aria-labelledby="demo-title">
          <div className="demo-heading"><div><p className="eyebrow">The Lionetta experience</p><h2 id="demo-title">Your brand. <span>Your assistant.</span></h2><p>See connected intelligence at work inside a client&apos;s own experience.</p></div><div className="dealer-switch"><label htmlFor="dealer">Demo dealership</label><select id="dealer" value={tenantId} onChange={(event) => selectTenant(event.target.value)} disabled={loadingTenants || !tenants.length}>{!tenants.length && <option value="">{loadingTenants ? "Connecting…" : "Runtime unavailable"}</option>}{tenants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div></div>
          {connectionError && <div className="connection-error" role="alert"><p>{connectionError}</p><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loadingTenants}>Retry connection</button></div>}
          <div className="client-frame">
            <div className="frame-bar"><div className="frame-dots" aria-hidden="true"><i /><i /><i /></div><span>{tenant?.name || "Client"} · Lionetta demo</span><span className="frame-mode"><span />{mode === "openai" ? "API model · demo inventory" : "Local demo · fixture data"}</span></div>
            <div className="client-body">
              <div className="client-website">
                <header className="client-header"><div className="client-wordmark"><Icon name="car" /><strong>{tenant?.name || "Your dealership"}</strong><small>Premium motoring</small></div><a href="#client-inventory">Vehicles</a><button type="button" className="client-cta" disabled={busy || !tenantId} onClick={() => { void sendPrompt("Show me available cars."); }}>Find your next car <Icon name="arrow" /></button></header>
                <div className="client-hero"><p className="eyebrow">Premium cars. Personal conversations.</p><h3>Find your<br /><em>next chapter.</em></h3><p>The right car starts with a conversation.<br />Tell your assistant what matters to you.</p><div className="client-hero-car" aria-hidden="true"><Icon name="car" /></div></div>
                <div className="client-inventory" id="client-inventory"><div className="inventory-heading"><h4>{vehicles.length ? "Your matching vehicles" : "A car that fits your life"}</h4><span>{vehicles.length ? `${vehicles.length} ${vehicles.length === 1 ? "match" : "matches"}` : "Explore with your assistant"}</span></div>{vehicles.length ? <div className="fleet-cards">{vehicles.slice(0, 3).map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)}</div> : <div className="inventory-placeholder"><div><Icon name="inventory" /><strong>Choose your model</strong><span>From everyday to extraordinary.</span></div><div><Icon name="pricing" /><strong>Set your budget</strong><span>Find the right fit for your plans.</span></div><div><Icon name="shield" /><strong>Make it yours</strong><span>Explore every detail with confidence.</span></div></div>}</div>
                <div className="client-footer"><span>Local sample listings · EUR prices</span><span>Powered by <strong>Lionetta</strong><Icon name="spark" /></span></div>
              </div>
              <aside className="assistant-panel" aria-label="Client assistant">
                <header className="assistant-header"><div className="assistant-brand-icon"><Icon name="car" /></div><div><strong>{tenant?.brandName || "Your assistant"}</strong><span>Your personal car advisor</span></div><span className="assistant-online" aria-label={loadingTenants ? "Connecting" : connectionError ? "Unavailable" : "Local runtime available"} data-connected={!loadingTenants && !connectionError} /></header>
                <section ref={chatLog} className="conversation" aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions text">
                  {messages.map((message) => <article key={message.id} className={`message ${message.role}${message.error ? " error" : ""}${message.pending ? " pending" : ""}`}>
                    <div className="avatar" aria-hidden="true">{message.role === "user" ? "You" : <LionMark />}</div>
                    <div className="message-content"><div className="message-name">{message.role === "user" ? "You" : tenant?.brandName || "Lionetta"}</div><p className="message-text" role={message.error ? "alert" : undefined}>{message.text}</p>
                      {!!message.vehicles?.length && <div className="vehicles">{message.vehicles.map((vehicle) => <VehicleCard vehicle={vehicle} key={vehicle.id} />)}</div>}
                      {!!message.toolCalls?.length && <details className="tool-trace"><summary>{message.toolCalls.length} tool {message.toolCalls.length === 1 ? "call" : "calls"} · execution details</summary><ul>{message.toolCalls.map((tool, index) => <li key={`${tool.name}-${index}`}><code>{tool.name}</code><span className="tool-status">{tool.status.replaceAll("_", " ")}</span></li>)}</ul></details>}
                      {message.pendingConfirmation && <div className="confirmation"><span className="eyebrow">Your confirmation is needed</span><h3>Review this CRM action</h3><p>This action will write to the local demo CRM.</p><div className="confirmation-tool">{message.pendingConfirmation.toolName}</div><pre>{JSON.stringify(message.pendingConfirmation.arguments, null, 2)}</pre><button type="button" disabled={busy} onClick={() => { void sendPrompt("confirm", message.pendingConfirmation!.id); }}>Confirm CRM action <Icon name="arrow" /></button></div>}
                    </div>
                  </article>)}
                </section>
                <div className="suggestions" aria-label="Try an example request">{examples.map((example) => <button type="button" className="suggestion" key={example.title} disabled={busy || !tenantId} onClick={() => { void sendPrompt(example.prompt); }}>{example.title}<Icon name="arrow" /></button>)}</div>
                <div className="composer-wrap"><form className="composer" onSubmit={submit} aria-busy={busy}><label className="sr-only" htmlFor="prompt">Message your car assistant</label><textarea ref={input} id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} rows={1} maxLength={4000} placeholder="Ask about cars, budget, or mileage…" aria-describedby="composer-note" disabled={!tenantId} /><button className="send" type="submit" disabled={busy || !tenantId || !prompt.trim()} aria-label={busy ? "Searching" : "Send message"}>{busy ? <span className="sending-dot" /> : <Icon name="arrow" />}</button></form><p id="composer-note" className="composer-note">{mode === "demo" ? "Demo mode · no model or live integrations connected" : "API model connected · local fixture integrations"}</p></div>
                <div className="assistant-powered">Intelligence by <Brand compact /></div>
              </aside>
            </div>
          </div>
          <p className="demo-caption">One platform. Your branding, your inventory, your permissions. <span>Sample data only.</span></p>
        </section>
      </main>
      <footer className="site-footer container"><a href="#home" className="brand-link" aria-label="Lionetta home"><Brand compact /></a><p>From complexity to conversation.</p><a href="#home">Back to top ↑</a></footer>
    </div>
  );
}
