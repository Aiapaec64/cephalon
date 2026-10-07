import { Events, MessageFlags, type Interaction } from 'discord.js';
import { commands } from '../commands/index.js';
import { logError } from '../utils/logError.js';
import { handleGoalButton } from '../components/goalButtons.js';
import { GoalInputError } from '../services/goalLogic.js';

export const interactionCreate = {
  name: Events.InteractionCreate as const,
  async execute(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    if (interaction.isButton() && !interaction.customId.startsWith('goal:')) return;
    try {
      if (interaction.isButton()) {
        await handleGoalButton(interaction);
        return;
      }
      const command = commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'This command is unavailable.', flags: MessageFlags.Ephemeral });
        return;
      }
      await command.execute(interaction);
    } catch (error) {
      const label = interaction.isChatInputCommand() ? `Command /${interaction.commandName}` : 'Goal button';
      if (!(error instanceof GoalInputError)) logError(`${label} failed.`, error);
      const age = Date.now() - interaction.createdTimestamp;
      if (age >= 15 * 60 * 1000) return;
      if (!interaction.deferred && !interaction.replied && age >= 3000) return;
      try {
        const isGoal = interaction.isButton() || interaction.commandName === 'goal';
        const content = error instanceof GoalInputError ? error.message : isGoal
          ? 'Une erreur est survenue pendant cette action. Réessaie dans un instant.'
          : 'An error occurred while executing this command.';
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
