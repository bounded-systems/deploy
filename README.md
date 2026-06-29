# deploy — bounded.tools DNS-as-code

Desired DNS for **bounded.tools** (incl. `trust.bounded.tools`), applied to Cloudflare with a
reviewer-gated, OIDC-brokered workflow. **Public on purpose:** DNS records are publicly resolvable
anyway, so nothing here is secret — and a public repo gets GitHub's **required-reviewers**
environment protection for free (it needs GitHub Enterprise on private repos).

## How it works

- [`state/bounded.tools.dns.json`](./state/) is the **source of truth** for the zone's DNS. Edit
  it via PRs.
- [`apply.mjs`](./apply.mjs) reconciles live Cloudflare DNS toward that state. **Dry-run by
  default**; a real apply needs `apply=true`, and deletes also need `allow_delete=true`.
- The diff is **value-aware** — it reconciles each `(type, name)` group by content, so multi-value
  records (dual MX, multiple TXT) are handled correctly. Covered by [`apply.test.mjs`](./apply.test.mjs).

## Applying (`.github/workflows/apply.yml`)

1. **Dispatch the `apply` workflow.** A plain run is a **dry-run** — it prints the plan and changes
   nothing.
2. **To execute,** dispatch with `apply=true`. That run enters the **`cloudflare-apply`
   Environment**, which is configured with **required reviewers** — so it **pends for approval**.
3. On approval, the run proceeds. No Cloudflare secret is stored: a short-lived, zone-scoped token
   is **minted just-in-time by the OIDC broker**, which grants `DNS:Edit` *only* because the
   approved run carries the `environment=cloudflare-apply` claim. A dry-run gets read-only.

## Setup (one-time)

- **Environment:** Settings → Environments → create **`cloudflare-apply`** → add **Required
  reviewers** (free on a public repo).
- **Repo variables:**
  - `CF_BROKER_URL` — this zone's [cf-oidc-token-broker](https://github.com/bounded-systems/cf-oidc-token-broker)
    endpoint, pinned to `bounded-systems/deploy` and the `bounded.tools` zone.
  - `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account.
  - `GH_AUDIENCE` *(optional)* — the OIDC audience the broker expects (default `cf-oidc-token-broker`).
- **Broker config** (deploy a broker instance for this repo): `GH_OWNER=bounded-systems`,
  `GH_REPOSITORY=bounded-systems/deploy`, `EDIT_WORKFLOW_REF=bounded-systems/deploy/.github/workflows/apply.yml@refs/heads/main`,
  `EDIT_ENVIRONMENT=cloudflare-apply`, and `CF_ZONE_IDS` = the `bounded.tools` zone id.

## Note

`apply.mjs` doesn't yet send MX `priority` (the desired state doesn't capture it) — fine for the
current records, but capture priority before adding/creating MX records.
