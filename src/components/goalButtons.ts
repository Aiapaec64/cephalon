import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { parseGoalComponent } from './goalIds.js';
import { goalService } from '../services/goalService.js';
import { GoalInputError } from '../services/goalLogic.js';
import { listPayload, recapPayload } from '../services/goalRecap.js';
import { refreshReminder } from './goalMessages.js';
import { logError } from '../utils/logError.js';

export async function handleGoalButton(interaction: ButtonInteraction): Promise<void> {
  const component = parseGoalComponent(interaction.customId);
  if (!component) return;
  if (!interaction.guildId || interaction.message.author.id !== interaction.client.user?.id) {
    throw new GoalInputError('Ce bouton n’est pas disponible ici.');
  }
  const service = goalService();
  if (component.action === 'list') {
    await interaction.deferUpdate();
    await interaction.editReply(listPayload(await service.list(interaction.guildId, interaction.user.id), component.page));
    return;
  }
  if (component.action === 'recap') {
    // Page buttons only replace the ephemeral recap; reminder messages remain public and unchanged.
    const isPage = interaction.customId.split(':').length === 4 && interaction.message.flags.has(MessageFlags.Ephemeral);
    if (isPage) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const goal = await service.get(component.id, interaction.guildId);
    await interaction.editReply(recapPayload(goal, await service.checkins(goal.id), component.page));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const goal = await service.get(component.id, interaction.guildId);
  if (goal.channelId !== interaction.channelId) throw new GoalInputError('Ce rappel appartient à un autre canal.');
  const result = await service.answer({ id: component.id, date: component.date, guildId: interaction.guildId,
    userId: interaction.user.id, messageId: interaction.message.id, status: component.action });
  const updated = await refreshReminder(interaction.client, result.goal, result.checkin);
  if (updated) {
    // The result is displayed on the original reminder; remove the temporary acknowledgement.
    await interaction.deleteReply().catch((error: unknown) => logError('Goal answer: could not remove acknowledgement.', error));
  } else {
    await interaction.editReply('Réponse enregistrée. Le rappel n’a pas pu être actualisé ; le récapitulatif est à jour.');
  }
}
