import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { goalContext, goalIdOption } from './context.js';
import { goalService } from '../../services/goalService.js';
import { GoalInputError } from '../../services/goalLogic.js';
import { refreshReminder } from '../../components/goalMessages.js';

export async function setGoalDay(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = goalContext(interaction);
  const id = goalIdOption(interaction);
  const status = interaction.options.getString('status', true);
  if (status !== 'yes' && status !== 'no') throw new GoalInputError('Le statut doit être yes ou no.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await goalService().setDay({ id, ...context, date: interaction.options.getString('date', true), status });
  await refreshReminder(interaction.client, result.goal, result.checkin);
  await interaction.editReply(`Objectif #${id} : ${result.checkin.checkinDate} → ${status === 'yes' ? '✅' : '❌'}.`);
}
