import { createOfficeApp } from './app.js'
import { loadConfig } from './config.js'
import { MemorySessionStore, RedisSessionStore, type SessionStore } from './store.js'

async function main() {
  const config = loadConfig()
  let store: SessionStore
  const redisUrl = process.env.OFFICE_REDIS_URL
  if (redisUrl) {
    store = await RedisSessionStore.connect(redisUrl)
    console.log('fynixOffice session store: redis')
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: OFFICE_REDIS_URL is unset in production; using in-memory sessions (not multi-instance safe)',
    )
    store = new MemorySessionStore()
  } else {
    store = new MemorySessionStore()
  }

  const app = createOfficeApp({ config, store })
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`fynixOffice server listening on ${config.baseUrl} (port ${config.port})`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
