/**
 * Settings for the local stack, read from `supabase status` when the tests start so that no key or
 * password is ever stored in a file. Refuses to run against anything but the local stack.
 */
export interface LocalStack {
  functionsUrl: string
  restUrl: string
  graphqlUrl: string
  dbUrl: string
  publishableKey: string
  secretKey: string
  /** Legacy anon JWT, used only to prove the functions reject it. */
  anonKey: string
}

/** One of the origins in supabase/functions/.env.example. */
export const ALLOWED_ORIGIN = 'http://localhost:5173'

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])
const LOCAL_DB_PORT = '54322'

async function readLocalStack(): Promise<LocalStack> {
  const projectRoot = decodeURIComponent(new URL('../../../../', import.meta.url).pathname)
  const result = await new Deno.Command('supabase', {
    args: ['status', '--output', 'json'],
    cwd: projectRoot,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!result.success) {
    throw new Error('`supabase status` failed. Start the local stack first: supabase start')
  }
  const status = JSON.parse(new TextDecoder().decode(result.stdout))
  const stack: LocalStack = {
    functionsUrl: status.FUNCTIONS_URL,
    restUrl: status.REST_URL,
    graphqlUrl: status.GRAPHQL_URL,
    dbUrl: status.DB_URL,
    publishableKey: status.PUBLISHABLE_KEY,
    secretKey: status.SECRET_KEY,
    anonKey: status.ANON_KEY,
  }
  for (const [name, value] of Object.entries(stack)) {
    if (typeof value !== 'string' || value === '') throw new Error(`supabase status did not report ${name}`)
  }
  for (const url of [stack.functionsUrl, stack.restUrl, stack.graphqlUrl, stack.dbUrl]) {
    if (!LOCAL_HOSTNAMES.has(new URL(url).hostname)) {
      throw new Error('Refusing to run: integration tests only target the local Supabase stack.')
    }
  }
  if (new URL(stack.dbUrl).port !== LOCAL_DB_PORT) {
    throw new Error(`Refusing to run: the database is not the local stack on port ${LOCAL_DB_PORT}.`)
  }
  return stack
}

export const stack: LocalStack = await readLocalStack()
