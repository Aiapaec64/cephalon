import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnvironment } from './config/env.js';
import { ready } from './events/ready.js';
import { interactionCreate } from './events/interactionCreate.js';
import { logError } from './utils/logError.js';

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid environment configuration.');
    process.exitCode = 1;
    return;
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once(ready.name, ready.execute);
  client.on(interactionCreate.name, interactionCreate.execute);
  client.on(Events.Error, (error) => logError('Discord client error.', error));
  client.on(Events.ShardError, (error) => logError('Discord gateway error.', error));
  const shutdown = (): void => {
    console.log('Cephalon shutting down.');
    client.destroy();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    logError('Discord startup failed. Check the token and network connection.', error);
    client.destroy();
    process.exitCode = 1;
  }
}
await main();
