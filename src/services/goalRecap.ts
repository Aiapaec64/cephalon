import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { Goal, GoalCheckin } from '../db/schema.js';
import { dateRange, dayStatus, localClock, progressSummary, RECAP_PAGE_SIZE } from './goalLogic.js';

const icons = { yes: '✅', no: '❌', missed: '⚪', pending: '⏳', future: '⬜' };

export function recapPayload(goal: Goal, checkins: GoalCheckin[], requestedPage = 0, now = new Date()) {
  const today = localClock(goal.timezone, now).date;
  const dates = dateRange(goal.startDate, goal.endDate);
  const records = new Map(checkins.map((row) => [row.checkinDate, row]));
  const statuses = dates.map((date) => dayStatus(date, today, records.get(date)?.status));
  const totals = progressSummary(statuses);
  const pages = Math.max(1, Math.ceil(dates.length / RECAP_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  const offset = page * RECAP_PAGE_SIZE;
  const rows = dates.slice(offset, offset + RECAP_PAGE_SIZE).map((date, index) => `${icons[statuses[offset + index]!]} ${date}`);
  const unresolved = checkins.filter((row) => row.deliveryState === 'uncertain' || row.deliveryState === 'sending');
  const waiting = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate === today && row.status === 'pending');
  const failedPast = checkins.filter((row) => row.deliveryState === 'queued' && row.lastErrorCode && row.checkinDate < today);
  const active = goal.active && today <= goal.endDate;
  const embed = new EmbedBuilder().setTitle(goal.title).setColor(0x5865f2)
    .setDescription(rows.join('\n'))
    .addFields(
      { name: 'Objectif', value: `ID : ${goal.id}\nCible : <@${goal.targetUserId}>\nCréateur : <@${goal.creatorUserId}>\nCanal : <#${goal.channelId}>` },
      { name: 'Calendrier', value: `${goal.startDate} → ${goal.endDate} (inclus)\n${goal.reminderTime} · ${goal.timezone}\n${active ? 'Actif' : 'Terminé / arrêté'}` },
      { name: 'Progression', value: `Validés : ${totals.completed}\nNon : ${totals.declined}\nSans réponse : ${totals.unanswered}\nManqués : ${totals.missed}\nRestants : ${totals.remaining}\nRéussite : ${totals.successRate.toFixed(1)} %` },
    ).setFooter({ text: `Page ${page + 1}/${pages} · ⚪ sans réponse · ⏳ aujourd’hui · ⬜ à venir` });
  if (unresolved.length || waiting.length || failedPast.length) {
    embed.addFields({ name: 'Livraison des rappels', value: `${unresolved.length} envoi(s) incertain(s), sans renvoi automatique.\n${waiting.length} rappel(s) en attente aujourd’hui.\n${failedPast.length} ancien(s) rappel(s) non livré(s). Consulte les logs.` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`goal:recap:${goal.id}:${Math.max(0, page - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`goal:recap:${goal.id}:${Math.min(pages - 1, page + 1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
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
    embed.addFields({ name: `#${goal.id} · ${goal.title}`, value: `<@${goal.targetUserId}>\n${goal.startDate} → ${goal.endDate}\n${goal.reminderTime} · ${escapeMarkdown(goal.timezone)}` });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (pages > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goal:list:${Math.max(0, page - 1)}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`goal:list:${Math.min(pages - 1, page + 1)}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
  ));
  return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}
