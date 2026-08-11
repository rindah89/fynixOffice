export interface SessionStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
}

/** In-memory store for tests and single-process local dev. */
export class MemorySessionStore implements SessionStore {
  private readonly values = new Map<string, { value: unknown; expiresAt: number }>()

  async get<T>(key: string): Promise<T | null> {
    const item = this.values.get(key)
    if (!item || item.expiresAt <= Date.now()) {
      this.values.delete(key)
      return null
    }
    return item.value as T
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

type RedisClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
  del(key: string): Promise<unknown>
  connect(): Promise<unknown>
  quit(): Promise<unknown>
}

/** Redis-backed store for multi-instance Docker production (mirrors HQ keying). */
export class RedisSessionStore implements SessionStore {
  private constructor(private readonly client: RedisClient) {}

  static async connect(url: string): Promise<RedisSessionStore> {
    // Dynamic import so tests/dev without redis stay light
    const { createClient } = await import('redis')
    const client = createClient({ url }) as unknown as RedisClient & {
      on: (event: string, cb: (err: Error) => void) => void
    }
    client.on('error', (err) => console.error('[office-redis]', err.message))
    await client.connect()
    return new RedisSessionStore(client)
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(`office:${key}`)
    return raw ? (JSON.parse(raw) as T) : null
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(`office:${key}`, JSON.stringify(value), { EX: ttlSeconds })
  }

  async delete(key: string): Promise<void> {
    await this.client.del(`office:${key}`)
  }
}
