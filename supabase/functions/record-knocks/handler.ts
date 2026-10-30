import type { RecordKnocksResponse } from '../_shared/apiContract.ts'
import {
  apiError,
  createEndpoint,
  type EndpointDeps,
  json,
  rateLimited,
  rpcFailure,
} from '../_shared/http.ts'
import { decodeKnocksResult } from '../_shared/rpc.ts'
import { hashSessionToken } from '../_shared/sessionToken.ts'
import { parseRecordKnocks } from '../_shared/validation.ts'

/**
 * POST { sessionToken, totalKnocks } with the session's cumulative count. Retries and stale totals
 * add nothing. A total the session cap or the site-wide ceiling cannot admit is rejected whole
 * with 429 and nothing is recorded; the client keeps its total and reports it again later.
 */
export function createRecordKnocksHandler(deps: EndpointDeps): (req: Request) => Promise<Response> {
  return createEndpoint(deps, {
    name: 'record-knocks',
    method: 'POST',
    parse: parseRecordKnocks,
    async handle({ input, rpc }) {
      const outcome = await rpc('record_knocks', {
        p_token_hash: await hashSessionToken(input.sessionToken),
        p_total_knocks: input.totalKnocks,
      })
      if (!outcome.ok) return rpcFailure(outcome)

      const result = decodeKnocksResult(outcome.data)
      switch (result.status) {
        case 'ok': {
          const body: RecordKnocksResponse = { knockCount: result.knockCount, accepted: result.accepted }
          return json(200, body)
        }
        case 'invalid_session':
          return apiError(401, 'invalid_session')
        case 'rate_limited':
          return rateLimited(result.retryAfterSeconds)
      }
    },
  })
}
