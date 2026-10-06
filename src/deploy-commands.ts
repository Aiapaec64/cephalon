import { DiscordAPIError, REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
import { loadEnvironment } from './config/env.js';
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
  try {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: commands.map((command) => command.data.toJSON()),
    });
    console.log(`Registered ${commands.size} guild command(s).`);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 20012) {
      logError(
        'Command registration failed: the token is not authorized for DISCORD_CLIENT_ID. ' +
        'Copy the Application ID from the same Discord application that issued your bot token.',
        error,
      );
    } else {
      logError('Command registration failed. Check credentials, guild access, and network connection.', error);
    }
    process.exitCode = 1;
  }
}
await main();
