import { Events, MessageFlags, type Interaction } from 'discord.js';
import { commands } from '../commands/index.js';
import { logError } from '../utils/logError.js';

export const interactionCreate = {
  name: Events.InteractionCreate as const,
  async execute(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    try {
      const command = commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'This command is unavailable.', flags: MessageFlags.Ephemeral });
        return;
      }
      await command.execute(interaction);
    } catch (error) {
      logError(`Command /${interaction.commandName} failed.`, error);
      const age = Date.now() - interaction.createdTimestamp;
      if (age >= 15 * 60 * 1000) return;
      if (!interaction.deferred && !interaction.replied && age >= 3000) return;
      try {
        const content = 'An error occurred while executing this command.';
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content });
        } else if (interaction.replied) {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        logError('Failed to send command error response.', replyError);
      }
    }
  },
};
