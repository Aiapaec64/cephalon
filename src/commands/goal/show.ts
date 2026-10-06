import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { goalContext, goalIdOption } from './context.js';
import { goalService } from '../../services/goalService.js';
import { recapPayload } from '../../services/goalRecap.js';

export async function showGoal(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = goalContext(interaction);
  const id = goalIdOption(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const service = goalService();
  const goal = await service.get(id, context.guildId);
  await interaction.editReply(recapPayload(goal, await service.checkins(id)));
}
