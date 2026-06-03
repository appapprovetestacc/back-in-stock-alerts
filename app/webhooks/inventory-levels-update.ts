import type { AppLoadContext } from "@remix-run/cloudflare";
import type { Env } from "~/load-context";
import { loadOfflineSession } from "~/lib/session-storage.server";
import { shopifyAdmin } from "~/lib/shopify-api.server";
import { sendMail } from "~/lib/mail.server";
import { getDb } from "~/lib/db/client.server";
import { eq, and } from "drizzle-orm";
import { backInStockSubscriptions } from "~/lib/db/schema.server";
import { logger } from "~/lib/error-reporter.server";

interface InventoryLevelUpdatePayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

interface VariantQueryResult {
  inventoryItem: {
    variant: {
      id: string;
      title: string;
      product: {
        id: string;
        title: string;
        handle: string;
        featuredImage: {
          url: string;
        } | null;
        onlineStoreUrl: string | null;
      };
    } | null;
  } | null;
}

export default async function handler(
  request: Request,
  context: AppLoadContext
): Promise<Response> {
  const env = (context.cloudflare?.env ?? {}) as Env;

  let payload: InventoryLevelUpdatePayload;
  try {
    payload = (await request.json()) as InventoryLevelUpdatePayload;
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const { inventory_item_id, available } = payload;

  if (!available || available <= 0) {
    return new Response("No stock available — skipping notifications", {
      status: 200,
    });
  }

  const shopDomain = request.headers.get("x-shopify-shop-domain");
  if (!shopDomain) {
    return new Response("Missing shop domain header", { status: 400 });
  }

  const session = await loadOfflineSession(context, shopDomain);
  if (!session) {
    logger.warn("No offline session found for shop", { shop: shopDomain });
    return new Response("No session found", { status: 200 });
  }

  const api = shopifyAdmin({ env, session, shop: shopDomain });

  let variantData: VariantQueryResult;
  try {
    variantData = await api.graphql<VariantQueryResult>(
      `query GetVariantByInventoryItem($id: ID!) {
        inventoryItem(id: $id) {
          variant {
            id
            title
            product {
              id
              title
              handle
              featuredImage {
                url
              }
              onlineStoreUrl
            }
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/InventoryItem/${inventory_item_id}`,
        },
      }
    );
  } catch (err) {
    logger.error("Failed to query variant for inventory item", {
      inventoryItemId: String(inventory_item_id),
      shop: shopDomain,
      error: String(err),
    });
    return new Response("Failed to query Shopify API", { status: 500 });
  }

  const variant = variantData?.inventoryItem?.variant;
  if (!variant) {
    return new Response("No variant found for inventory item", { status: 200 });
  }

  const variantGid = variant.id;
  const product = variant.product;

  const db = getDb(env.D1);

  let pendingSubscriptions: Array<{
    id: string;
    email: string;
    shopDomain: string;
    variantId: string;
    status: string;
  }>;

  try {
    pendingSubscriptions = await db
      .select()
      .from(backInStockSubscriptions)
      .where(
        and(
          eq(backInStockSubscriptions.variantId, variantGid),
          eq(backInStockSubscriptions.shopDomain, shopDomain),
          eq(backInStockSubscriptions.status, "pending")
        )
      );
  } catch (err) {
    logger.error("Failed to query subscriptions", {
      variantId: variantGid,
      shop: shopDomain,
      error: String(err),
    });
    return new Response("Database query failed", { status: 500 });
  }

  if (pendingSubscriptions.length === 0) {
    return new Response("No pending subscriptions for this variant", {
      status: 200,
    });
  }

  const productUrl =
    product.onlineStoreUrl ??
    `https://${shopDomain}/products/${product.handle}`;

  const variantLabel =
    variant.title && variant.title !== "Default Title"
      ? ` — ${variant.title}`
      : "";

  const emailSubject = `${product.title} is back in stock!`;

  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1a1a1a;">Great news! ${product.title} is back in stock</h1>
      ${
        product.featuredImage
          ? `<img src="${product.featuredImage.url}" alt="${product.title}" style="max-width: 100%; border-radius: 8px; margin-bottom: 16px;" />`
          : ""
      }
      <p style="color: #444; font-size: 16px;">
        The item you were waiting for — <strong>${product.title}${variantLabel}</strong> — is now available again.
        Don't wait too long, stock may be limited!
      </p>
      <a
        href="${productUrl}"
        style="
          display: inline-block;
          background-color: #008060;
          color: #ffffff;
          text-decoration: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: bold;
          margin-top: 16px;
        "
      >
        Shop Now
      </a>
      <p style="color: #888; font-size: 12px; margin-top: 32px;">
        You received this email because you signed up for back-in-stock alerts.
        If you no longer wish to receive these emails, please contact the store.
      </p>
    </div>
  `;

  const notifiedIds: string[] = [];
  const failedIds: string[] = [];

  for (const subscription of pendingSubscriptions) {
    try {
      await sendMail(context, {
        to: subscription.email,
        subject: emailSubject,
        html: emailHtml,
      });
      notifiedIds.push(subscription.id);
    } catch (err) {
      logger.error("Failed to send back-in-stock email", {
        subscriptionId: subscription.id,
        email: subscription.email,
        error: String(err),
      });
      failedIds.push(subscription.id);
    }
  }

  if (notifiedIds.length > 0) {
    try {
      for (const id of notifiedIds) {
        await db
          .update(backInStockSubscriptions)
          .set({
            status: "notified",
            notifiedAt: new Date().toISOString(),
          })
          .where(eq(backInStockSubscriptions.id, id));
      }
    } catch (err) {
      logger.error("Failed to update subscription statuses", {
        ids: notifiedIds.join(","),
        error: String(err),
      });
    }
  }

  logger.info("Back-in-stock notifications sent", {
    variantId: variantGid,
    shop: shopDomain,
    notified: String(notifiedIds.length),
    failed: String(failedIds.length),
  });

  return new Response(
    JSON.stringify({
      notified: notifiedIds.length,
      failed: failedIds.length,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}