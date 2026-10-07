import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { GoalInputError, localClock, parseDate } from './goalLogic.js';
import { frenchDate, recapButton, unansweredPastDates } from './goalPresentation.js';
import { goalButton, goalEmbed } from '../ui/goalTheme.js';

export function assertHistoryAccess(goal: Goal, actorId: string, administrator: boolean): void {
  if (goal.creatorUserId !== actorId && !administrator) throw new GoalInputError('Seul le créateur ou un administrateur peut compléter l’historique.');
}

export function validateHistoryDate(goal: Goal, date: string, now = new Date()): void {
  parseDate(date);
  if (date < goal.startDate || date > goal.endDate || date >= localClock(goal.timezone, now).date) {
    throw new GoalInputError('Choisis une journée passée de cet objectif.');
  }
}

export function historyPayload(goal: Goal, records: GoalCheckin[], after?: string, now = new Date()) {
  const missing = unansweredPastDates(goal, records, now);
  const date = missing.find((day) => !after || day > after);
  if (!date) {
    const complete = missing.length === 0;
    return { content: '', embeds: [goalEmbed(complete ? 'Historique complété' : 'Historique parcouru',
      complete ? 'Tous les jours précédents ont été traités.' : `${missing.length} journée(s) restent sans réponse. Tu peux y revenir depuis le récapitulatif.`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(recapButton(goal.id, 'Voir le récapitulatif', ButtonStyle.Primary))],
      allowedMentions: { parse: [] as [] },
    };
  }
  const embed = goalEmbed('Historique', escapeMarkdown(goal.title)).addFields(
    { name: 'Date', value: frenchDate(date) },
    { name: 'Question', value: 'Cet objectif a-t-il été réalisé ce jour-là ?' },
  ).setFooter({ text: `Objectif #${goal.id} · ${missing.length} journée(s) sans réponse` });
  const prefix = `goal:history:${goal.id}:${date}`;
  return { content: '', embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      goalButton(`${prefix}:yes`, 'Oui', ButtonStyle.Success),
      goalButton(`${prefix}:no`, 'Non', ButtonStyle.Secondary),
      goalButton(`${prefix}:skip`, 'Passer'),
    )], allowedMentions: { parse: [] as [] },
  };
}
