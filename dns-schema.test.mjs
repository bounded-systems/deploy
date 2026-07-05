// The DNS-as-code contract, exercised against the real zone state — so
// state/*.dns.json can never drift from a valid, applyable shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD_TYPES, validateRecord, validateZone } from "./dns-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("every state/*.dns.json conforms to the DNS-as-code contract", () => {
  const dir = join(HERE, "state");
  const zones = readdirSync(dir).filter((f) => f.endsWith(".dns.json"));
  assert.ok(zones.length > 0, "at least one zone file");
  for (const z of zones) {
    const records = JSON.parse(readFileSync(join(dir, z), "utf8"));
    const errs = validateZone(records);
    assert.deepEqual(errs, [], `${z}:\n  ${errs.join("\n  ")}`);
  }
});

test("validateRecord flags the ways a record can be invalid", () => {
  const ok = { type: "A", name: "x", content: "1.2.3.4", proxied: false, ttl: 1 };
  assert.deepEqual(validateRecord(ok), []);
  assert.ok(validateRecord({ ...ok, type: "BOGUS" }).length > 0, "bad type");
  assert.ok(validateRecord({ ...ok, name: "" }).length > 0, "empty name");
  assert.ok(validateRecord({ ...ok, proxied: "yes" }).length > 0, "non-bool proxied");
  assert.ok(validateRecord({ ...ok, ttl: 0 }).length > 0, "non-positive ttl");
  assert.ok(validateRecord({ ...ok, extra: 1 }).length > 0, "unknown field");
});

test("RECORD_TYPES covers what the live zone actually uses", () => {
  const records = JSON.parse(
    readFileSync(join(HERE, "state", "bounded.tools.dns.json"), "utf8"),
  );
  for (const r of records) assert.ok(RECORD_TYPES.includes(r.type), r.type);
});
