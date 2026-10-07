import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ButtonStyle, type Client, type MessageEditOptions } from 'discord.js';
import type { Goal, GoalCheckin } from '../src/db/schema.js';
import { dateRange, validateGoal } from '../src/services/goalLogic.js';
import { recapPayload, listPayload } from '../src/services/goalRecap.js';
import { creationPayload, frenchDate, goalDayNumber, reminderEmbed, streakDays } from '../src/services/goalPresentation.js';
import { refreshReminder, reminderMessage } from '../src/components/goalMessages.js';
import { goalColors } from '../src/ui/goalTheme.js';

const now = new Date('2026-10-13T10:00:00Z');
const goal: Goal = { ...validateGoal({ title: 'Test', startDate: '2026-10-05', durationDays: 30, reminderTime: '17:00' }),
  id: 12, guildId: '101', channelId: '202', creatorUserId: '303', targetUserId: '404', active: true, createdAt: now, updatedAt: now };

export function record(date: string, status: GoalCheckin['status'], id = 1): GoalCheckin {
  return { id, goalId: goal.id, checkinDate: date, status, respondedAt: status === 'yes' || status === 'no' ? now : null,
    discordMessageId: '987', deliveryState: 'sent', attemptedAt: now, retryAt: null, lastErrorCode: null, createdAt: now };
}
function field(embed: ReturnType<typeof reminderEmbed>, name: string): string {
  return embed.data.fields!.find((value) => value.name === name)!.value;
}
function days(payload: ReturnType<typeof recapPayload>): string[] { return field(payload.embeds[0]!, 'Historique').split('\n'); }
const decorative = /[✅❌⚪⏳⬜🎯👤📅⏰🌍📆📊💪🔥█░]/u;

test('creation uses compact fields and a clean primary recap button', () => {
  const payload = creationPayload(goal, new Date('2026-10-05T10:00Z'));
  const embed = payload.embeds[0]!;
  assert.equal(embed.data.title, 'Objectif créé');
  assert.equal(embed.data.description, 'Test');
  assert.equal(embed.data.color, goalColors.accent);
  assert.equal(field(embed, 'Cible'), '<@404>');
  assert.equal(field(embed, 'Créateur'), '<@303>');
  assert.equal(field(embed, 'Période'), '05/10/2026 → 03/11/2026');
  assert.equal(field(embed, 'Rappel'), '17:00 · Europe/Brussels');
  assert.equal(field(embed, 'Progression'), '0 / 30 jours');
  const buttons = payload.components[0]!.toJSON().components;
  assert.equal(buttons.length, 1);
  assert.ok('label' in buttons[0]! && buttons[0]!.label === 'Voir le récapitulatif');
  assert.equal(buttons[0]!.style, ButtonStyle.Primary);
  assert.equal(creationPayload(goal, now).components[0]!.components.length, 2);
  assert.equal(field(creationPayload({ ...goal, active: false }, now).embeds[0]!, 'État'), 'Terminé. Aucun rappel ne sera envoyé.');
});

test('reminder preserves notification, nonce, and quiet button hierarchy', () => {
  const payload = reminderMessage(goal, '2026-10-07');
  const embed = payload.embeds[0]!;
  assert.equal(payload.content, '<@404>');
  assert.deepEqual(payload.allowedMentions, { parse: [], users: ['404'] });
  assert.equal(embed.data.title, 'Objectif du jour');
  assert.equal(field(embed, 'Aujourd’hui'), 'Jour 3 sur 30');
  assert.equal(field(embed, 'Date'), '07/10/2026');
  assert.equal(field(embed, 'Question'), 'As-tu réalisé ton objectif aujourd’hui ?');
  const buttons = payload.components[0]!.toJSON().components;
  assert.deepEqual(buttons.map((button) => 'label' in button ? button.label : ''), ['Oui', 'Non', 'Récapitulatif']);
  assert.deepEqual(buttons.map((button) => button.style), [ButtonStyle.Success, ButtonStyle.Secondary, ButtonStyle.Secondary]);
  assert.equal(payload.enforceNonce, true);
  assert.ok(payload.nonce.length <= 25);
});

