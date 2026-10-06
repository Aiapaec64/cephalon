import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Collection, DiscordAPIError, type Client, type Message, type MessageCreateOptions } from 'discord.js';
import { refreshReminder } from '../src/components/goalMessages.js';
import { createDatabase } from '../src/db/index.js';
import { goalCheckins, goals, type Goal } from '../src/db/schema.js';
import { GoalService } from '../src/services/goalService.js';
import { GoalScheduler } from '../src/services/goalScheduler.js';
import { isoDate, localClock } from '../src/services/goalLogic.js';
import { recapPayload } from '../src/services/goalRecap.js';

// Opt-in, isolated PostgreSQL only. Never reads .env or DATABASE_URL.
const testUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL constraints, authorization, concurrency, and restart recovery', { skip: !testUrl }, async (t) => {
  const url = new URL(testUrl!);
  assert.match(url.pathname, /^\/cephalon_test(?:_[a-z0-9]+)?$/i, 'Use a dedicated database named cephalon_test or cephalon_test_<suffix>.');
  let connection = createDatabase(testUrl!);
  const goalIds: number[] = [];
  const today = localClock('UTC').date;
  const yesterday = isoDate(DateTime.fromISO(today, { zone: 'UTC' }).minus({ days: 1 }));
  const tomorrow = isoDate(DateTime.fromISO(today, { zone: 'UTC' }).plus({ days: 1 }));
  const messages = new Collection<string, Message>();
  let sends = 0;
  let sendMode: 'normal' | 'accepted-timeout' | 'rejected' = 'normal';
  let channelAvailable = true;
  let memberAvailable = true;
  let messageAvailable = true;
  const guild = { members: { fetch: async () => { if (!memberAvailable) throw new Error('Member unavailable'); return {}; }, fetchMe: async () => ({}) } };
  const channel = {
    id: '202', guildId: '101', guild,
    isSendable: () => true, isTextBased: () => true, isDMBased: () => false, isThread: () => false,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => messages, edit: async () => { if (!messageAvailable) throw new Error('Deleted message'); return {}; } },
    send: async (payload: MessageCreateOptions) => {
      sends++;
      if (sendMode === 'rejected') throw new DiscordAPIError({ code: 50013, message: 'Missing permissions' }, 50013, 403, 'POST', 'https://discord.com/api/v10/channels/202/messages', { body: {}, files: [] });
      const id = String(100000 + sends);
      const components = (payload.components ?? []).map((row) => {
        const json = 'toJSON' in row ? row.toJSON() : row;
        return { components: 'components' in json ? json.components.map((button) => ({ customId: 'custom_id' in button ? button.custom_id : null })) : [] };
      });
      const message = { id, author: { id: '505' }, components, createdTimestamp: Date.now() } as unknown as Message;
      messages.set(id, message);
      if (sendMode === 'accepted-timeout') throw new Error('Simulated lost response');
      return message;
    },
  };
  const client = {
    user: { id: '505' }, isReady: () => true,
    channels: { fetch: async () => { if (!channelAvailable) throw new Error('Deleted channel'); return channel; } },
    guilds: { fetch: async () => guild },
  } as unknown as Client;
  const service = () => new GoalService(connection.db);
  const scheduler = () => new GoalScheduler(client, connection);
  const makeGoal = async (changes: Partial<{ startDate: string; durationDays: number; title: string }> = {}) => {
    const goal = await service().create({ title: 'Integration goal', startDate: yesterday, durationDays: 3, reminderTime: '00:00', timezone: 'UTC',
      guildId: '101', channelId: '202', creatorUserId: '303', targetUserId: '404', ...changes });
    goalIds.push(goal.id);
    return goal;
  };
  const checkin = async (goal: Goal) => {
    const [row] = await connection.db.select().from(goalCheckins).where(and(eq(goalCheckins.goalId, goal.id), eq(goalCheckins.checkinDate, today)));
    assert.ok(row);
    return row;
  };

  try {
    const folder = fileURLToPath(new URL('../migrations/', import.meta.url));
    await migrate(connection.db, { migrationsFolder: folder });
    await migrate(connection.db, { migrationsFolder: folder });
    const mainGoal = await makeGoal();

    await t.test('concurrent workers and repeated ticks send exactly once, with no historical sends', async () => {
      await Promise.all([scheduler().tick(), scheduler().tick(), scheduler().tick()]);
      await scheduler().tick();
      assert.equal(sends, 1);
      const rows = await service().checkins(mainGoal.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.checkinDate, today);
      assert.equal(rows[0]!.deliveryState, 'sent');
      assert.ok(rows[0]!.discordMessageId);
      const recap = recapPayload(mainGoal, rows).embeds[0]!.toJSON();
      assert.ok(recap.description!.includes(`⚪ ${yesterday}`));
    });

    await t.test('PostgreSQL enforces uniqueness, foreign keys, and response invariants', async () => {
      await assert.rejects(connection.db.insert(goalCheckins).values({ goalId: mainGoal.id, checkinDate: today }));
      await assert.rejects(connection.db.insert(goalCheckins).values({ goalId: 2147483647, checkinDate: today }));
      await assert.rejects(connection.db.insert(goalCheckins).values({ goalId: mainGoal.id, checkinDate: tomorrow, status: 'yes' }));
    });

    await t.test('restart uses persistent sent record and cannot duplicate delivery', async () => {
      await connection.pool.end();
      connection = createDatabase(testUrl!);
      await scheduler().tick();
      assert.equal(sends, 1);
      assert.equal((await checkin(mainGoal)).deliveryState, 'sent');
    });

    await t.test('cross-guild access denied; target-only, immutable and atomic responses', async () => {
      await assert.rejects(service().get(mainGoal.id, '999'), /introuvable/);
      const row = await checkin(mainGoal);
      const input = { id: mainGoal.id, date: today, guildId: '101', userId: '404', messageId: row.discordMessageId! };
      await assert.rejects(service().answer({ ...input, userId: '303', status: 'yes' }), /concerné/);
      await assert.rejects(service().answer({ ...input, messageId: 'wrong', status: 'yes' }), /déjà/);
      const results = await Promise.allSettled([service().answer({ ...input, status: 'yes' }), service().answer({ ...input, status: 'no' })]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.ok((await checkin(mainGoal)).respondedAt);
      await assert.rejects(service().answer({ ...input, status: 'yes' }), /déjà/);
    });

    await t.test('creator/admin backfill, invalid date rejection, and creator/admin stop', async () => {
      const base = { id: mainGoal.id, guildId: '101', actorId: '303', administrator: false, date: yesterday, status: 'yes' as const };
      await assert.rejects(service().setDay({ ...base, actorId: '404' }), /créateur/);
      await assert.rejects(service().setDay({ ...base, date: tomorrow }), /passé/);
      await assert.rejects(service().setDay({ ...base, date: '2026-02-30' }), /date valide/);
      await service().setDay(base);
      await service().setDay({ ...base, status: 'no', actorId: '999', administrator: true });
      assert.equal((await service().checkins(mainGoal.id)).find((row) => row.checkinDate === yesterday)?.status, 'no');
      await assert.rejects(service().stop(mainGoal.id, '101', '404', false), /créateur/);
      await service().stop(mainGoal.id, '101', '303', false);
      assert.equal((await service().get(mainGoal.id, '101')).active, false);
    });

    await t.test('deleted Discord message cannot undo a persisted answer', async () => {
      const goal = await service().get(mainGoal.id, '101');
      const row = await checkin(goal);
      messageAvailable = false;
      await assert.doesNotReject(refreshReminder(client, goal, row));
      messageAvailable = true;
      assert.equal((await checkin(goal)).status, row.status);
      assert.ok((await checkin(goal)).respondedAt);
    });

    await t.test('backfilled current day suppresses reminder; future/expired/stopped goals do not send', async () => {
      const goal = await makeGoal();
      await service().setDay({ id: goal.id, guildId: '101', actorId: '303', administrator: false, date: today, status: 'yes' });
      await makeGoal({ startDate: tomorrow });
      const expired = await makeGoal({ durationDays: 1 });
      assert.equal(expired.active, false);
      const stopped = await makeGoal();
      await service().stop(stopped.id, '101', '999', true);
      const count = sends;
      await scheduler().tick();
      assert.equal(sends, count);
    });

    await t.test('restart reconciles a delivered message whose DB write was interrupted', async () => {
      const goal = await makeGoal();
      await scheduler().tick();
      const row = await checkin(goal);
      const originalId = row.discordMessageId;
      const count = sends;
      await connection.db.update(goalCheckins).set({ discordMessageId: null, deliveryState: 'sending' }).where(eq(goalCheckins.id, row.id));
      await scheduler().tick();
      assert.equal(sends, count);
      assert.equal((await checkin(goal)).discordMessageId, originalId);
      assert.equal((await checkin(goal)).deliveryState, 'sent');
    });

    await t.test('crash before actual send conservatively preserves uncertain state without replay', async () => {
      const goal = await makeGoal();
      await connection.db.insert(goalCheckins).values({ goalId: goal.id, checkinDate: today, deliveryState: 'sending', attemptedAt: new Date() });
      const count = sends;
      await scheduler().tick();
      await scheduler().tick();
      assert.equal(sends, count);
      assert.equal((await checkin(goal)).deliveryState, 'uncertain');
    });

    await t.test('Discord accepted message but response was lost: recover without second ping', async () => {
      const goal = await makeGoal();
      sendMode = 'accepted-timeout';
      const count = sends;
      await scheduler().tick();
      assert.equal((await checkin(goal)).deliveryState, 'uncertain');
      sendMode = 'normal';
      await scheduler().tick();
      assert.equal(sends, count + 1);
      assert.equal((await checkin(goal)).deliveryState, 'sent');
    });

    await t.test('explicit Discord rejection retries after delay instead of becoming uncertain', async () => {
      const goal = await makeGoal();
      sendMode = 'rejected';
      const count = sends;
      await scheduler().tick();
      const row = await checkin(goal);
      assert.equal(row.deliveryState, 'queued');
      assert.ok(row.retryAt);
      assert.equal(row.lastErrorCode, '50013');
      sendMode = 'normal';
      await scheduler().tick();
      assert.equal(sends, count + 1);
      await connection.db.update(goalCheckins).set({ retryAt: new Date(0) }).where(eq(goalCheckins.id, row.id));
      await scheduler().tick();
      assert.equal(sends, count + 2);
      assert.equal((await checkin(goal)).deliveryState, 'sent');
    });

    await t.test('deleted channel or departed member retries safely; one failure does not kill other reminders', async () => {
      const goal = await makeGoal();
      channelAvailable = false;
      const count = sends;
      await scheduler().tick();
      channelAvailable = true;
      assert.equal((await checkin(goal)).deliveryState, 'queued');
      assert.ok((await checkin(goal)).retryAt);
      await scheduler().tick();
      assert.equal(sends, count);
      const other = await makeGoal();
      memberAvailable = false;
      await scheduler().tick();
      memberAvailable = true;
      assert.equal((await checkin(other)).deliveryState, 'queued');
      const healthy = await makeGoal();
      await scheduler().tick();
      assert.equal((await checkin(healthy)).deliveryState, 'sent');
      assert.equal(sends, count + 1);
    });
  } finally {
    // Only fixture rows created by this test are removed.
    for (const id of goalIds) await connection.db.delete(goals).where(eq(goals.id, id));
    await connection.pool.end();
  }
});
