import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { parseGoalComponent } from './goalIds.js';
import { goalService } from '../services/goalService.js';
import { GoalInputError } from '../services/goalLogic.js';
import { listPayload, recapPayload } from '../services/goalRecap.js';
import { refreshReminder } from './goalMessages.js';

const yesMessages = ['Bien joué, continue comme ça 💪', 'Objectif validé pour aujourd’hui ✅', 'Bravo, encore une journée de faite 🔥', 'Excellent, garde le rythme !'];
const noMessages = ['Pas grave, demain est une nouvelle occasion.', 'Une journée manquée ne détruit pas ta progression.', 'Reprends demain 💪', 'Le plus important est de continuer.'];

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
  await refreshReminder(interaction.client, result.goal, result.checkin);
  const pool = component.action === 'yes' ? yesMessages : noMessages;
  await interaction.editReply(pool[Math.floor(Math.random() * pool.length)]!);
}
