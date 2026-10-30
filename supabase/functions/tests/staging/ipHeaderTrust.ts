/**
 * Opt-in check of whether a client-IP header can be trusted for the per-network rate limits.
 * Never part of `deno test` or the npm scripts. Run it only against a non-production project you
 * are authorized to test, after setting that project's CLIENT_IP_HEADER secret to the candidate.
 * The full procedure and the cleanup SQL are in supabase/README.md ("Per-network limits").
 *
 *   STAGING_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1 \
 *   STAGING_PUBLISHABLE_KEY=<that project's publishable key> \
 *   STAGING_ORIGIN=<an origin listed in that project's ALLOWED_ORIGINS> \
 *   CANDIDATE_HEADER=<the header named in CLIENT_IP_HEADER> \
 *   CONFIRM_NON_PRODUCTION=yes \
 *   deno run --allow-env --allow-net supabase/functions/tests/staging/ipHeaderTrust.ts first-network
 *
 * Then, from a different network and within the deadline it prints, the same command with
 * `second-network` and FIRST_NETWORK_DEADLINE set to the printed value.
 */
import { encodeBase64Url, randomSecret } from '../../_shared/sessionToken.ts'

const NETWORK_REGISTRATION_LIMIT = 30
/** Leaves a margin inside the 10-minute network_registrations window. */
const SECOND_PHASE_WINDOW_MS = 8 * 60 * 1000

function fail(message: string): never {
  console.error(message)
  Deno.exit(2)
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) fail(`Missing ${name}.`)
  return value
}

const phase = Deno.args[0]
if (phase !== 'first-network' && phase !== 'second-network') {
  fail('Usage: ipHeaderTrust.ts first-network | second-network')
}
if (Deno.env.get('CONFIRM_NON_PRODUCTION') !== 'yes') {
  fail('Refusing to run: set CONFIRM_NON_PRODUCTION=yes to confirm the target is a non-production project you are authorized to test.')
}
const functionsUrl = requireEnv('STAGING_FUNCTIONS_URL').replace(/\/+$/, '')
const publishableKey = requireEnv('STAGING_PUBLISHABLE_KEY')
const origin = requireEnv('STAGING_ORIGIN')
const candidate = requireEnv('CANDIDATE_HEADER').toLowerCase()
if (new URL(functionsUrl).protocol !== 'https:') fail('STAGING_FUNCTIONS_URL must be the https URL of a hosted project.')
if (!publishableKey.startsWith('sb_publishable_')) fail('STAGING_PUBLISHABLE_KEY must be a publishable key, never a secret key.')

async function register(forgedIp: string | null): Promise<{ status: number; visitorNumber: number | null }> {
  const headers = new Headers({ apikey: publishableKey, origin, 'content-type': 'application/json' })
  if (forgedIp !== null) {
    headers.set(candidate, forgedIp)
    headers.set('x-forwarded-for', forgedIp)
    headers.set('x-real-ip', forgedIp)
  }
  const response = await fetch(`${functionsUrl}/start-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ registrationKey: encodeBase64Url(randomSecret()) }),
  })
  const body = await response.json().catch(() => null)
  // The body also carries a session token; it is dropped here and never printed.
  return { status: response.status, visitorNumber: body?.visitor?.visitorNumber ?? null }
}

function printCleanup(visitorNumbers: number[]): void {
  if (visitorNumbers.length === 0) return
  console.log(`\nVisitors created by this check (delete them afterwards, see supabase/README.md):`)
  console.log(`  {${visitorNumbers.join(',')}}`)
}

if (phase === 'first-network') {
  const deadline = new Date(Date.now() + SECOND_PHASE_WINDOW_MS).toISOString()
  const results = []
  for (let i = 1; i <= NETWORK_REGISTRATION_LIMIT + 1; i += 1) results.push(await register(`203.0.113.${i}`))
  const statuses = results.map((r) => r.status)
  const created = statuses.filter((s) => s === 201).length
  console.log(`Statuses: ${statuses.join(' ')}`)
  printCleanup(results.flatMap((r) => (r.visitorNumber === null ? [] : [r.visitorNumber])))

  if (statuses.some((s) => s !== 201 && s !== 429)) {
    console.log('\nInconclusive: unexpected statuses. Leave CLIENT_IP_HEADER unset.')
  } else if (created === NETWORK_REGISTRATION_LIMIT + 1) {
    console.log(`\nAll ${created} registrations succeeded: each forged value got its own bucket (or the layer is off).`)
    console.log(`The header is spoofable. Leave CLIENT_IP_HEADER unset.`)
  } else if (created === NETWORK_REGISTRATION_LIMIT && statuses.at(-1) === 429) {
    console.log('\nThe 31st registration was limited, so the forged values were ignored.')
    console.log('Next, from a different network (for example a phone hotspot), before the deadline:')
    console.log(`  FIRST_NETWORK_DEADLINE=${deadline} <same variables> deno run ... second-network`)
  } else {
    console.log('\nInconclusive: this network had already used part of its window.')
    console.log('Wait 10 minutes and run first-network again. Leave CLIENT_IP_HEADER unset meanwhile.')
  }
} else {
  const deadline = Date.parse(requireEnv('FIRST_NETWORK_DEADLINE'))
  if (Number.isNaN(deadline)) fail('FIRST_NETWORK_DEADLINE must be the timestamp printed by first-network.')
  if (Date.now() > deadline) {
    fail('Too late: the first network\'s window may have reset, which would make a shared bucket look per-network. Run first-network again.')
  }
  const result = await register(null)
  printCleanup(result.visitorNumber === null ? [] : [result.visitorNumber])
  if (result.status === 201) {
    console.log(`\nA different network got its own bucket: ${candidate} carries the real client address.`)
    console.log(`It is safe to set CLIENT_IP_HEADER=${candidate} in production.`)
  } else if (result.status === 429) {
    console.log(`\nLimited from a different network too: ${candidate} is missing and everyone shares one bucket.`)
    console.log('Leave CLIENT_IP_HEADER unset.')
  } else {
    console.log(`\nInconclusive (status ${result.status}). Leave CLIENT_IP_HEADER unset.`)
  }
}
