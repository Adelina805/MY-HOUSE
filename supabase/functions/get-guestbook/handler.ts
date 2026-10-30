import {
  apiError,
  createEndpoint,
  type EndpointDeps,
  rateLimited,
  rpcFailure,
} from '../_shared/http.ts'
import { type PageLoad, ReadProtection } from '../_shared/readProtection.ts'
import { decodeGuestbookResult } from '../_shared/rpc.ts'
import { parseGuestbookQuery } from '../_shared/validation.ts'

/**
 * GET ?limit=1..50&cursor=<awardId>: stats plus one page of entries, newest first. Served through
 * a per-isolate cache and database read budget, so heavy public traffic cannot turn into
 * unbounded database load.
 */
export function createGetGuestbookHandler(
  deps: EndpointDeps,
  protection = new ReadProtection({ now: deps.now }),
): (req: Request) => Promise<Response> {
  return createEndpoint(deps, {
    name: 'get-guestbook',
    method: 'GET',
    parse: parseGuestbookQuery,
    async handle({ input, rpc, networkKey }) {
      const network = await networkKey()
      if (network !== null) {
        const retryAfterSeconds = protection.takeNetworkRequest(network)
        if (retryAfterSeconds > 0) return rateLimited(retryAfterSeconds)
      }

      const outcome = await protection.getPage(input.limit, input.cursor, async (): Promise<PageLoad> => {
        const result = await rpc('get_guestbook_page', { p_limit: input.limit, p_cursor: input.cursor })
        if (!result.ok) {
          const response = rpcFailure(result)
          return { ok: false, response, retryable: response.status === 503 }
        }
        const page = decodeGuestbookResult(result.data)
        if (page.status === 'invalid_cursor') {
          return { ok: false, response: apiError(400, 'invalid_cursor'), retryable: false }
        }
        return { ok: true, json: JSON.stringify(page.page) }
      })

      switch (outcome.kind) {
        case 'busy':
          return apiError(503, 'busy', { retryAfterSeconds: 1, reason: 'read_budget_exhausted' })
        case 'failed':
          return outcome.response
        default:
          return {
            status: 200,
            rawBody: outcome.json,
            headers: { 'cache-control': `public, max-age=${outcome.maxAgeSeconds}` },
          }
      }
    },
  })
}
