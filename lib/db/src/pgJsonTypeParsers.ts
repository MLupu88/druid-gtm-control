// M3.5 real-data defect fix — double JSON-parse of jsonb columns.
//
// node-postgres registers its own default type parsers for the json/
// jsonb OIDs (114/3802) that already run JSON.parse on the raw column
// text (see pg-types' textParsers.js: `register(3802, JSON.parse)`).
// drizzle-orm's PgJsonb.mapFromDriverValue then unconditionally
// re-parses any string result via JSON.parse *again* (see
// drizzle-orm/pg-core/columns/jsonb.js), on the assumption that the
// driver value it receives is still raw, unparsed JSON text.
//
// For a jsonb value whose first parse yields a plain JS string, that
// second parse silently reinterprets the string's *contents* as JSON.
// A numeric-looking identifier such as observations.raw_value "999"
// (crm.owner) becomes the number 999 — corrupting an identifier into a
// quantity. Non-numeric-looking strings such as "acme.com" merely
// happen to survive, because JSON.parse throws on them and drizzle
// falls back to the original string — an accident of contents, not a
// guarantee.
//
// The fix: tell node-postgres to leave json/jsonb columns as raw text,
// so drizzle-orm's own single JSON.parse becomes the only — and
// therefore correct — parse step, for every jsonb column in this
// schema (observations.raw_value, normalized_value, provider_metadata,
// evidence_refs, etc.), not just the one that surfaced this defect.
//
// pg.types is a process-wide singleton (node_modules/pg's lib/index.js:
// `this.types = require('pg-types')`, itself Node's module cache), and
// node-postgres looks up the parser at result-decoding time, not at
// Pool/Client construction time — so calling this once, before any
// query result is decoded, is sufficient for every Pool/Client in this
// process, including each integration test's own ad hoc `new Pool(...)`.
// This module opens no connection and has no DATABASE_URL dependency,
// so it is safe to load as a side effect from ./schema/index.ts, which
// every DB-touching module (production and test) already imports.
import pg from "pg";

function passThroughText(value: string): string {
  return value;
}

pg.types.setTypeParser(pg.types.builtins.JSON, passThroughText);
pg.types.setTypeParser(pg.types.builtins.JSONB, passThroughText);
