import { productionDeps } from '../_shared/http.ts'
import { createRecordAwardHandler } from './handler.ts'

export default { fetch: createRecordAwardHandler(productionDeps()) }