test('results use restrained colors, numeric progress, a calculated streak, and calm wording', () => {
  const rows = [record('2026-10-05', 'yes'), record('2026-10-06', 'yes', 2), record('2026-10-07', 'yes', 3)];
  const yes = reminderEmbed(goal, '2026-10-07', 'yes', rows);
  assert.equal(yes.data.title, 'Objectif validé');
  assert.equal(yes.data.color, goalColors.success);
  assert.equal(field(yes, 'Progression'), '3 / 30 jours');
  assert.equal(field(yes, 'Série actuelle'), '3 jours');
  assert.equal(field(yes, 'Bilan'), 'Bien joué. Continue comme ça.');
  const no = reminderEmbed(goal, '2026-10-07', 'no', rows.slice(0, 2));
  assert.equal(no.data.title, 'Objectif non validé');
  assert.equal(no.data.color, goalColors.negative);
  assert.equal(field(no, 'Progression'), '2 / 30 jours');
  assert.equal(field(no, 'Bilan'), 'Une journée manquée ne remet pas en cause ta progression.');
});

test('streak tolerates current pending but breaks on no or an unanswered past day', () => {
  const rows = [record('2026-10-05', 'yes'), record('2026-10-06', 'yes', 2)];
  assert.equal(streakDays(goal, rows, '2026-10-07'), 2);
  assert.equal(streakDays(goal, [...rows, record('2026-10-07', 'no', 3)], '2026-10-07'), 0);
  assert.equal(streakDays(goal, [...rows, record('2026-10-08', 'yes', 4)], '2026-10-08'), 1);
  assert.equal(streakDays(goal, rows, '2026-10-04'), 0);
  assert.equal(streakDays(goal, [], '2026-10-07'), 0);
});

test('30-day recap has five six-day pages and selects today using the goal timezone', () => {
  for (let page = 0; page < 5; page++) {
    const payload = recapPayload(goal, [], page, now);
    assert.equal(days(payload).length, 6);
    assert.ok(payload.embeds[0]!.data.footer!.text.includes(`Page ${page + 1} / 5`));
  }
  const payload = recapPayload(goal, [], 'today', now);
  assert.ok(days(payload).includes('· 13/10   Aujourd’hui'));
  assert.ok(payload.embeds[0]!.data.footer!.text.includes('Page 2 / 5'));
  const boundary = recapPayload(goal, [], 'today', new Date('2026-10-10T22:30:00Z'));
  assert.ok(days(boundary).includes('· 11/10   Aujourd’hui'));
  assert.ok(boundary.embeds[0]!.data.footer!.text.includes('Page 2 / 5'));
});

test('first/last controls disable correctly and bounds clamp without changing historical data', () => {
  const first = recapPayload(goal, [], 0, now), last = recapPayload(goal, [], 4, now);
  const firstButtons = first.components[0]!.toJSON().components, lastButtons = last.components[0]!.toJSON().components;
  assert.equal(firstButtons[0]!.disabled, true);
  assert.equal(firstButtons[1]!.disabled, false);
  assert.equal(lastButtons[0]!.disabled, false);
  assert.equal(lastButtons[1]!.disabled, true);
  assert.deepEqual(firstButtons.map((button) => 'label' in button ? button.label : ''), ['Précédent', 'Suivant', 'Aujourd’hui']);
  assert.deepEqual(days(recapPayload(goal, [], -1, now)), days(first));
  assert.deepEqual(days(recapPayload(goal, [], 99999, now)), days(last));
  assert.ok(recapPayload(goal, [], 'today', new Date('2026-10-04T10:00Z')).embeds[0]!.data.footer!.text.includes('Page 1 / 5'));
  assert.ok(recapPayload(goal, [], 'today', new Date('2026-11-05T10:00Z')).embeds[0]!.data.footer!.text.includes('Page 5 / 5'));
  const short = recapPayload({ ...goal, endDate: goal.startDate }, [], 'today', now);
  assert.equal(days(short).length, 1);
  assert.equal(short.components[0]!.components.length, 1); // History action, no pagination.
});

