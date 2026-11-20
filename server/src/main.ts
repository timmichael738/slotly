import { buildApp } from './app.js';
import { createPool, migrate } from './db.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = createPool(databaseUrl);
await migrate(pool);

const app = await buildApp({ pool, secureCookies: process.env.NODE_ENV === 'production' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
