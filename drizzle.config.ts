import { defineConfig } from 'drizzle-kit';

// Generation is offline. Connections/credentials belong only in db:migrate.
export default defineConfig({ dialect: 'postgresql', schema: './src/db/schema.ts', out: './migrations' });
