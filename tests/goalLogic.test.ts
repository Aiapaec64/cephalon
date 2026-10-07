import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAttemptDelivery, dateRange, dayStatus, localClock, parseDate, parseGoalId, progressSummary, reminderDate, validateGoal, RECAP_PAGE_SIZE } from '../src/services/goalLogic.js';
import { parseGoalComponent } from '../src/components/goalIds.js';
import { reminderButtons, reminderMessage } from '../src/components/goalMessages.js';
import { listPayload, recapPayload } from '../src/services/goalRecap.js';
import type { Goal } from '../src/db/schema.js';
import { commands } from '../src/commands/index.js';
import { frenchDate } from '../src/services/goalPresentation.js';

const input = { title: 'Abdos pendant un mois', startDate: '2026-10-05', durationMonths: 1, reminderTime: '18:00' };
const goal: Goal = { ...validateGoal(input), id: 12, guildId: '1', channelId: '2', creatorUserId: '3', targetUserId: '4', active: true, createdAt: new Date(), updatedAt: new Date() };

test('past start date accepted; one calendar month has an inclusive end', () => {
  assert.equal(goal.startDate, '2026-10-05');
  assert.equal(goal.endDate, '2026-11-04');
  assert.equal(dateRange(goal.startDate, goal.endDate).length, 31);
  assert.equal(goal.timezone, 'Europe/Brussels');
});

test('day durations, leap years, and month-end clamping', () => {
  assert.equal(validateGoal({ ...input, durationMonths: null, durationDays: 1 }).endDate, '2026-10-05');
  assert.equal(validateGoal({ ...input, startDate: '2024-02-28', durationMonths: null, durationDays: 3 }).endDate, '2024-03-01');
  assert.equal(validateGoal({ ...input, startDate: '2026-01-31' }).endDate, '2026-02-27');
});

test('reject malformed or impossible dates, times, zones, titles, and durations', () => {
  for (const value of ['2026-02-30', '2026-2-03', '2026-13-01', '0000-01-01', 'hello', '2026-10-05T00:00']) assert.throws(() => parseDate(value));
  for (const reminderTime of ['24:00', '18:60', '8:00', '18:00:00']) assert.throws(() => validateGoal({ ...input, reminderTime }));
  for (const change of [{ durationDays: 1 }, { durationMonths: null }, { durationMonths: 0 }, { durationMonths: 1.5 }, { durationMonths: 121 }, { timezone: 'Not/AZone' }, { title: '   ' }, { title: 'x'.repeat(201) }]) {
    assert.throws(() => validateGoal({ ...input, ...change }));
  }
  assert.throws(() => validateGoal({ ...input, startDate: '9999-12-31' }));
});

test('due at configured wall time, catches up only today, and respects inclusive bounds', () => {
  assert.equal(reminderDate(goal, new Date('2026-10-06T15:59:00Z')), null);
  assert.equal(reminderDate(goal, new Date('2026-10-06T16:00:00Z')), '2026-10-06');
  assert.equal(reminderDate(goal, new Date('2026-10-06T16:02:00Z')), '2026-10-06');
  assert.equal(reminderDate(goal, new Date('2026-10-04T20:00:00Z')), null);
  assert.equal(reminderDate(goal, new Date('2026-11-04T17:00:00Z')), '2026-11-04');
  assert.equal(reminderDate(goal, new Date('2026-11-05T17:00:00Z')), null);
  assert.equal(reminderDate({ ...goal, active: false }, new Date('2026-10-06T16:02:00Z')), null);
});

test('IANA zones and local date boundaries do not depend on host timezone', () => {
  assert.deepEqual(localClock('Europe/Brussels', new Date('2026-10-05T22:30:00Z')), { date: '2026-10-06', time: '00:30' });
  assert.deepEqual(localClock('America/New_York', new Date('2026-10-06T01:00:00Z')), { date: '2026-10-05', time: '21:00' });
});

test('DST spring gap catches up after gap; autumn repeated hour maps to one date', () => {
  const spring = { ...goal, startDate: '2026-03-01', endDate: '2026-11-01', reminderTime: '02:30' };
  assert.equal(reminderDate(spring, new Date('2026-03-29T00:59:00Z')), null);
  assert.equal(reminderDate(spring, new Date('2026-03-29T01:00:00Z')), '2026-03-29');
  assert.equal(reminderDate(spring, new Date('2026-10-25T00:30:00Z')), '2026-10-25');
  assert.equal(reminderDate(spring, new Date('2026-10-25T01:30:00Z')), '2026-10-25');
});

test('delivery eligibility excludes already sent, in-flight, unknown, and backfilled reminders', () => {
  const now = new Date('2026-10-06T16:02:00Z');
  assert.equal(canAttemptDelivery('queued', null, now), true);
  assert.equal(canAttemptDelivery('queued', new Date('2026-10-06T16:03:00Z'), now), false);
  for (const state of ['sending', 'sent', 'uncertain', 'skipped'] as const) assert.equal(canAttemptDelivery(state, null, now), false);
});

