# MY HOUSE backend (Stage A)

The Supabase backend for the guestbook: visitor sessions, door knocks, gifts given, and the public guestbook page. Stage A is the foundation only:

- The frontend is **not connected**. The site still uses its mock guestbook data, and the visitor experience is unchanged.
- Nothing has been deployed. Everything here runs on the local Supabase stack.

## Layout

| Path | What it is |
| --- | --- |
| `migrations/` | Schema and lockdown, site-total triggers and rebuild, the five API functions with rate limits and cleanup |
| `tests/database/` | pgTAP suites (`supabase test db`) |
| `functions/start-session`, `record-award`, `record-knocks`, `get-guestbook` | The four Edge Functions (`index.ts` wires production dependencies; `handler.ts` holds the logic) |
| `functions/_shared/` | Code shared by the functions: HTTP pipeline, validation, CORS, session tokens, RPC client, prize catalog, guestbook read protection |
| `functions/_shared/apiContract.ts` | Request and response types, re-exported to the frontend by `src/data/apiContract.ts` |
| `functions/_shared/prizeCatalog.generated.ts` | Generated from `src/data/prizes.ts`; do not edit by hand |
| `functions/tests/unit/`, `functions/tests/integration/` | Deno tests |
| `functions/tests/staging/ipHeaderTrust.ts` | Opt-in check, never run by the test scripts (see [Per-network limits](#per-network-limits)) |

## Local setup

1. Install the tools and start Docker Desktop:
   ```sh
   brew install supabase/tap/supabase deno
   ```
2. Create the functions' local secrets file. It is gitignored. It allows the Vite dev and preview origins and leaves `CLIENT_IP_HEADER` unset:
   ```sh
   cp supabase/functions/.env.example supabase/functions/.env
   ```
3. Start the stack and apply the migrations. Studio, postgres-meta, and imgproxy are optional; leaving them out saves memory.
   ```sh
   supabase start -x studio,postgres-meta,imgproxy
   npm run db:reset
   ```

`supabase status` prints the local URLs and the local development keys. They are well-known defaults for local use. Do not copy them into any file.

## Tests

| Command | What it runs | Needs the local stack |
| --- | --- | --- |
| `npm run test:db` | pgTAP: schema, privileges, registration, awards, knocks, rate limits, cleanup, guestbook, rebuild | yes |
| `npm run test:functions` | Deno unit tests: tokens, validation, CORS, client IP parsing, read protection, catalog drift, the handlers with a fake database | no |
| `npm run test:integration` | Deno tests through the whole chain: gateway → Edge Function → `@supabase/server` → PostgREST → SECURITY DEFINER function → Postgres | yes |

The integration tests read URLs and keys from `supabase status` at run time, keep them in memory only, and refuse to run against anything but `localhost`. They delete all guestbook data in the local database before each test. They cover:

- **Flows:** a visit through all four functions and all five RPCs. Responses are scanned for leaked tokens, keys, hashes, and session ids.
- **Lost registration responses:** a response lost in flight, a retry while the first attempt is still running, 8 parallel copies, a retry after the token's first use, a retry after 10 minutes, and a retry after a 429.
- **Concurrency:** parallel registrations, knocks, and awards, including a stress run against repeated stats rebuilds.
- **Rebuild under concurrent writes:** lock interleavings on real parallel connections, isolation levels, the lock timeout, and a randomized writers-plus-rebuilds run.
- **Rate limits:** 429s with `Retry-After`, nothing recorded when refused, exactly-once success on retry, and forged IP headers.
- **Guestbook:** empty state, pagination walk, input bounds, cache freshness, and public fields only.
- **Lockdown:** the Data API and GraphQL with the publishable and secret keys, the functions' key and origin checks, and body limits.

The rebuild tests were also checked against a deliberately broken rebuild: with its table lock removed, the interleaving tests, the randomized run, and the HTTP stress test all fail.

## Environment variables

**Edge Functions** (set with `supabase secrets set` when hosted; read from `supabase/functions/.env` locally):

| Name | Meaning |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated exact origins, for example `https://example.com,https://www.example.com`. Browser requests from any other origin get 403. If unset, every browser origin is refused. Requests without an `Origin` header are allowed, because CORS is not authentication. |
| `CLIENT_IP_HEADER` | Unset by default. Names a header that carries the real client address and turns on the per-network limits. `x-forwarded-for` and `forwarded` are always refused, because clients can add entries to them. Any other header, `x-real-ip` included, is forgeable unless the platform overwrites it, so set this only after the [trust check](#per-network-limits) passes for that header. |

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and `SUPABASE_SECRET_KEYS` are provided by the Supabase runtime. Never set them yourself, and never put the secret key in any `VITE_` variable.

**Frontend** (Stage B; see the root `.env.example`): `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Everything prefixed `VITE_` is bundled into public JavaScript, so it may only ever hold the project URL and the publishable key.

## Data model and lockdown

| Table | Contents |
| --- | --- |
| `public.visitor_sessions` | One row per visit: public `visitor_number`, server-chosen `alias`, `started_at`, `last_active_at`, `knock_count` |
| `public.prize_awards` | One row per gift: client-generated award `id`, `prize_id`, `object_name`, `adjective`, `location`, `awarded_at` |
| `public.site_stats` | The single totals row: `visitor_count`, `gifts_given`, `door_knocks` |
| `private.session_credentials` | SHA-256 hashes of session tokens, plus registration material that is cleared after first use |
| `private.rate_limit_buckets` | Fixed-window counters |

- Every table has RLS enabled with no policies, and every table, sequence, and `private` schema privilege is revoked from `anon`, `authenticated`, and `service_role`. The Data API and GraphQL therefore expose nothing, whichever key is used.
- The only way in is the five `SECURITY DEFINER` functions: `register_visitor_session`, `resume_visitor_session`, `record_prize_award`, `record_knocks`, and `get_guestbook_page`. Only `service_role` may execute them, and only the Edge Functions hold the secret key that maps to it.
- Raw session tokens and registration keys are never stored or logged. Function logs record only the function name, status, SQLSTATE, and an internal reason code.

## API

All functions are called at `<SUPABASE_URL>/functions/v1/<name>` with the publishable key in the `apikey` header. Bodies are JSON (2 KB maximum), and unknown fields are rejected. Session tokens travel only in request and response bodies, never in URLs.

| Function | Request | Success |
| --- | --- | --- |
| `start-session` | `POST { registrationKey }` | `201` new visit, or `200` with `replayed: true` for a retry of the same key: `{ status: 'registered', replayed, sessionToken, visitor }` |
| `start-session` | `POST { sessionToken }` | `200 { status: 'resumed', visitor }` |
| `record-knocks` | `POST { sessionToken, totalKnocks }` | `200 { knockCount, accepted }` |
| `record-award` | `POST { sessionToken, awardId, prizeId, adjective, location }` | `201 { award, duplicate: false }`, or `200 { award, duplicate: true }` for a retry |
| `get-guestbook` | `GET ?limit=1..50&cursor=<nextCursor>` (limit defaults to 20; omit the cursor for the first page) | `200 { stats, entries, nextCursor }`, newest first; `nextCursor` is `null` on the last page |

`visitor` is `{ visitorNumber, alias, knockCount, startedAt }`. A guestbook entry is `{ awardId, visitorNumber, alias, prizeId, objectName, adjective, location, awardedAt }`, and `stats` is `{ visitorCount, giftsGiven, doorKnocks }`. The exact types are in `functions/_shared/apiContract.ts`.

Errors are `{ error: { code, message, retryAfterSeconds? } }`:

| Status | Code | What the client should do |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_cursor` | Fix the request. For `invalid_cursor`, start again from the first page. |
| 401 | `invalid_api_key` | Configuration problem; do not retry. |
| 401 | `invalid_session` | The session expired or is unknown: register a new visit. |
| 403 | `origin_not_allowed` | Add the origin to `ALLOWED_ORIGINS`. |
| 405, 413, 415 | `method_not_allowed`, `payload_too_large`, `unsupported_media_type` | Client bug; do not retry. |
| 409 | `award_id_conflict` | The award id was reused for a different gift (client bug). |
| 422 | `invalid_prize` | The prize, adjective, and location combination is not in the catalog (client catalog out of date). |
| 429 | `rate_limited` | Nothing was recorded. Wait `Retry-After` seconds, then send the **identical** request again. |
| 500 | `server_misconfigured`, `internal_error` | Retrying the identical request is safe, but may fail again. |
| 503 | `busy` | Retry after `Retry-After` seconds. |

Nothing is retried automatically by the server. A failed request is not queued or recovered; the client decides whether to retry. Retrying the identical request never counts anything twice: a gift is keyed by its `awardId`, knocks are reported as a cumulative `totalKnocks`, and a registration is keyed by its `registrationKey` for 10 minutes (see below).

## Sessions and registration

A registration is retry-safe without letting any public identifier unlock a session:

1. For each new visit, the browser generates a secret 32-byte `registrationKey` (base64url, 43 characters) and keeps it until it receives a response.
2. The function derives everything from it: `registrationHash = SHA-256(key)`, a random 32-byte salt, `sessionToken = HMAC-SHA-256(salt, key)`, and `tokenHash = SHA-256(token)`. The database stores only the hashes and the salt, under a per-key advisory lock.
3. If the response is lost, the browser retries with the same key. Within 10 minutes, and until the token is first used, the database returns the stored salt and token hash. The function re-derives the token, checks it against the hash in constant time, and returns the same visit and token (`200`, `replayed: true`).
4. The first authenticated use of the token (resume, knocks, or award) clears the registration hash and salt. From then on, the key can no longer recover the token, and a retry with it creates a new visit.

Visitor numbers, aliases, and award ids are public and never unlock anything. A session token is valid for 24 hours after the session's last activity and at most 7 days in total. After that, the visitor registers again and gets a new visitor number and alias. The visit itself stays counted. Aliases come from a fixed server-side list; clients cannot choose them.

## Rate limits

All limits are all-or-nothing: a refused request records nothing and returns `429` with `Retry-After`.

| Limit | Value |
| --- | --- |
| Authenticated calls per session | 120 per minute |
| New gifts per session | 30 per 10 minutes |
| New visitors, site-wide | 300 per minute |
| New gifts, site-wide | 300 per minute |
| Accepted knock increments, site-wide | 30,000 per minute |
| Knocks per session | at most 30 plus 1 per second since the session started, and never more than 5,000 |
| New visitors per network (only with `CLIENT_IP_HEADER`) | 30 per 10 minutes |
| New gifts per network (only with `CLIENT_IP_HEADER`) | 60 per 10 minutes |

The values live in `private.rate_limit_policy()`. Change them with a new migration.

`get-guestbook` needs no session, so it is protected independently of IP addresses. Each function instance caches pages for 5 seconds (first page) or 60 seconds (later pages), merges concurrent identical reads, and allows at most 20 database reads per second. Beyond that budget it serves the last cached copy (up to 5 minutes old) or returns `503 busy` with `Retry-After: 1`. Responses carry `Cache-Control: public, max-age=5` (first page) or `max-age=60`.

## Site totals: triggers, rebuild, and locking

Row triggers keep `public.site_stats` exact in the same transaction as each change: visitors inserted or deleted, `knock_count` updates, and gifts inserted or deleted. Deleting rows for moderation therefore corrects the totals automatically:

```sql
delete from public.prize_awards where id = '<award id>';
-- A visitor can be deleted once their gifts are gone (gifts block the delete).
delete from public.visitor_sessions where visitor_number = 123;
```

`private.rebuild_site_stats()` recomputes the totals from the tables. It is a safety net, for example after a bulk load with triggers disabled. Run it as `postgres` in the SQL editor:

```sql
select private.rebuild_site_stats();  -- returns {"before": {...}, "after": {...}}
```

`TRUNCATE` of either table rebuilds automatically.

How it stays correct under concurrent writes:

- It must run under READ COMMITTED; it raises SQLSTATE `25000` otherwise. Under REPEATABLE READ or SERIALIZABLE, its snapshot would be taken before it acquires the lock, so it could miss writes that committed while it waited.
- It takes an `EXCLUSIVE` lock on `site_stats` only. In-flight writers hold `ROW EXCLUSIVE` on that table through their triggers, so the rebuild waits for them to commit and then counts their rows. New writers wait for the rebuild to finish, then add their own change to the rebuilt row. Plain reads (`ACCESS SHARE`) are never blocked.
- `lock_timeout` is 5 seconds: if it cannot get the lock in time, it fails with `55P03` and changes nothing.
- Every API function takes locks in one documented order, with `site_stats` always last, so a rebuild cannot deadlock with them.

## Maintenance

`private.cleanup_expired_data()` deletes expired credentials, clears registration material older than 10 minutes, and drops stale rate-limit buckets. Visits and gifts are kept. It is safe to run at any time as `postgres`:

```sql
select private.cleanup_expired_data();
```

Expired sessions are rejected whether or not the cleanup has run. To schedule it on a hosted project, enable the `pg_cron` extension, then:

```sql
select cron.schedule('my-house-cleanup', '17 * * * *', 'select private.cleanup_expired_data()');
```

## Prize catalog

`record-award` accepts only prize, adjective, and location combinations from `functions/_shared/prizeCatalog.generated.ts`, and takes the object name from the catalog rather than the client. After editing `src/data/prizes.ts`, regenerate the catalog:

```sh
npm run catalog:generate
```

`npm run test:functions` fails if the generated file is stale.

Prize IDs are stored with every gift, so treat them as permanent once gifts exist. Add new IDs rather than renaming live ones; if a rename is unavoidable, migrate the stored rows in the same release. Stage A renamed `japanese-naurical-glass-orb` to `japanese-nautical-glass-orb` while no gifts existed.

## Local and hosted differences

- **CORS:** the local API gateway adds `Access-Control-Allow-Origin: *` to function responses and answers preflight requests itself. The functions still return 403 for origins outside `ALLOWED_ORIGINS`. On hosted projects, the functions' own CORS headers apply; this has not been verified yet.
- **Function instances:** the guestbook cache and read budget are per instance. Locally there is effectively one instance (`policy = "per_worker"`); a hosted project may run several, each with its own budget.
- **Runtime keys:** the local CLI provides `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and `SUPABASE_SECRET_KEYS`. On hosted projects, confirm after the first deploy: a missing key shows up as `500 server_misconfigured`.

## Per-network limits

The per-network limits are off: every IP header that reaches a function is assumed to be forgeable until proven otherwise. To find out whether a header can be trusted, run the opt-in check against a **non-production** project you are authorized to test:

1. On that project, set `CLIENT_IP_HEADER` to the candidate header, for example `cf-connecting-ip`.
2. Run the first phase. It sends 31 registrations, each forging a different address in the candidate header and in `X-Forwarded-For` and `X-Real-IP`:
   ```sh
   STAGING_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1 \
   STAGING_PUBLISHABLE_KEY=<publishable key> \
   STAGING_ORIGIN=<an allowed origin> \
   CANDIDATE_HEADER=cf-connecting-ip \
   CONFIRM_NON_PRODUCTION=yes \
   deno run --allow-env --allow-net supabase/functions/tests/staging/ipHeaderTrust.ts first-network
   ```
   - If all 31 succeed, the header is spoofable. Leave `CLIENT_IP_HEADER` unset.
   - If only the 31st is limited, the forged values were ignored. Continue.
3. From a different network (for example, a phone hotspot), and before the deadline the first phase prints, run the same command with `FIRST_NETWORK_DEADLINE=<printed value>` and `second-network`.
   - If that registration succeeds, the header carries the real client address. It is safe to set it in production.
   - If it is limited, the header is missing and everyone shares one bucket. Leave `CLIENT_IP_HEADER` unset.
4. Delete the test visitors the script lists. The totals adjust automatically:
   ```sql
   delete from public.visitor_sessions where visitor_number = any('{<listed numbers>}'::bigint[]);
   select private.rebuild_site_stats();  -- "before" and "after" should match
   ```

## Deploying (manual; not done in Stage A)

Each of these steps needs the project owner's explicit go-ahead. None has been run.

1. Create a free Supabase project. Do not enable paid add-ons.
2. Link it and apply the migrations:
   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push
   ```
3. Set the function secrets. Use exact origins only. Set `CLIENT_IP_HEADER` only if the trust check passed.
   ```sh
   supabase secrets set ALLOWED_ORIGINS=https://<site domain>
   ```
4. Deploy the functions. `verify_jwt = false` comes from `config.toml`; the functions check the publishable key themselves.
   ```sh
   supabase functions deploy start-session record-award record-knocks get-guestbook
   ```
5. Smoke test `get-guestbook` and a registration with the publishable key and an allowed `Origin`.
6. In the Security Advisor, "RLS enabled, no policy" findings are expected: no policies is intentional.
7. Turn on usage alerts or a spend cap, and optionally schedule the cleanup.

## Beginning Stage B

Stage B connects the frontend. The plan for it:

1. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env.local` (copied from the root `.env.example`). For local work, use the values `supabase status` prints. In Vercel, use the hosted project's values, and only once a deploy has been authorized.
2. Write one small fetch-based client module (no new dependencies), typed with `src/data/apiContract.ts`, that never blocks or alters the experience when the backend is slow or down:
   - **On page load:** resume the session token kept in `sessionStorage` (aliases stay stable for the browser session). If there is none, or the resume returns 401, register with a `registrationKey` that is also kept in `sessionStorage` until a response arrives. This way a reload or retry within 10 minutes recovers the same visit.
   - **Knocks:** count only accepted knocks in the interactive door-knocking phase. Those are the increments of `knockCount` in `handleKnock` in `src/core/experienceController.ts` (idle state, not busy, not transitioning). Rapid consecutive knocks count. Clicks during videos or transitions do not count, including `playKnockFeedbackOnly` during the greeting. `knockCount` resets each round, so keep a separate cumulative counter for the session, and report the total with `record-knocks`, debounced.
   - **Gifts:** generate an `awardId` with `crypto.randomUUID()` once per prize reveal, keep it until acknowledged, and send the catalog's `prizeId`, `adjective`, and `location`.
   - **Retries:** explicit and bounded. Retry 429 and 503 after `Retry-After`. Retry network failures and 5xx a few times with the identical request. Never retry other 4xx responses. On 401 `invalid_session`, register again.
3. Replace the mock guestbook reads with `get-guestbook`, following the Stage B plan.
4. Run the full test suite, then check the experience by hand against the local stack before anything is deployed.
