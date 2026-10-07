import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from 'discord.js';
import type { GoalService } from '../services/goalService.js';
import type { GoalComponent } from './goalIds.js';
import { assertHistoryAccess, historyPayload, validateHistoryDate } from '../services/goalHistory.js';
import { refreshReminder } from './goalMessages.js';
import { GoalInputError } from '../services/goalLogic.js';
import type { GoalCheckin } from '../db/schema.js';

export interface HistoryService {
  get: GoalService['get'];
  checkins(id: number): PromiseLike<GoalCheckin[]>;
  setDay: GoalService['setDay'];
}

export async function handleHistoryButton(interaction: ButtonInteraction,
  component: Extract<GoalComponent, { action: 'history' }>, service: HistoryService): Promise<void> {
  if (!interaction.guildId) throw new GoalInputError('Cette action doit être utilisée dans un serveur.');
  if (interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const goal = await service.get(component.id, interaction.guildId);
  const administrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  assertHistoryAccess(goal, interaction.user.id, administrator);
  if (component.date) validateHistoryDate(goal, component.date);
  if (component.choice === 'yes' || component.choice === 'no') {
    const result = await service.setDay({ id: goal.id, guildId: interaction.guildId, actorId: interaction.user.id,
      administrator, date: component.date!, status: component.choice }, true);
    // Persist first; a missing original reminder never blocks the history workflow.
    if (result.checkin.discordMessageId) await refreshReminder(interaction.client, goal, result.checkin, await service.checkins(goal.id));
  }
  const records = await service.checkins(goal.id);
  await interaction.editReply(historyPayload(goal, records, component.date));
}
