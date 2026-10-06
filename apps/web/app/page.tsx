"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import type { ChatResponse, Mode, PendingConfirmation, Tenant, TenantsResponse, ToolCall, Vehicle } from "../lib/contracts";

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

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <article className="vehicle-card">
      <div className="vehicle-visual" aria-hidden="true">
        <svg viewBox="0 0 260 105" fill="none"><path d="m47 61 20-27c5-7 12-10 22-10h71c10 0 17 4 23 12l18 25 21 6c8 2 12 8 12 16v5H27v-9c0-8 4-14 12-16l8-2Z" fill="currentColor" opacity=".14"/><path d="m80 37-14 23h114l-17-23H80Z" fill="currentColor" opacity=".16"/><path d="M134 37v23" stroke="currentColor" opacity=".3" strokeWidth="3"/><circle cx="70" cy="85" r="14" fill="currentColor" opacity=".75"/><circle cx="70" cy="85" r="6" fill="#f5f6f1"/><circle cx="190" cy="85" r="14" fill="currentColor" opacity=".75"/><circle cx="190" cy="85" r="6" fill="#f5f6f1"/></svg>
        <span>Demo inventory</span>
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
  const transcriptEnd = useRef<HTMLDivElement>(null);
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
    transcriptEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => request.current?.abort(), []);

  const tenant = tenants.find((item) => item.id === tenantId);
  const color = tenant?.primaryColor && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(tenant.primaryColor) ? tenant.primaryColor : "#315a42";
  const theme = { "--tenant-color": color } as CSSProperties;

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
    <div className="app" style={theme}>
      <aside className="sidebar" aria-label="Dealer workspace">
        <a className="brand" href="/" aria-label="Lionetta home"><span className="brand-mark" aria-hidden="true">l</span><span>Lionetta</span></a>
        <div className="dealer-section">
          <label className="eyebrow" htmlFor="dealer">Dealership</label>
          <select id="dealer" value={tenantId} onChange={(event) => selectTenant(event.target.value)} disabled={loadingTenants || !tenants.length}>
            {!tenants.length && <option value="">{loadingTenants ? "Connecting…" : "Runtime unavailable"}</option>}
            {tenants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          <p className="dealer-note">A separate conversation and inventory for each dealership.</p>
        </div>
        <div className="workspace-nav"><span className="nav-icon" aria-hidden="true">✦</span> Car assistant <span className="small-label">Local</span></div>
        <div className="sidebar-bottom">
          <span className="eyebrow">Built for conversation</span>
          <p>Search inventory.<br />Explore the details.<br />Review before taking action.</p>
          <div className="session-label">Session {tenantId ? sessions.current[tenantId]?.slice(0, 8) : "—"}</div>
        </div>
      </aside>
      <main>
        <header className="topbar"><span>{tenant?.brandName || "Your dealership"} <span className="breadcrumb">/ Car assistant</span></span><span className="status-badge"><span aria-hidden="true" />{mode === "openai" ? "OpenAI · local fixtures" : "Local demo · fixture data"}</span></header>
        <section className="intro" aria-labelledby="welcome-title">
          <span className="eyebrow">A good fit starts here</span>
          <h1 id="welcome-title">Your next car.<br /><em>One conversation away.</em></h1>
          <p>Tell us what matters. We’ll help you find the right car in this dealer’s inventory.</p>
          <div className="suggestions" aria-label="Try an example request">
            {examples.map((example) => <button type="button" className="suggestion" key={example.title} disabled={busy || !tenantId} onClick={() => { void sendPrompt(example.prompt); }}><strong>{example.title}<span aria-hidden="true">↗</span></strong><span>{example.detail}</span></button>)}
          </div>
        </section>
        {connectionError && <div className="connection-error" role="alert"><p>{connectionError}</p><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loadingTenants}>Retry connection</button></div>}
        <section className="conversation" aria-label="Conversation" role="log" aria-live="polite" aria-relevant="additions text">
          {messages.map((message) => <article key={message.id} className={`message ${message.role}${message.error ? " error" : ""}${message.pending ? " pending" : ""}`}>
            <div className="avatar" aria-hidden="true">{message.role === "user" ? "You" : "L"}</div>
            <div className="message-content"><div className="message-name">{message.role === "user" ? "You" : tenant?.brandName || "Lionetta"}</div><p className="message-text" role={message.error ? "alert" : undefined}>{message.text}</p>
              {!!message.vehicles?.length && <div className="vehicles">{message.vehicles.map((vehicle) => <VehicleCard vehicle={vehicle} key={vehicle.id} />)}</div>}
              {!!message.toolCalls?.length && <details className="tool-trace"><summary>{message.toolCalls.length} tool {message.toolCalls.length === 1 ? "call" : "calls"} · view execution trace</summary><ul>{message.toolCalls.map((tool, index) => <li key={`${tool.name}-${index}`}><code>{tool.name}</code><span>{tool.serverId}</span><span className="tool-status">{tool.status}</span></li>)}</ul></details>}
              {message.pendingConfirmation && <div className="confirmation"><span className="eyebrow">Your confirmation is needed</span><h3>Review this CRM action</h3><p>This action will write to the local demo CRM.</p><div className="confirmation-tool">{message.pendingConfirmation.toolName}</div><pre>{JSON.stringify(message.pendingConfirmation.arguments, null, 2)}</pre><button type="button" disabled={busy} onClick={() => { void sendPrompt("confirm", message.pendingConfirmation!.id); }}>Confirm CRM action ↗</button></div>}
            </div>
          </article>)}
          <div ref={transcriptEnd} />
        </section>
        <div className="composer-wrap">
          <form className="composer" onSubmit={submit} aria-busy={busy}><label className="sr-only" htmlFor="prompt">Message your car assistant</label><textarea ref={input} id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} rows={1} maxLength={4000} placeholder="A BMW 3 Series, automatic, under €25,000…" aria-describedby="composer-note" disabled={!tenantId} /><button className="send" type="submit" disabled={busy || !tenantId || !prompt.trim()}>{busy ? "Searching…" : "Send ↗"}</button></form>
          <p id="composer-note" className="composer-note">{mode === "demo" ? "No model or live integrations connected." : "OpenAI is connected; inventory and CRM use local fixtures. No live integrations connected."} Enter to send · Shift + Enter for a new line.</p>
        </div>
      </main>
    </div>
  );
}
