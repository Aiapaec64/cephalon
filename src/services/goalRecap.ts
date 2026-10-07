import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { dateRange, dayStatus, localClock, progressSummary, RECAP_PAGE_SIZE } from './goalLogic.js';
import { completionBar, DAY_VISUALS, frenchDate, goalDayLabel } from './goalPresentation.js';

export function recapPayload(goal: Goal, checkins: GoalCheckin[], requestedPage: number | 'today' = 'today', now = new Date()) {
  const today = localClock(goal.timezone, now).date;
  const dates = dateRange(goal.startDate, goal.endDate);
  const records = new Map(checkins.map((row) => [row.checkinDate, row]));
  const statuses = dates.map((date) => dayStatus(date, today, records.get(date)?.status));
  const totals = progressSummary(statuses);
  const pages = Math.max(1, Math.ceil(dates.length / RECAP_PAGE_SIZE));
  const todayIndex = today < goal.startDate ? 0 : today > goal.endDate ? dates.length - 1 : dates.indexOf(today);
  const todayPage = Math.floor(todayIndex / RECAP_PAGE_SIZE);
  const requested = requestedPage === 'today' ? todayPage : requestedPage;
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requested) ? Math.trunc(requested) : todayPage));
  const offset = page * RECAP_PAGE_SIZE;
  const rows = dates.slice(offset, offset + RECAP_PAGE_SIZE).map((date, index) => {
    const visual = DAY_VISUALS[statuses[offset + index]!];
    return `${visual.icon} ${frenchDate(date, 'short')} — ${visual.label}`;
  });
  const unresolved = checkins.filter((row) => row.deliveryState === 'uncertain' || row.deliveryState === 'sending');
  const waiting = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate === today && row.status === 'pending');
  const failedPast = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate < today);
  const embed = new EmbedBuilder().setTitle(`🎯 ${goal.title}`).setColor(0x5865f2)
    .setDescription([
      `👤 Cible : <@${goal.targetUserId}>`,
      `✍️ Créateur : <@${goal.creatorUserId}> · <#${goal.channelId}>`,
      `📅 ${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}`,
      `⏰ ${goal.reminderTime} · ${goal.timezone}`,
      `\n**${goalDayLabel(goal, today)}**`,
    ].join('\n'))
    .addFields(
      { name: 'Progression', value: `${completionBar(totals.completed, dates.length)} validés\n\n✅ Validés : ${totals.completed}\n❌ Non : ${totals.declined}\n⚪ Sans réponse : ${totals.unanswered}\n📆 Restants : ${totals.remaining}\n📈 Réussite : ${totals.successRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` },
      { name: 'Jours affichés', value: rows.join('\n') },
    ).setFooter({ text: `Objectif #${goal.id} · Page ${page + 1}/${pages}` });
  if (unresolved.length || waiting.length || failedPast.length) {
    embed.addFields({ name: 'Rappels', value: `${unresolved.length} envoi(s) incertain(s) · ${waiting.length} en attente · ${failedPast.length} non livré(s).` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`goal:recap:${goal.id}:${Math.max(0, page - 1)}`).setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`goal:recap:${goal.id}:${Math.min(pages - 1, page + 1)}`).setLabel('Suivant ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
      new ButtonBuilder().setCustomId(`goal:recap:${goal.id}:today`).setLabel('📅 Aujourd’hui').setStyle(ButtonStyle.Primary).setDisabled(page === todayPage),
    ));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}

export function listPayload(goals: Goal[], requestedPage = 0) {
  const pages = Math.max(1, Math.ceil(goals.length / 10));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  const embed = new EmbedBuilder().setTitle('Tes objectifs actifs').setColor(0x5865f2)
    .setDescription(goals.length ? 'Objectifs créés par toi ou qui te concernent.' : 'Aucun objectif actif.')
    .setFooter({ text: `Page ${page + 1}/${pages}` });
  for (const goal of goals.slice(page * 10, page * 10 + 10)) {
    embed.addFields({ name: `#${goal.id} · ${goal.title}`, value: `<@${goal.targetUserId}>\n${frenchDate(goal.startDate)} → ${frenchDate(goal.endDate)}\n${goal.reminderTime} · ${escapeMarkdown(goal.timezone)}` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goal:list:${Math.max(0, page - 1)}`).setLabel('◀ Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`goal:list:${Math.min(pages - 1, page + 1)}`).setLabel('Suivant ▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
  ));
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}
