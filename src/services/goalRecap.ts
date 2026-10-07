import { ActionRowBuilder, ButtonBuilder, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { dayStatus, localClock, RECAP_PAGE_SIZE } from './goalLogic.js';
import { DAY_VISUALS, frenchDate, goalDayLabel, goalProgress, historyButton, unansweredPastDates } from './goalPresentation.js';
import { goalButton, goalEmbed } from '../ui/goalTheme.js';

export function recapPayload(goal: Goal, checkins: GoalCheckin[], requestedPage: number | 'today' = 'today', now = new Date()) {
  const today = localClock(goal.timezone, now).date;
  const totals = goalProgress(goal, checkins, today);
  const dates = totals.dates;
  const records = new Map(checkins.map((row) => [row.checkinDate, row]));
  const statuses = dates.map((date) => dayStatus(date, today, records.get(date)?.status));
  const pages = Math.max(1, Math.ceil(dates.length / RECAP_PAGE_SIZE));
  const todayIndex = today < goal.startDate ? 0 : today > goal.endDate ? dates.length - 1 : dates.indexOf(today);
  const todayPage = Math.floor(todayIndex / RECAP_PAGE_SIZE);
  const requested = requestedPage === 'today' ? todayPage : requestedPage;
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requested) ? Math.trunc(requested) : todayPage));
  const offset = page * RECAP_PAGE_SIZE;
  const rows = dates.slice(offset, offset + RECAP_PAGE_SIZE).map((date, index) => {
    const visual = DAY_VISUALS[statuses[offset + index]!];
    return `${visual.icon ? visual.icon + ' ' : ''}${frenchDate(date, 'short')}   ${visual.label}`;
  });
  const unresolved = checkins.filter((row) => row.deliveryState === 'uncertain' || row.deliveryState === 'sending');
  const waiting = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate === today && row.status === 'pending');
  const failedPast = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate < today);
  const embed = goalEmbed(goal.title, `${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}\n${goal.reminderTime} · ${goal.timezone}`)
    .addFields(
      { name: 'Progression', value: `${totals.completed} / ${dates.length} jours validés`, inline: true },
      { name: 'Réussite', value: `${totals.successRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`, inline: true },
      { name: 'Restants', value: `${totals.remaining} jours`, inline: true },
      { name: 'Cible', value: `<@${goal.targetUserId}>`, inline: true },
      { name: 'Aujourd’hui', value: goalDayLabel(goal, today), inline: true },
      { name: 'Réponses', value: `${totals.declined} non · ${totals.unanswered} sans réponse`, inline: true },
      { name: 'Historique', value: rows.join('\n') },
    ).setFooter({ text: `Objectif #${goal.id} · Page ${page + 1} / ${pages}` });
  if (unresolved.length || waiting.length || failedPast.length) {
    embed.addFields({ name: 'Rappels', value: `${unresolved.length} envoi(s) incertain(s) · ${waiting.length} en attente · ${failedPast.length} non livré(s).` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      goalButton(`goal:recap:${goal.id}:${Math.max(0, page - 1)}`, 'Précédent', undefined, page === 0),
      goalButton(`goal:recap:${goal.id}:${Math.min(pages - 1, page + 1)}`, 'Suivant', undefined, page === pages - 1),
      goalButton(`goal:recap:${goal.id}:today`, 'Aujourd’hui', undefined, page === todayPage),
    ));
  }
  if (unansweredPastDates(goal, checkins, now).length) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(historyButton(goal.id)));
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}

export function listPayload(goals: Goal[], requestedPage = 0) {
  const pages = Math.max(1, Math.ceil(goals.length / 10));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  const embed = goalEmbed('Objectifs actifs', goals.length ? 'Créés par toi ou qui te concernent.' : 'Aucun objectif actif.')
    .setFooter({ text: `Page ${page + 1}/${pages}` });
  for (const goal of goals.slice(page * 10, page * 10 + 10)) {
    embed.addFields({ name: `#${goal.id} · ${goal.title}`, value: `<@${goal.targetUserId}>\n${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}\n${goal.reminderTime} · ${escapeMarkdown(goal.timezone)}` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    goalButton(`goal:list:${Math.max(0, page - 1)}`, 'Précédent', undefined, page === 0),
    goalButton(`goal:list:${Math.min(pages - 1, page + 1)}`, 'Suivant', undefined, page === pages - 1),
  ));
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}
