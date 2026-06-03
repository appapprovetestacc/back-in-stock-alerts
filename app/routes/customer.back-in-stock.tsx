import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import type { Env } from "~/load-context";
import { getDb } from "~/lib/db/client.server";
import { backInStockSubscriptions } from "~/lib/db/schema.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json(
      { success: false, error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const env = (context.cloudflare?.env ?? {}) as Env;

  let body: Record<string, unknown>;
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      body = (await request.json()) as Record<string, unknown>;
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
  } catch {
    return json(
      { success: false, error: "Invalid request body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const shop = typeof body["shop"] === "string" ? body["shop"].trim() : "";
  const variantId =
    typeof body["variantId"] === "string" ? body["variantId"].trim() : "";
  const email = typeof body["email"] === "string" ? body["email"].trim() : "";

  if (!shop || !variantId || !email) {
    return json(
      { success: false, error: "Missing required fields: shop, variantId, email" },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return json(
      { success: false, error: "Invalid email address" },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  if (!env.D1) {
    return json(
      { success: false, error: "Service unavailable" },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  try {
    const db = getDb(env.D1);

    await db
      .insert(backInStockSubscriptions)
      .values({
        shop,
        shopDomain: shop,
        variantId,
        customerEmail: email,
        email,
        status: "pending",
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();

    return json(
      { success: true, message: "You will be notified when this item is back in stock." },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(
      { success: false, error: "Failed to save subscription", detail: message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}