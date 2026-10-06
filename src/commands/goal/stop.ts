import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { goalContext, goalIdOption } from './context.js';
import { goalService } from '../../services/goalService.js';

export async function stopGoal(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = goalContext(interaction);
  const id = goalIdOption(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await goalService().stop(id, context.guildId, context.actorId, context.administrator);
  await interaction.editReply(`Objectif #${id} arrêté. Les rappels futurs sont désactivés.`);
}
