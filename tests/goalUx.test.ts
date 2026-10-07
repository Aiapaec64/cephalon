import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Client, type Interaction, type MessageEditOptions } from 'discord.js';
import type { Goal, GoalCheckin } from '../src/db/schema.js';
import { dateRange, progressSummary, validateGoal } from '../src/services/goalLogic.js';
import { recapPayload } from '../src/services/goalRecap.js';
import { completionBar, creationPayload, DAY_VISUALS, frenchDate, goalDayLabel, goalDayNumber, reminderEmbed } from '../src/services/goalPresentation.js';
import { refreshReminder, reminderMessage } from '../src/components/goalMessages.js';
import { interactionCreate } from '../src/events/interactionCreate.js';
import { commands } from '../src/commands/index.js';

const now = new Date('2026-10-13T10:00:00Z');
const goal: Goal = {
  ...validateGoal({ title: 'Test', startDate: '2026-10-05', durationDays: 30, reminderTime: '17:00' }),
  id: 12, guildId: '101', channelId: '202', creatorUserId: '303', targetUserId: '404',
  active: true, createdAt: now, updatedAt: now,
};

function record(date: string, status: GoalCheckin['status'], id = 1): GoalCheckin {
  return { id, goalId: goal.id, checkinDate: date, status,
    respondedAt: status === 'yes' || status === 'no' ? now : null,
    discordMessageId: '987', deliveryState: 'sent', attemptedAt: now, retryAt: null, lastErrorCode: null, createdAt: now };
}

function displayedDays(payload: ReturnType<typeof recapPayload>): string[] {
  return payload.embeds[0]!.data.fields!.find((field) => field.name === 'Jours affichés')!.value.split('\n');
}

test('creation is compact, ephemeral-compatible, and offers just one recap button', () => {
  const payload = creationPayload(goal);
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(embed.title, '✅ Objectif créé');
  for (const detail of ['Test', '<@404>', '<@303>', '05/10/2026 → 03/11/2026', '17:00', 'Europe/Brussels', '30 jours']) {
    assert.ok(embed.description!.includes(detail));
  }
  assert.equal(embed.footer?.text, 'Objectif #12');
  assert.equal(embed.fields, undefined);
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0]!.components.length, 1);
  const button = payload.components[0]!.components[0]!.toJSON();
  assert.ok('custom_id' in button && button.custom_id === 'goal:recap:12');
  assert.equal(button.label, '📊 Voir le récapitulatif');
  assert.ok(embed.description!.length < 1024);
  assert.ok(creationPayload({ ...goal, active: false }).embeds[0]!.data.description!.includes('aucun rappel'));
});

test('daily reminder has a real mention outside its embed, French date, and day number', () => {
  const payload = reminderMessage(goal, '2026-10-06');
  const embed = payload.embeds[0]!.toJSON();
  assert.equal(payload.content, '<@404>');
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['404'] });
  assert.equal(embed.title, '🎯 Objectif du jour');
  assert.ok(embed.description!.includes('Jour 2 sur 30'));
  assert.ok(embed.description!.includes('6 octobre 2026'));
  assert.ok(embed.description!.includes('As-tu réalisé ton objectif aujourd’hui ?'));
  assert.deepEqual(payload.components[0]!.toJSON().components.map((button) => 'label' in button ? button.label : undefined), ['✅ Oui', '❌ Non', '📊 Récapitulatif']);
});

test('yes shows total completed days and no stays supportive', () => {
  const records = [record('2026-10-05', 'yes'), record('2026-10-06', 'yes', 2), record('2026-10-07', 'no', 3)];
  const yes = reminderEmbed(goal, '2026-10-06', 'yes', records).toJSON();
  assert.equal(yes.title, '✅ Objectif validé');
  assert.ok(yes.description!.includes('Bien joué <@404>'));
  assert.ok(yes.description!.includes('2 jours complétés sur 30'));
  const no = reminderEmbed(goal, '2026-10-07', 'no', records).toJSON();
  assert.equal(no.title, '❌ Objectif non validé aujourd’hui');
  assert.ok(!no.description!.includes('As-tu réalisé'));
  assert.ok(/nouvelle occasion|progression|continuer/.test(no.description!));
});

test('30 days use five pages of at most seven days', () => {
  for (let page = 0; page < 5; page++) {
    const payload = recapPayload(goal, [], page, now);
    assert.equal(payload.embeds[0]!.data.footer?.text?.includes(`Page ${page + 1}/5`), true);
    assert.equal(displayedDays(payload).length, page === 4 ? 2 : 7);
  }
});

