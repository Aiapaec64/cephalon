import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnvironment } from './config/env.js';
import { ready } from './events/ready.js';
import { interactionCreate } from './events/interactionCreate.js';
import { logError } from './utils/logError.js';
import { closeDatabase, initializeDatabase } from './db/index.js';
import { goals, goalCheckins } from './db/schema.js';
import { GoalScheduler } from './services/goalScheduler.js';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid environment configuration.');
    process.exitCode = 1;
    return;
  }
  try {
    const { db } = initializeDatabase(env.DATABASE_URL);
    // Fail before Discord login if PostgreSQL is unreachable or migrations are missing.
    await db.select().from(goals).limit(1);
    await db.select().from(goalCheckins).limit(1);
  } catch (error) {
    logError('Database startup failed. Check DATABASE_URL and run npm run db:migrate.', error);
    await closeDatabase();
    process.exitCode = 1;
    return;
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds], rest: { timeout: 15000, retries: 0 } });
  const scheduler = new GoalScheduler(client);
  client.once(ready.name, ready.execute);
  client.once(ready.name, () => scheduler.start());
  client.on(interactionCreate.name, interactionCreate.execute);
  client.on(Events.Error, (error) => logError('Discord client error.', error));
  client.on(Events.ShardError, (error) => logError('Discord gateway error.', error));
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Cephalon shutting down.');
    const deadline = setTimeout(() => { process.exit(1); }, 25000);
    deadline.unref();
    await scheduler.stop();
    client.destroy();
    await closeDatabase();
    clearTimeout(deadline);
  };
  const handleSignal = (): void => { void shutdown().catch((error: unknown) => {
    logError('Cephalon shutdown failed.', error);
    process.exitCode = 1;
  }); };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    logError('Discord startup failed. Check the token and network connection.', error);
    client.destroy();
    await scheduler.stop();
    await closeDatabase();
    process.exitCode = 1;
  }
}
await main();
