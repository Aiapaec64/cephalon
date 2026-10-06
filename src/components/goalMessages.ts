import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type Client } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { logError } from '../utils/logError.js';

export function reminderButtons(id: number, date: string, answered = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goal:yes:${id}:${date}`).setLabel('Oui ✅').setStyle(ButtonStyle.Success).setDisabled(answered),
    new ButtonBuilder().setCustomId(`goal:no:${id}:${date}`).setLabel('Non ❌').setStyle(ButtonStyle.Secondary).setDisabled(answered),
    new ButtonBuilder().setCustomId(`goal:recap:${id}`).setLabel('Voir le récapitulatif 📊').setStyle(ButtonStyle.Primary),
  );
}

export function reminderMessage(goal: Goal, date: string) {
  return {
    content: `<@${goal.targetUserId}> — objectif du jour : ${escapeMarkdown(goal.title)}\n\nEst-ce que tu as fait ton objectif aujourd’hui ?`,
    allowedMentions: { parse: [] as [], users: [goal.targetUserId] },
    components: [reminderButtons(goal.id, date)],
    nonce: `g${goal.id}:${date}`,
    enforceNonce: true,
  };
}

export async function refreshReminder(client: Client, goal: Goal, checkin: GoalCheckin): Promise<void> {
  if (!checkin.discordMessageId) return;
  try {
    const channel = await client.channels.fetch(goal.channelId);
    if (!channel?.isTextBased() || channel.isDMBased() || channel.guildId !== goal.guildId || !('messages' in channel)) return;
    await channel.messages.edit(checkin.discordMessageId, {
      components: [reminderButtons(goal.id, checkin.checkinDate, true)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logError(`Goal ${goal.id}: answer saved, but reminder buttons could not be updated.`, error);
  }
}
