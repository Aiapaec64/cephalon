import { Collection, type ChatInputCommandInteraction, type SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder, type SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import { ping } from './ping.js';
import { goal } from './goal/index.js';

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export const commands = new Collection<string, Command>();
for (const command of [ping, goal]) {
  const name = command.data.name;
  if (commands.has(name)) throw new Error(`Duplicate command: ${name}`);
  commands.set(name, command);
}
