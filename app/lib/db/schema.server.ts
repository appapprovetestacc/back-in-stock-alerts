import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const backInStockSubscriptions = sqliteTable("back_in_stock_subscriptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  shop: text("shop").notNull(),
  shopDomain: text("shop_domain").notNull(),
  variantId: text("variant_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  productTitle: text("product_title").notNull().default(""),
  variantTitle: text("variant_title"),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  notifiedAt: text("notified_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type BackInStockSubscription = typeof backInStockSubscriptions.$inferSelect;
export type NewBackInStockSubscription = typeof backInStockSubscriptions.$inferInsert;

export const backInStockSettings = sqliteTable("back_in_stock_settings", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  shop: text("shop").notNull().unique(),
  alertsEnabled: integer("alerts_enabled", { mode: "boolean" }).notNull().default(true),
  emailSubject: text("email_subject").notNull().default("Your item is back in stock!"),
  emailBody: text("email_body").notNull().default(
    "Great news! The item you were waiting for is now available. Visit our store to purchase it before it sells out again."
  ),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export type BackInStockSettings = typeof backInStockSettings.$inferSelect;
export type NewBackInStockSettings = typeof backInStockSettings.$inferInsert;