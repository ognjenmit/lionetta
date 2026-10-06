import { backendUrl, forwardJson, unavailable } from "../../../lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(backendUrl("/tenants"), {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return await forwardJson(response);
  } catch {
    return unavailable();
  }
}
