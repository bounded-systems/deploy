#!/usr/bin/env node
// DNS apply — reconcile desired DNS (state/<zone>.dns.json) toward live Cloudflare.
//
// SAFE BY DEFAULT:
//   • Prints a plan and exits — dry-run unless APPLY=true.
//   • On APPLY=true: performs creates + updates only.
//   • DELETES require APPLY=true AND ALLOW_DELETE=true — so an incomplete state file can never
//     silently wipe live records.
// Gated behind a required-reviewers GitHub Environment (see .github/workflows/apply.yml). The
// write-scoped CLOUDFLARE_API_TOKEN is minted just-in-time by the OIDC token-broker for the run.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";

// --- diff (pure, value-aware, unit-tested) ---------------------------------
// Records are matched WITHIN their (type, name) group by CONTENT, so multi-value records — dual
// MX, several TXT — reconcile independently instead of colliding on a (type, name)-only key. Per
// group: exact content match → no-op (update only on proxied/ttl drift); leftovers pair 1:1 as
// in-place updates (a content change keeps the record, no delete); surplus desired → create;
// surplus live → delete (guarded).
const recKey = (r) => `${r.type} ${r.name}`;
const sameSettings = (a, b) => !!a.proxied === !!b.proxied && (a.ttl ?? 1) === (b.ttl ?? 1);

function groupByTypeName(records) {
  const m = new Map();
  for (const r of records) {
    const k = recKey(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export function planChanges(desired, live) {
  const creates = [], updates = [], deletes = [];
  const dGroups = groupByTypeName(desired);
  const lGroups = groupByTypeName(live);
  for (const gk of new Set([...dGroups.keys(), ...lGroups.keys()])) {
    const want = [...(dGroups.get(gk) ?? [])];
    const have = [...(lGroups.get(gk) ?? [])];
    for (let i = want.length - 1; i >= 0; i--) {
      const j = have.findIndex((l) => l.content === want[i].content);
      if (j === -1) continue;
      if (!sameSettings(want[i], have[j])) updates.push({ id: have[j].id, record: want[i] });
      want.splice(i, 1);
      have.splice(j, 1);
    }
    while (want.length && have.length) updates.push({ id: have.shift().id, record: want.shift() });
    for (const d of want) creates.push(d);
    for (const l of have) deletes.push({ id: l.id, record: l });
  }
  return { creates, updates, deletes };
}

// --- I/O (only runs when executed directly, not when imported by tests) -----
async function main() {
  const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
  const APPLY = process.env.APPLY === "true";
  const ALLOW_DELETE = process.env.ALLOW_DELETE === "true";
  if (!TOKEN) { console.error("✗ CLOUDFLARE_API_TOKEN not set"); process.exit(1); }
  if (!ACCOUNT) { console.error("✗ CLOUDFLARE_ACCOUNT_ID not set"); process.exit(1); }

  const cf = async (method, path, body) => {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!j.success) throw new Error(`${method} ${path} → ${JSON.stringify(j.errors)}`);
    return j.result;
  };

  const stateDir = new URL("./state/", import.meta.url);
  const zones = await cf("GET", `/zones?account.id=${ACCOUNT}&per_page=50`);
  const zoneId = Object.fromEntries(zones.map((z) => [z.name, z.id]));

  let nc = 0, nu = 0, nd = 0;
  const files = (await readdir(stateDir)).filter((f) => f.endsWith(".dns.json"));
  if (!files.length) { console.error("✗ no state/*.dns.json"); process.exit(1); }

  for (const f of files) {
    const zone = f.replace(/\.dns\.json$/, "");
    const id = zoneId[zone];
    if (!id) { console.error(`! no live zone for ${zone}; skipping`); continue; }
    const desired = JSON.parse(await readFile(new URL(f, stateDir), "utf8"));
    const live = await cf("GET", `/zones/${id}/dns_records?per_page=500`);
    const { creates, updates, deletes } = planChanges(desired, live);

    for (const d of creates) {
      console.log(`+ create  ${recKey(d)} → ${d.content}`); nc++;
      if (APPLY) await cf("POST", `/zones/${id}/dns_records`, d);
    }
    for (const u of updates) {
      console.log(`~ update  ${recKey(u.record)} → ${u.record.content}`); nu++;
      if (APPLY) await cf("PUT", `/zones/${id}/dns_records/${u.id}`, u.record);
    }
    for (const del of deletes) {
      const guarded = !(APPLY && ALLOW_DELETE);
      console.log(`- delete  ${recKey(del.record)} (${del.record.content})${guarded ? "  [skipped — needs ALLOW_DELETE=true]" : ""}`); nd++;
      if (APPLY && ALLOW_DELETE) await cf("DELETE", `/zones/${id}/dns_records/${del.id}`);
    }
  }

  const mode = APPLY ? (ALLOW_DELETE ? "APPLIED (incl. deletes)" : "APPLIED (deletes skipped)") : "dry-run — set APPLY=true to execute";
  console.log(`\nplan: +${nc} ~${nu} -${nd}   ${mode}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
