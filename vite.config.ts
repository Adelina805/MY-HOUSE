import { defineConfig, type Plugin } from 'vite'

function jwtRole(value: string): string | null {
  const parts = value.split('.')
  if (parts.length !== 3) return null
  try {
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const role = (payload as { role?: unknown } | null)?.role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

function secretProblem(value: string): string | null {
  if (value.includes('sb_secret_')) return 'contains a Supabase secret key'
  if (/^postgres(ql)?:\/\//i.test(value.trim())) return 'is a database connection string'
  const role = jwtRole(value.trim())
  if (role !== null && role !== 'anon') return `is a JWT with the "${role}" role`
  return null
}

/**
 * Vite embeds every VITE_ variable in the public browser bundle. Stop the dev server or build
 * if one of them holds a credential that must stay on the server.
 */
function refuseServerSecrets(): Plugin {
  return {
    name: 'my-house:refuse-server-secrets',
    configResolved(config) {
      const problems = Object.entries(config.env).flatMap(([name, value]) => {
        const problem = typeof value === 'string' ? secretProblem(value) : null
        return problem ? [`${name} ${problem}`] : []
      })
      if (problems.length > 0) {
        throw new Error(
          `Refusing to expose server credentials to the browser bundle:\n  ${problems.join('\n  ')}`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [refuseServerSecrets()],
})
