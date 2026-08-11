import type { OfficeConfig } from './types.js'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OfficeConfig {
  const required = (name: string, fallback?: string) => {
    const value = env[name] || fallback
    if (!value) throw new Error(`${name} is required`)
    return value.replace(/\/$/, '')
  }
  return {
    baseUrl: required('OFFICE_BASE_URL', 'http://localhost:4321'),
    issuer: required('OFFICE_OIDC_ISSUER', 'https://auth.fynixhq.com/realms/fynix'),
    clientId: required('OFFICE_OIDC_CLIENT_ID', 'fynix-office'),
    clientSecret: required('OFFICE_OIDC_CLIENT_SECRET', 'dev-only-change-me'),
    sessionTtlSeconds: Number(env.OFFICE_SESSION_TTL_SECONDS || 28800),
    desktopTxTtlSeconds: Number(env.OFFICE_DESKTOP_TX_TTL_SECONDS || 600),
    port: Number(env.PORT || 4321),
    /** DocFlow/Finance backends mint open tickets with this key (Bearer or X-Office-Service-Key). */
    openServiceKey: env.OFFICE_OPEN_SERVICE_KEY || '',
  }
}
