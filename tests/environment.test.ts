import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadDiscordEnvironment, loadEnvironment, validateDatabaseUrl } from '../src/config/env.js';
import { logError } from '../src/utils/logError.js';

test('startup requires DATABASE_URL while command registration stays independent', () => {
  const keys = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'DATABASE_URL'] as const;
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = 'test';
    process.env.DATABASE_URL = '';
    assert.doesNotThrow(loadDiscordEnvironment);
    assert.throws(loadEnvironment, /Missing required environment variable: DATABASE_URL/);
    process.env.DATABASE_URL = 'postgresql://user:password@localhost/cephalon';
    assert.equal(loadEnvironment().DATABASE_URL, process.env.DATABASE_URL);
    for (const key of keys) {
      const value = process.env[key];
      process.env[key] = '';
      assert.throws(loadEnvironment, new RegExp(key));
      process.env[key] = value;
    }
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('database URL errors and logging never reveal credentials', () => {
  for (const value of ['https://user:SECRET@localhost/db', 'postgresql://localhost', 'not-a-url-SECRET']) {
    assert.throws(() => validateDatabaseUrl(value), (error: unknown) => error instanceof Error && !error.message.includes('SECRET'));
  }
  const log = console.error;
  const captured: string[] = [];
  console.error = (value: string) => { captured.push(value); };
  try {
    logError('Database operation failed.', Object.assign(new Error('postgresql://SECRET@host/db'), { code: 'SECRET' }));
    assert.equal(captured[0], 'Database operation failed.');
  } finally { console.error = log; }
});
