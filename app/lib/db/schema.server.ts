import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const backInStockSubscriptions = sqliteTable("back_in_stock_subscriptions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  shop: text("shop").notNull(),
  variantId: text("variant_id").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type BackInStockSubscription = typeof backInStockSubscriptions.$inferSelect;
export type NewBackInStockSubscription = typeof backInStockSubscriptions.$inferInsert;