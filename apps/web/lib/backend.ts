import { NextResponse } from "next/server";

// The browser can call only these fixed application routes. It never selects
// an upstream origin or receives server-side integration credentials.
export function backendUrl(path: "/tenants" | "/invocations"): URL {
  return new URL(path, process.env.API_ORIGIN || "http://127.0.0.1:8080");
}

export async function forwardJson(response: Response): Promise<NextResponse> {
  const data: unknown = await response.json().catch(() => null);
  if (data === null) {
    return NextResponse.json({ error: "The local runtime returned an invalid response." }, { status: 502 });
  }
  return NextResponse.json(data, { status: response.status });
}

export function unavailable(error: unknown): NextResponse {
  // Log only known transport codes: raw errors can contain URL credentials.
  const knownCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
    "ERR_INVALID_URL", "ERR_INVALID_ARG_TYPE", "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"]);
  const failure = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const candidate = failure?.cause?.code ?? failure?.code;
  const code = typeof candidate === "string" && knownCodes.has(candidate) ? candidate
    : failure?.name === "TimeoutError" ? "TIMEOUT" : failure?.name === "AbortError" ? "ABORTED" : "NETWORK_ERROR";
  console.error(`[web] Lionetta API connection failed (${code}). Check the [api] startup logs and API_ORIGIN. Run npm run dev from the repository root to start all services.`);
  return NextResponse.json(
    { error: "The local runtime is unavailable. Start the Lionetta API and try again." },
    { status: 503 },
  );
}
