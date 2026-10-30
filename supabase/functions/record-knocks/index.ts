import { productionDeps } from '../_shared/http.ts'
import { createRecordKnocksHandler } from './handler.ts'

export default { fetch: createRecordKnocksHandler(productionDeps()) }
