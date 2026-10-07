import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from 'discord.js';
import { goalButton } from '../ui/goalTheme.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { logError } from '../utils/logError.js';
import { recapButton, reminderEmbed } from '../services/goalPresentation.js';
import { goalService } from '../services/goalService.js';

export function reminderButtons(id: number, date: string, answered = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    goalButton(`goal:yes:${id}:${date}`, 'Oui', ButtonStyle.Success, answered),
    goalButton(`goal:no:${id}:${date}`, 'Non', ButtonStyle.Secondary, answered),
    recapButton(id),
  );
}

export function reminderMessage(goal: Goal, date: string) {
  return {
    content: `<@${goal.targetUserId}>`,
    embeds: [reminderEmbed(goal, date)],
    allowedMentions: { parse: [] as [], users: [goal.targetUserId] },
    components: [reminderButtons(goal.id, date)],
    nonce: `g${goal.id}:${date}`,
    enforceNonce: true,
  };
}

export async function refreshReminder(client: Client, goal: Goal, checkin: GoalCheckin, records?: GoalCheckin[]): Promise<boolean> {
  if (!checkin.discordMessageId) return false;
  try {
    const channel = await client.channels.fetch(goal.channelId);
    if (!channel?.isTextBased() || channel.isDMBased() || channel.guildId !== goal.guildId || !('messages' in channel)) return false;
    const checkins = records ?? await goalService().checkins(goal.id);
    const current = checkins.find((row) => row.id === checkin.id) ?? checkin;
    await channel.messages.edit(checkin.discordMessageId, {
      content: `<@${goal.targetUserId}>`,
      embeds: [reminderEmbed(goal, current.checkinDate, current.status, checkins)],
      components: [reminderButtons(goal.id, current.checkinDate, current.status !== 'pending')],
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    logError(`Goal ${goal.id}: answer saved, but reminder buttons could not be updated.`, error);
    return false;
  }
}
