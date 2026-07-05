/**
 * @module
 * The DNS-as-code contract — the semantics of `state/<zone>.dns.json`. Each entry
 * is a Cloudflare DNS record; this defines the valid shape so the static data is
 * machine-checkable (dns-schema.test.mjs validates every zone against it, and
 * apply.mjs can reject drift before touching live DNS).
 *
 * Dependency-free on purpose — the same "schema as contract" the org's Zod specs
 * express (trellis-kit, dev-contracts, the wire agreements), kept plain so it runs
 * in deploy's zero-dep `node --test`.
 */

/** DNS record types deploy manages. */
export const RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SRV",
  "CAA",
];

/** The fields every record carries (Cloudflare's create/update shape). */
export const RECORD_FIELDS = ["type", "name", "content", "proxied", "ttl"];

/** Validate one record; returns human-readable errors (empty ⇒ valid). */
export function validateRecord(r, at = "") {
  const p = at ? `${at}: ` : "";
  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    return [`${p}not an object`];
  }
  const errs = [];
  if (!RECORD_TYPES.includes(r.type)) {
    errs.push(`${p}invalid type ${JSON.stringify(r.type)} (one of ${RECORD_TYPES.join(", ")})`);
  }
  if (typeof r.name !== "string" || r.name.length === 0) {
    errs.push(`${p}name must be a non-empty string`);
  }
  if (typeof r.content !== "string" || r.content.length === 0) {
    errs.push(`${p}content must be a non-empty string`);
  }
  if (typeof r.proxied !== "boolean") {
    errs.push(`${p}proxied must be a boolean`);
  }
  if (!Number.isInteger(r.ttl) || r.ttl < 1) {
    errs.push(`${p}ttl must be a positive integer`);
  }
  for (const k of Object.keys(r)) {
    if (!RECORD_FIELDS.includes(k)) {
      errs.push(`${p}unknown field ${JSON.stringify(k)}`);
    }
  }
  return errs;
}

/** Validate a whole zone (array of records); returns all errors. */
export function validateZone(records) {
  if (!Array.isArray(records)) return ["zone must be an array of records"];
  return records.flatMap((r, i) => validateRecord(r, `record[${i}]`));
}
