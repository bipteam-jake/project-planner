// src/lib/schema.ts
export const SCHEMA_VERSION = 3; // bump when you change shapes

export function migrate(storage: Storage) {
  const v = Number(storage.getItem("bip_schema_version") || "0");

  if (v < 1) {
    // e.g., add `targetMarginPct` default
    // mutate stored projects and save back
  }
  if (v < 2) {
    // e.g., split FT/PT comp fields
  }
  if (v < 3) {
    // e.g., introduce per-month revenue
  }

  storage.setItem("bip_schema_version", String(SCHEMA_VERSION));
}
    