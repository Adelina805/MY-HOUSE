import type { RegisterSessionResponse, ResumeSessionResponse } from '../_shared/apiContract.ts'
import {
  apiError,
  type ApiResponse,
  createEndpoint,
  type EndpointDeps,
  json,
  rateLimited,
  rpcFailure,
} from '../_shared/http.ts'
import { type CallRpc, decodeRegisterResult, decodeResumeResult } from '../_shared/rpc.ts'
import {
  type Bytes,
  hashSessionToken,
  prepareRegistration,
  recoverSessionToken,
} from '../_shared/sessionToken.ts'
import { parseStartSession } from '../_shared/validation.ts'

/**
 * POST { registrationKey } registers a visit: 201 when created, 200 when a retry of the same key
 * recovered the original visit and token. POST { sessionToken } resumes a visit: 200 or 401.
 */
export function createStartSessionHandler(deps: EndpointDeps): (req: Request) => Promise<Response> {
  return createEndpoint(deps, {
    name: 'start-session',
    method: 'POST',
    parse: parseStartSession,
    handle: ({ input, rpc, networkKey }) =>
      input.kind === 'register'
        ? register(input.registrationKey, rpc, networkKey)
        : resume(input.sessionToken, rpc),
  })
}

async function register(
  registrationKey: Bytes,
  rpc: CallRpc,
  networkKey: () => Promise<string | null>,
): Promise<ApiResponse> {
  const material = await prepareRegistration(registrationKey)
  const outcome = await rpc('register_visitor_session', {
    p_registration_hash: material.registrationHash,
    p_token_hash: material.tokenHash,
    p_token_salt: material.tokenSalt,
    p_network_key: await networkKey(),
  })
  if (!outcome.ok) return rpcFailure(outcome)

  const result = decodeRegisterResult(outcome.data)
  switch (result.status) {
    case 'created': {
      const body: RegisterSessionResponse = {
        status: 'registered',
        replayed: false,
        sessionToken: material.sessionToken,
        visitor: result.visitor,
      }
      return json(201, body)
    }
    case 'replayed': {
      const sessionToken = await recoverSessionToken(registrationKey, result.tokenSalt, result.tokenHash)
      if (!sessionToken) return apiError(500, 'internal_error', { reason: 'replay_token_mismatch' })
      const body: RegisterSessionResponse = {
        status: 'registered',
        replayed: true,
        sessionToken,
        visitor: result.visitor,
      }
      return json(200, body)
    }
    case 'rate_limited':
      return rateLimited(result.retryAfterSeconds)
  }
}

async function resume(sessionToken: Bytes, rpc: CallRpc): Promise<ApiResponse> {
  const outcome = await rpc('resume_visitor_session', {
    p_token_hash: await hashSessionToken(sessionToken),
  })
  if (!outcome.ok) return rpcFailure(outcome)

  const result = decodeResumeResult(outcome.data)
  switch (result.status) {
    case 'resumed': {
      const body: ResumeSessionResponse = { status: 'resumed', visitor: result.visitor }
      return json(200, body)
    }
    case 'invalid_session':
      return apiError(401, 'invalid_session')
    case 'rate_limited':
      return rateLimited(result.retryAfterSeconds)
  }
}
