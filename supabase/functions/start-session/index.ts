import { productionDeps } from '../_shared/http.ts'
import { createStartSessionHandler } from './handler.ts'

export default { fetch: createStartSessionHandler(productionDeps()) }
