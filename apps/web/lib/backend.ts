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

export function unavailable(): NextResponse {
  return NextResponse.json(
    { error: "The local runtime is unavailable. Start the Lionetta API and try again." },
    { status: 503 },
  );
}
