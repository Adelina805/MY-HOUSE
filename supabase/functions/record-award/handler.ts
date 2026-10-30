import type { RecordAwardResponse } from '../_shared/apiContract.ts'
import {
  apiError,
  createEndpoint,
  type EndpointDeps,
  json,
  rateLimited,
  rpcFailure,
} from '../_shared/http.ts'
import { resolveAward } from '../_shared/prizeCatalog.ts'
import { decodeAwardResult } from '../_shared/rpc.ts'
import { hashSessionToken } from '../_shared/sessionToken.ts'
import { parseRecordAward } from '../_shared/validation.ts'

/**
 * POST { sessionToken, awardId, prizeId, adjective, location }: 201 when recorded, 200 when a retry
 * matched the recorded award, 409 when the award id was used for a different award, 422 when the
 * combination is not in the catalog.
 */
export function createRecordAwardHandler(deps: EndpointDeps): (req: Request) => Promise<Response> {
  return createEndpoint(deps, {
    name: 'record-award',
    method: 'POST',
    parse: parseRecordAward,
    async handle({ input, rpc, networkKey }) {
      const award = resolveAward(input.prizeId, input.adjective, input.location)
      if (!award) return apiError(422, 'invalid_prize')

      const outcome = await rpc('record_prize_award', {
        p_token_hash: await hashSessionToken(input.sessionToken),
        p_award_id: input.awardId,
        p_prize_id: award.prizeId,
        p_object_name: award.objectName,
        p_adjective: award.adjective,
        p_location: award.location,
        p_network_key: await networkKey(),
      })
      if (!outcome.ok) return rpcFailure(outcome)

      const result = decodeAwardResult(outcome.data)
      switch (result.status) {
        case 'created':
        case 'duplicate': {
          const duplicate = result.status === 'duplicate'
          const body: RecordAwardResponse = { award: result.award, duplicate }
          return json(duplicate ? 200 : 201, body)
        }
        case 'conflict':
          return apiError(409, 'award_id_conflict')
        case 'invalid_session':
          return apiError(401, 'invalid_session')
        case 'rate_limited':
          return rateLimited(result.retryAfterSeconds)
      }
    },
  })
}
