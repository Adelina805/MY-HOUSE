import { productionDeps } from '../_shared/http.ts'
import { createGetGuestbookHandler } from './handler.ts'

export default { fetch: createGetGuestbookHandler(productionDeps()) }
