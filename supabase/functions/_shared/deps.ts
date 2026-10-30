// Third-party dependencies, pinned to exact versions. Change versions only here, and only after
// re-checking the APIs used: verifyAuth's { data, error } result and AuthError.status, and
// createAdminClient throwing when SUPABASE_URL or the secret key is missing.
export { createAdminClient, verifyAuth } from 'npm:@supabase/server@1.9.2/core'
export type { VerifyAuthOptions } from 'npm:@supabase/server@1.9.2/core'
import 'npm:@supabase/supabase-js@2.118.0'
