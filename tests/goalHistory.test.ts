import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from 'discord.js';
import type { Goal, GoalCheckin } from '../src/db/schema.js';
import { assertHistoryAccess, historyPayload, validateHistoryDate } from '../src/services/goalHistory.js';
import { unansweredPastDates } from '../src/services/goalPresentation.js';
import { parseGoalComponent } from '../src/components/goalIds.js';
import { handleHistoryButton, type HistoryService } from '../src/components/goalHistoryButtons.js';

const now = new Date('2026-10-07T10:00Z');
const goal: Goal = { id: 12, title: 'Test', guildId: '101', channelId: '202', creatorUserId: '303', targetUserId: '404',
  startDate: '2026-10-05', endDate: '2026-10-10', reminderTime: '17:00', timezone: 'Europe/Brussels', active: true, createdAt: now, updatedAt: now };
function record(date: string, status: GoalCheckin['status']): GoalCheckin {
  return { id: 1, goalId: goal.id, checkinDate: date, status, respondedAt: status === 'yes' || status === 'no' ? now : null,
    discordMessageId: null, deliveryState: 'skipped', attemptedAt: null, retryAt: null, lastErrorCode: null, createdAt: now };
}

test('historical dates exclude today, future and answered dates, including fully historical goals', () => {
  assert.deepEqual(unansweredPastDates(goal, [], now), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(unansweredPastDates(goal, [record('2026-10-05', 'yes')], now), ['2026-10-06']);
  assert.deepEqual(unansweredPastDates(goal, [record('2026-10-05', 'no'), record('2026-10-06', 'missed')], now), ['2026-10-06']);
  assert.deepEqual(unansweredPastDates({ ...goal, startDate: '2026-10-08' }, [], now), []);
  assert.equal(unansweredPastDates({ ...goal, active: false, endDate: '2026-10-06' }, [], now).length, 2);
  assert.deepEqual(unansweredPastDates(goal, [], new Date('2026-10-05T22:30:00Z')), ['2026-10-05']);
});

test('history opens the first missing date and advances one date without changing skipped dates', () => {
  const first = historyPayload(goal, [], undefined, now);
  assert.equal(first.embeds[0]!.data.title, 'Historique');
  assert.equal(first.embeds[0]!.data.fields![0]!.value, '05/10/2026');
  assert.equal(historyPayload(goal, [], '2026-10-05', now).embeds[0]!.data.fields![0]!.value, '06/10/2026');
  const skippedEnd = historyPayload(goal, [], '2026-10-06', now);
  assert.equal(skippedEnd.embeds[0]!.data.title, 'Historique parcouru');
  assert.ok(skippedEnd.embeds[0]!.data.description!.includes('2 journée(s) restent sans réponse'));
  const completed = historyPayload(goal, [record('2026-10-05', 'yes'), record('2026-10-06', 'no')], '2026-10-06', now);
  assert.equal(completed.embeds[0]!.data.title, 'Historique complété');
  assert.equal(completed.components[0]!.components.length, 1);
});

test('history permissions stay creator/admin-only and dates must be strictly historical', () => {
  assert.doesNotThrow(() => assertHistoryAccess(goal, '303', false));
  assert.doesNotThrow(() => assertHistoryAccess(goal, '999', true));
  assert.throws(() => assertHistoryAccess(goal, '404', false), /créateur/);
  for (const date of ['2026-10-04', '2026-10-07', '2026-10-11', 'not-a-date']) assert.throws(() => validateHistoryDate(goal, date, now));
  assert.doesNotThrow(() => validateHistoryDate(goal, '2026-10-06', now));
});

test('history IDs round-trip, contain no secrets, and reject malformed choices/dates', () => {
  assert.deepEqual(parseGoalComponent('goal:history:12'), { action: 'history', id: 12 });
  for (const choice of ['yes', 'no', 'skip'] as const) {
    assert.deepEqual(parseGoalComponent(`goal:history:12:2026-10-05:${choice}`), { action: 'history', id: 12, date: '2026-10-05', choice });
  }
  for (const id of ['goal:history:0', 'goal:history:12:2026-02-30:yes', 'goal:history:12:2026-10-05:edit', 'goal:history:12:2026-10-05']) assert.throws(() => parseGoalComponent(id));
  for (const button of historyPayload(goal, [], undefined, now).components[0]!.components) {
    const json = button.toJSON();
    assert.ok('custom_id' in json && json.custom_id.length <= 100);
    assert.ok('custom_id' in json && parseGoalComponent(json.custom_id));
  }
});

test('button workflow saves yes/no, edits the same ephemeral message, and skips without writing', async () => {
  const historical = { ...goal, startDate: '2020-01-01', endDate: '2020-01-03', active: false };
  const rows: GoalCheckin[] = [];
  const writes: string[] = [];
  const updates: ReturnType<typeof historyPayload>[] = [];
  let deferrals = 0;
  const service: HistoryService = {
    get: async (id, guildId) => { assert.equal(id, 12); assert.equal(guildId, '101'); return historical; },
    checkins: async () => rows,
    setDay: async (input, unansweredOnly) => {
      assert.equal(unansweredOnly, true);
      const row = record(input.date, input.status);
      rows.push(row); writes.push(input.status);
      return { goal: historical, checkin: row };
    },
  };
  const interaction = { guildId: '101', user: { id: '303' }, memberPermissions: { has: () => false },
    message: { flags: { has: (flag: number) => flag === MessageFlags.Ephemeral } },
    deferUpdate: async () => { deferrals++; },
    editReply: async (payload: ReturnType<typeof historyPayload>) => { updates.push(payload); },
  } as unknown as ButtonInteraction;
  await handleHistoryButton(interaction, { action: 'history', id: 12 }, service);
  await handleHistoryButton(interaction, { action: 'history', id: 12, date: '2020-01-01', choice: 'yes' }, service);
  await handleHistoryButton(interaction, { action: 'history', id: 12, date: '2020-01-02', choice: 'skip' }, service);
  await handleHistoryButton(interaction, { action: 'history', id: 12, date: '2020-01-03', choice: 'no' }, service);
  assert.deepEqual(writes, ['yes', 'no']);
  assert.equal(deferrals, 4);
  assert.equal(updates[0]!.embeds[0]!.data.fields![0]!.value, '01/01/2020');
  assert.equal(updates[1]!.embeds[0]!.data.fields![0]!.value, '02/01/2020');
  assert.equal(updates[2]!.embeds[0]!.data.fields![0]!.value, '03/01/2020');
  assert.equal(updates[3]!.embeds[0]!.data.title, 'Historique parcouru');
  assert.deepEqual(unansweredPastDates(historical, rows), ['2020-01-02']);
});

test('unauthorized history clicks cannot save a response', async () => {
  let writes = 0;
  const interaction = { guildId: '101', user: { id: '404' },
    memberPermissions: { has: (permission: bigint) => { assert.equal(permission, PermissionFlagsBits.Administrator); return false; } },
    message: { flags: { has: () => true } }, deferUpdate: async () => {},
  } as unknown as ButtonInteraction;
  const service: HistoryService = {
    get: async () => goal, checkins: async () => [], setDay: async () => { writes++; throw new Error('Unexpected write'); },
  };
  await assert.rejects(handleHistoryButton(interaction, { action: 'history', id: 12, date: '2026-10-05', choice: 'yes' }, service), /créateur/);
  assert.equal(writes, 0);
});
