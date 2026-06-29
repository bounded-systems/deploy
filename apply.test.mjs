// Unit tests for planChanges — the value-aware DNS diff. No network: planChanges is pure (the I/O
// in apply.mjs runs only under a direct-execution guard, so importing it here is safe).

import { test } from "node:test";
import assert from "node:assert/strict";
import { planChanges } from "./apply.mjs";

const mx = (name, content, id) => ({ type: "MX", name, content, ttl: 1, ...(id ? { id } : {}) });
const txt = (name, content, id) => ({ type: "TXT", name, content, ttl: 1, ...(id ? { id } : {}) });
const a = (name, content, over = {}) => ({ type: "A", name, content, ttl: 1, ...over });
const counts = (p) => ({ c: p.creates.length, u: p.updates.length, d: p.deletes.length });

test("multi-value identical (dual MX) → NO changes (the bug: used to report a spurious update)", () => {
  const desired = [mx("ex.com", "mx01.icloud.com"), mx("ex.com", "mx02.icloud.com")];
  const live = [mx("ex.com", "mx01.icloud.com", "id1"), mx("ex.com", "mx02.icloud.com", "id2")];
  assert.deepEqual(counts(planChanges(desired, live)), { c: 0, u: 0, d: 0 });
});

test("multi-value TXT identical (SPF + verification) → NO changes", () => {
  const desired = [txt("ex.com", "v=spf1 ~all"), txt("ex.com", "apple-domain=abc")];
  const live = [txt("ex.com", "v=spf1 ~all", "i1"), txt("ex.com", "apple-domain=abc", "i2")];
  assert.deepEqual(counts(planChanges(desired, live)), { c: 0, u: 0, d: 0 });
});

test("add one record to a multi-value group → exactly 1 create", () => {
  const desired = [mx("ex.com", "mx01.icloud.com"), mx("ex.com", "mx02.icloud.com")];
  const live = [mx("ex.com", "mx01.icloud.com", "id1")];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 1, u: 0, d: 0 });
  assert.equal(p.creates[0].content, "mx02.icloud.com");
});

test("remove one record from a multi-value group → exactly 1 delete (with its live id)", () => {
  const desired = [mx("ex.com", "mx01.icloud.com")];
  const live = [mx("ex.com", "mx01.icloud.com", "id1"), mx("ex.com", "mx02.icloud.com", "id2")];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 0, u: 0, d: 1 });
  assert.equal(p.deletes[0].id, "id2");
});

test("single record content change → in-place UPDATE (no delete, needs no ALLOW_DELETE)", () => {
  const desired = [a("www.ex.com", "5.6.7.8")];
  const live = [a("www.ex.com", "1.2.3.4", { id: "id1" })];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 0, u: 1, d: 0 });
  assert.equal(p.updates[0].id, "id1");
  assert.equal(p.updates[0].record.content, "5.6.7.8");
});

test("same content, drifted settings (ttl/proxied) → 1 update keyed to the live id", () => {
  const desired = [a("www.ex.com", "1.2.3.4", { ttl: 300, proxied: true })];
  const live = [a("www.ex.com", "1.2.3.4", { ttl: 1, proxied: false, id: "id1" })];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 0, u: 1, d: 0 });
  assert.equal(p.updates[0].id, "id1");
});

test("same content AND same settings → no-op", () => {
  const desired = [a("www.ex.com", "1.2.3.4", { ttl: 1 })];
  const live = [a("www.ex.com", "1.2.3.4", { ttl: 1, id: "id1" })];
  assert.deepEqual(counts(planChanges(desired, live)), { c: 0, u: 0, d: 0 });
});

test("multiple TXT where one value changes → pairs the leftover as one update (no churn)", () => {
  const desired = [txt("ex.com", "keep"), txt("ex.com", "new-value")];
  const live = [txt("ex.com", "keep", "i1"), txt("ex.com", "old-value", "i2")];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 0, u: 1, d: 0 });
  assert.equal(p.updates[0].id, "i2");
  assert.equal(p.updates[0].record.content, "new-value");
});

test("new zone (no live) → all creates", () => {
  const desired = [a("ex.com", "1.1.1.1"), a("www.ex.com", "2.2.2.2")];
  assert.deepEqual(counts(planChanges(desired, [])), { c: 2, u: 0, d: 0 });
});

test("empty desired vs live records → all deletes", () => {
  const live = [a("ex.com", "1.1.1.1", { id: "id1" }), txt("ex.com", "x", "id2")];
  assert.deepEqual(counts(planChanges([], live)), { c: 0, u: 0, d: 2 });
});

test("distinct (type,name) groups are reconciled independently", () => {
  const desired = [a("ex.com", "1.1.1.1"), mx("ex.com", "mx01.icloud.com")];
  const live = [a("ex.com", "9.9.9.9", { id: "ida" }), mx("ex.com", "mx01.icloud.com", "idmx")];
  const p = planChanges(desired, live);
  assert.deepEqual(counts(p), { c: 0, u: 1, d: 0 });
  assert.equal(p.updates[0].record.type, "A");
});
