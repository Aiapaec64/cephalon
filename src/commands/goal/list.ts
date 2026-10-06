import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { goalContext } from './context.js';
import { goalService } from '../../services/goalService.js';
import { listPayload } from '../../services/goalRecap.js';

export async function listGoals(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = goalContext(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(listPayload(await goalService().list(context.guildId, context.actorId)));
}