test('recap separates historical unanswered, today, future, and explicit results', () => {
  assert.equal(dayStatus('2026-10-05', '2026-10-06'), 'missed');
  assert.equal(dayStatus('2026-10-05', '2026-10-06', 'pending'), 'missed');
  assert.equal(dayStatus('2026-10-06', '2026-10-06'), 'pending');
  assert.equal(dayStatus('2026-10-07', '2026-10-06'), 'future');
  assert.equal(dayStatus('2026-10-05', '2026-10-06', 'yes'), 'yes');
  assert.equal(dayStatus('2026-10-05', '2026-10-06', 'no'), 'no');
  const stats = progressSummary(['yes', 'yes', 'no', 'future', 'pending']);
  assert.equal(stats.successRate.toFixed(1), '66.7');
  assert.equal(stats.remaining, 2);
  assert.equal(progressSummary(['future']).successRate, 0);
  assert.equal(progressSummary(['yes', 'missed', 'pending']).successRate, 100);
});

test('recap covers all dates across bounded pages; lists fit embed limits', () => {
  const longGoal = { ...goal, ...validateGoal({ ...input, durationMonths: null, durationDays: 3660 }) };
  const dates: string[] = [];
  for (let page = 0; page < Math.ceil(3660 / RECAP_PAGE_SIZE); page++) {
    const payload = recapPayload(longGoal, [], page, new Date('2026-10-06T10:00Z'));
    const embed = payload.embeds[0]!.toJSON();
    assert.ok((embed.description?.length ?? 0) <= 4096);
    assert.ok(payload.embeds[0]!.length <= 6000);
    const displayedDays = embed.fields!.find((field) => field.name === 'Historique')!.value.split('\n');
    assert.ok(displayedDays.length <= 6);
    dates.push(...displayedDays.map((row) => row.match(/\d{2}\/\d{2}/)![0]));
    for (const button of payload.components.flatMap((row) => row.components)) {
      const data = button.toJSON();
      assert.ok('custom_id' in data && data.custom_id.length <= 100);
    }
  }
  assert.deepEqual(dates, dateRange(longGoal.startDate, longGoal.endDate).map((date) => frenchDate(date, 'short')));
  const list = listPayload(Array.from({ length: 25 }, (_, i) => ({ ...goal, id: i + 1, title: 'x'.repeat(200) })));
  assert.equal(list.embeds[0]!.data.fields?.length, 10);
  assert.ok(list.embeds[0]!.length <= 6000);
});

test('structured button IDs validate and preserve recap after answering', () => {
  assert.deepEqual(parseGoalComponent('goal:yes:12:2026-10-06'), { action: 'yes', id: 12, date: '2026-10-06' });
  assert.deepEqual(parseGoalComponent('goal:recap:12:2'), { action: 'recap', id: 12, page: 2 });
  assert.deepEqual(parseGoalComponent('goal:recap:12'), { action: 'recap', id: 12, page: 'today' });
  assert.deepEqual(parseGoalComponent('goal:recap:12:today'), { action: 'recap', id: 12, page: 'today' });
  assert.equal(parseGoalComponent('other:action'), null);
  for (const id of ['goal:yes:0:2026-10-06', 'goal:no:12:2026-02-30', 'goal:recap:12:-1', 'goal:unknown:12', 'goal:yes:12:2026-10-06:extra']) assert.throws(() => parseGoalComponent(id));
  for (const id of ['-1', '12abc', '2147483648', '01']) assert.throws(() => parseGoalId(id));
  const buttons = reminderButtons(12, '2026-10-06', true).toJSON().components;
  assert.equal(buttons[0]!.disabled, true);
  assert.equal(buttons[1]!.disabled, true);
  assert.equal(buttons[2]!.disabled, false);
  const message = reminderMessage({ ...goal, title: '@everyone **test**' }, '2026-10-06');
  assert.deepEqual(message.allowedMentions, { parse: [], users: ['4'] });
  assert.ok(message.nonce.length <= 25);
  assert.equal(message.enforceNonce, true);
});

test('Discord command JSON has required options before optional options', () => {
  for (const command of commands.values()) assert.doesNotThrow(() => command.data.toJSON());
  const json = commands.get('goal')!.data.toJSON();
  assert.deepEqual(json.options?.map((option) => option.name), ['create', 'list', 'show', 'stop', 'set-day']);
  const create = json.options?.[0];
  assert.ok(create && 'options' in create);
  let optionalSeen = false;
  for (const option of create.options ?? []) {
    if (!('required' in option) || !option.required) optionalSeen = true;
    else assert.equal(optionalSeen, false, 'Required options must precede optional options.');
  }
});