test('recap defaults to today in the goal timezone and Today button restores that page', () => {
  const payload = recapPayload(goal, [], undefined, now);
  assert.ok(payload.embeds[0]!.data.footer!.text.includes('Page 2/5'));
  assert.ok(displayedDays(payload).includes('⏳ 13/10 — Aujourd’hui'));
  assert.ok(payload.embeds[0]!.data.description!.includes('Jour 9 sur 30'));
  assert.deepEqual(displayedDays(recapPayload(goal, [], 'today', now)), displayedDays(payload));
  const timezoneBoundary = recapPayload(goal, [], 'today', new Date('2026-10-11T22:30:00Z'));
  assert.ok(timezoneBoundary.embeds[0]!.data.footer!.text.includes('Page 2/5'));
  assert.ok(displayedDays(timezoneBoundary).includes('⏳ 12/10 — Aujourd’hui'));
});

test('first and last pages disable the correct controls; out-of-range pages clamp', () => {
  const first = recapPayload(goal, [], 0, now);
  const last = recapPayload(goal, [], 4, now);
  const firstButtons = first.components[0]!.toJSON().components;
  const lastButtons = last.components[0]!.toJSON().components;
  assert.equal(firstButtons[0]!.disabled, true);
  assert.equal(firstButtons[1]!.disabled, false);
  assert.equal(lastButtons[0]!.disabled, false);
  assert.equal(lastButtons[1]!.disabled, true);
  assert.ok('label' in firstButtons[0]! && firstButtons[0]!.label === '◀ Précédent');
  assert.ok('label' in firstButtons[1]! && firstButtons[1]!.label === 'Suivant ▶');
  assert.ok('custom_id' in firstButtons[2]! && firstButtons[2]!.custom_id === 'goal:recap:12:today');
  assert.equal(firstButtons[2]!.disabled, false);
  assert.equal(recapPayload(goal, [], 'today', now).components[0]!.toJSON().components[2]!.disabled, true);
  assert.deepEqual(displayedDays(recapPayload(goal, [], -1, now)), displayedDays(first));
  assert.deepEqual(displayedDays(recapPayload(goal, [], 99999, now)), displayedDays(last));
});

test('short goals fit one page; before/after the goal opens nearest boundary page', () => {
  const short = { ...goal, endDate: '2026-10-07' };
  const payload = recapPayload(short, [], 'today', now);
  assert.equal(displayedDays(payload).length, 3);
  assert.equal(payload.components.length, 0);
  assert.ok(payload.embeds[0]!.data.description!.includes('Terminé · 3 jours'));
  assert.ok(recapPayload(goal, [], 'today', new Date('2026-10-04T10:00Z')).embeds[0]!.data.footer!.text.includes('Page 1/5'));
  assert.ok(recapPayload(goal, [], 'today', new Date('2026-11-05T10:00Z')).embeds[0]!.data.footer!.text.includes('Page 5/5'));
  assert.equal(displayedDays(recapPayload({ ...short, endDate: short.startDate }, [], 'today', now)).length, 1);
});

test('French labels consistently distinguish yes, no, missed, pending, and future', () => {
  const rows = [record('2026-10-05', 'yes'), record('2026-10-06', 'no', 2)];
  const payload = recapPayload(goal, rows, 0, new Date('2026-10-08T10:00Z'));
  assert.deepEqual(displayedDays(payload), [
    '✅ 05/10 — Fait', '❌ 06/10 — Non', '⚪ 07/10 — Sans réponse', '⏳ 08/10 — Aujourd’hui',
    '⬜ 09/10 — À venir', '⬜ 10/10 — À venir', '⬜ 11/10 — À venir',
  ]);
  assert.deepEqual(Object.values(DAY_VISUALS).map((value) => value.label), ['Fait', 'Non', 'Sans réponse', 'Aujourd’hui', 'À venir']);
});

test('success counts only explicit responses, while remaining and completion bar use goal days', () => {
  const summary = progressSummary([...Array.from({ length: 8 }, () => 'yes' as const), 'no', 'no', 'missed', 'pending', 'future']);
  assert.equal(summary.successRate, 80);
  assert.equal(summary.unanswered, 1);
  assert.equal(summary.remaining, 2);
  assert.equal(progressSummary(['missed', 'pending', 'future']).successRate, 0);
  assert.equal(progressSummary(['yes', 'missed']).successRate, 100);
  assert.equal(progressSummary(['no', 'missed']).successRate, 0);
  assert.equal(completionBar(6, 10), '██████░░░░ 60 %');
  assert.equal(completionBar(0, 0), '░░░░░░░░░░ 0 %');
});

test('French date formatting and inclusive day numbers remain timezone-independent', () => {
  assert.equal(frenchDate('2026-10-06'), '06/10/2026');
  assert.equal(frenchDate('2026-10-06', 'long'), '6 octobre 2026');
  assert.equal(goalDayNumber(goal, '2026-10-06'), 2);
  assert.equal(goalDayNumber(goal, '2026-10-04'), 0);
  assert.equal(goalDayLabel(goal, '2026-10-04'), 'Début le 05/10/2026');
  assert.ok(goalDayLabel({ ...goal, active: false }, '2026-10-06').startsWith('Arrêté'));
});

