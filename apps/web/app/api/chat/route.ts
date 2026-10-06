import { NextResponse } from "next/server";
import { backendUrl, forwardJson, unavailable } from "../../../lib/backend";

export const runtime = "nodejs";

const sessionHeader = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return NextResponse.json({ error: "Send a JSON object containing a prompt and tenantId." }, { status: 400 });
  }
  const body = input as Record<string, unknown>;
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 4000
    || typeof body.tenantId !== "string" || !body.tenantId || body.tenantId.length > 100
    || (body.confirmationId !== undefined && (typeof body.confirmationId !== "string" || !body.confirmationId || body.confirmationId.length > 100))) {
    return NextResponse.json({ error: "A prompt, tenantId, and optional confirmationId are required in the expected format." }, { status: 400 });
  }
  const sessionId = request.headers.get(sessionHeader);
  if (!sessionId || !uuidPattern.test(sessionId)) {
    return NextResponse.json({ error: "A valid local session ID is required." }, { status: 400 });
  }
  try {
    const response = await fetch(backendUrl("/invocations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", [sessionHeader]: sessionId },
      body: JSON.stringify({
        prompt: body.prompt,
        tenantId: body.tenantId,
        ...(body.confirmationId !== undefined ? { confirmationId: body.confirmationId } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    return await forwardJson(response);
  } catch {
    return unavailable();
  }
}