test('status symbols are restrained; success ignores unanswered and future days', () => {
  const rows = [record('2026-10-05', 'yes'), record('2026-10-06', 'no', 2)];
  assert.deepEqual(days(recapPayload(goal, rows, 0, new Date('2026-10-08T10:00Z'))), [
    '✓ 05/10   Fait', '× 06/10   Non', '— 07/10   Sans réponse', '· 08/10   Aujourd’hui', '09/10   À venir', '10/10   À venir',
  ]);
  const dates = dateRange(goal.startDate, goal.endDate);
  const ten = dates.slice(0, 10).map((date, index) => record(date, index < 8 ? 'yes' : 'no', index + 1));
  const embed = recapPayload(goal, ten, 'today', new Date('2026-10-16T10:00Z')).embeds[0]!;
  assert.equal(field(embed, 'Progression'), '8 / 30 jours validés');
  assert.equal(field(embed, 'Réussite'), '80 %');
  assert.equal(field(embed, 'Restants'), '19 jours');
  assert.equal(field(embed, 'Réponses'), '2 non · 1 sans réponse');
});

test('all views avoid decorative emojis and bars and respect Discord limits for long goals', () => {
  const long = { ...goal, title: 'x'.repeat(200), endDate: '2036-10-04' };
  const pages = Math.ceil(dateRange(long.startDate, long.endDate).length / 6);
  const payloads = [creationPayload(long, now), reminderMessage(long, '2026-10-07'),
    recapPayload(long, [], 0, now), recapPayload(long, [], pages - 1, now), listPayload([long])];
  for (const payload of payloads) {
    for (const embed of payload.embeds) {
      assert.ok(!decorative.test(JSON.stringify(embed.toJSON())));
      assert.ok(embed.length <= 6000);
      assert.ok((embed.data.title?.length ?? 0) <= 256);
      assert.ok((embed.data.description?.length ?? 0) <= 4096);
      for (const value of embed.data.fields ?? []) assert.ok(value.name.length <= 256 && value.value.length <= 1024);
    }
    assert.ok(payload.components.length <= 5);
    for (const row of payload.components) {
      assert.ok(row.components.length <= 5);
      for (const button of row.components) {
        const json = button.toJSON();
        assert.ok('custom_id' in json && json.custom_id.length <= 100);
        assert.ok('label' in json && !decorative.test(json.label!));
      }
    }
  }
});

test('saved answer edits the same message and keeps recap without a second ping', async () => {
  let edited: MessageEditOptions | undefined, editedId = '';
  const channel = { isTextBased: () => true, isDMBased: () => false, guildId: goal.guildId,
    messages: { edit: async (id: string, payload: MessageEditOptions) => { editedId = id; edited = payload; } } };
  const client = { channels: { fetch: async () => channel } } as unknown as Client;
  const response = record('2026-10-06', 'yes', 2);
  assert.equal(await refreshReminder(client, goal, response, [record('2026-10-05', 'yes'), response]), true);
  assert.equal(editedId, '987');
  assert.deepEqual(edited!.allowedMentions, { parse: [] });
  const row = edited!.components![0]!;
  const json = 'toJSON' in row ? row.toJSON() : row;
  assert.ok('components' in json);
  assert.ok('disabled' in json.components[0]! && json.components[0]!.disabled);
  assert.ok('disabled' in json.components[1]! && json.components[1]!.disabled);
  assert.ok('custom_id' in json.components[2]! && json.components[2]!.custom_id === 'goal:recap:12');
  assert.equal(await refreshReminder({ channels: { fetch: async () => null } } as unknown as Client, goal, response, [response]), false);
});

test('French dates and inclusive day numbers are preserved', () => {
  assert.equal(frenchDate('2026-10-07'), '07/10/2026');
  assert.equal(goalDayNumber(goal, '2026-10-07'), 3);
});
