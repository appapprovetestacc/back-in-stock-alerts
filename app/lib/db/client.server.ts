import { drizzle } from "drizzle-orm/d1";

export function getDb(d1: D1Database | undefined) {
  if (!d1) {
    throw new Error(
      "D1 database binding is not configured. Add a [[d1_databases]] block to wrangler.toml and bind it as D1."
    );
  }
  return drizzle(d1);
}