test('recap metrics show 8 yes, 2 no, 1 unanswered, 19 remaining, and 80 percent', () => {
  const dates = dateRange(goal.startDate, goal.endDate);
  const rows = dates.slice(0, 10).map((date, index) => record(date, index < 8 ? 'yes' : 'no', index + 1));
  const payload = recapPayload(goal, rows, 'today', new Date('2026-10-16T10:00Z'));
  const summary = payload.embeds[0]!.data.fields!.find((field) => field.name === 'Progression')!.value;
  for (const metric of ['✅ Validés : 8', '❌ Non : 2', '⚪ Sans réponse : 1', '📆 Restants : 19', '📈 Réussite : 80 %']) {
    assert.ok(summary.includes(metric));
  }
});

test('long multi-year goals keep recap, confirmation, and reminder within all embed limits', () => {
  const longGoal = { ...goal, title: 'x'.repeat(200), endDate: '2036-10-04' };
  const total = dateRange(longGoal.startDate, longGoal.endDate).length;
  for (const page of [0, 90, Math.ceil(total / 7) - 1]) {
    const payload = recapPayload(longGoal, [], page, now);
    assert.ok(displayedDays(payload).length <= 7);
    assert.ok(payload.components[0]!.components.length <= 5);
    for (const embed of payload.embeds) {
      assert.ok(embed.length <= 6000);
      assert.ok((embed.data.title?.length ?? 0) <= 256);
      assert.ok((embed.data.description?.length ?? 0) <= 4096);
      assert.ok((embed.data.fields?.length ?? 0) <= 25);
      for (const field of embed.data.fields ?? []) { assert.ok(field.name.length <= 256); assert.ok(field.value.length <= 1024); }
    }
  }
  assert.ok(creationPayload(longGoal).embeds[0]!.length <= 6000);
  assert.ok(reminderEmbed(longGoal, '2026-10-06').length <= 6000);
});

test('answer edits existing reminder, disables Yes/No, and never pings again', async () => {
  let editedId = '';
  let edited: MessageEditOptions | undefined;
  const channel = { isTextBased: () => true, isDMBased: () => false, guildId: goal.guildId,
    messages: { edit: async (id: string, payload: MessageEditOptions) => { editedId = id; edited = payload; } } };
  const client = { channels: { fetch: async () => channel } } as unknown as Client;
  const response = record('2026-10-06', 'yes', 2);
  assert.equal(await refreshReminder(client, goal, response, [record('2026-10-05', 'yes'), response]), true);
  assert.equal(editedId, '987');
  assert.deepEqual(edited!.allowedMentions, { parse: [] });
  const embed = edited!.embeds![0]!;
  const data = 'toJSON' in embed ? embed.toJSON() : embed;
  assert.equal(data.title, '✅ Objectif validé');
  assert.ok(data.description!.includes('2 jours complétés sur 30'));
  const row = edited!.components![0]!;
  const buttons = 'toJSON' in row ? row.toJSON() : row;
  assert.ok('components' in buttons);
  assert.ok('disabled' in buttons.components[0]! && buttons.components[0]!.disabled);
  assert.ok('disabled' in buttons.components[1]! && buttons.components[1]!.disabled);
  assert.ok('custom_id' in buttons.components[2]! && buttons.components[2]!.custom_id === 'goal:recap:12');
  assert.ok(!('disabled' in buttons.components[2]!) || !buttons.components[2]!.disabled);
});

test('failed message edit preserves saved response and returns a fallback signal', async () => {
  const response = record('2026-10-06', 'yes');
  const client = { channels: { fetch: async () => null } } as unknown as Client;
  assert.equal(await refreshReminder(client, goal, response, [response]), false);
  assert.equal(response.status, 'yes');
});

test('unexpected goal errors remain generic, ephemeral, and in French', async () => {
  const command = commands.get('goal')!;
  const execute = command.execute;
  const log = console.error;
  let reply: { content: string } | undefined;
  command.execute = async () => { throw new Error('Internal detail must remain private'); };
  console.error = () => {};
  const interaction = {
    isChatInputCommand: () => true, isButton: () => false, commandName: 'goal',
    createdTimestamp: Date.now(), deferred: true, replied: false,
    editReply: async (value: { content: string }) => { reply = value; },
  } as unknown as Interaction;
  try {
    await interactionCreate.execute(interaction);
    assert.equal(reply!.content, 'Une erreur est survenue pendant cette action. Réessaie dans un instant.');
    assert.ok(!reply!.content.includes('Internal detail'));
  } finally {
    command.execute = execute;
    console.error = log;
  }
});
