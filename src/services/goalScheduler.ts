import { and, asc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DiscordAPIError, PermissionFlagsBits, type Client, type Message, type SendableChannels } from 'discord.js';
import { database, type createDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import { goals, goalCheckins, type Goal, type GoalCheckin } from '../db/schema.js';
import { canAttemptDelivery, localClock, reminderDate } from './goalLogic.js';
import { refreshReminder, reminderMessage } from '../components/goalMessages.js';
import { logError } from '../utils/logError.js';

type Database = NodePgDatabase<typeof schema>;
type DatabaseConnection = ReturnType<typeof createDatabase>;

function errorCode(error: unknown): string {
  if (error instanceof DiscordAPIError && typeof error.code === 'number') return String(error.code);
  return 'ACCESS_OR_NETWORK_ERROR';
}

export class GoalScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private started = false;

  constructor(private readonly client: Client, private readonly connection: DatabaseConnection = database()) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.run();
  }

  private run(): void {
    const started = Date.now();
    this.running = this.tick().catch((error: unknown) => logError('Goal scheduler tick failed.', error)).finally(() => {
      if (!this.stopped) this.timer = setTimeout(() => this.run(), Math.max(1000, 60000 - (Date.now() - started)));
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  async tick(): Promise<void> {
    if (!this.client.isReady()) return;
    const session = await this.connection.pool.connect();
    session.on('error', (error) => logError('Scheduler PostgreSQL session failed.', error));
    try {
      // A dedicated session lock serializes overlapping processes during redeploys.
      const lock = await session.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(1128613960, 1) AS locked');
      if (!lock.rows[0]?.locked) return;
      const db = drizzle(session, { schema });
      let cursor = 0;
      while (!this.stopped) {
        const batch = await db.select().from(goals).where(and(gt(goals.id, cursor), or(
          eq(goals.active, true),
          sql`EXISTS (SELECT 1 FROM goal_checkins c WHERE c.goal_id = ${goals.id} AND (c.status = 'pending' OR c.delivery_state IN ('sending', 'uncertain')))`,
        ))).orderBy(asc(goals.id)).limit(100);
        if (!batch.length) break;
        for (const goal of batch) {
          if (this.stopped) break;
          cursor = goal.id;
          try { await this.processGoal(db, goal); } catch (error) {
            logError(`Goal ${goal.id}: reminder processing failed.`, error);
          }
        }
      }
    } finally {
      // Destroy this dedicated session: its advisory lock must never return to the pool.
      session.release(true);
    }
  }

  private async processGoal(db: Database, goal: Goal): Promise<void> {
    const now = new Date();
    const today = localClock(goal.timezone, now).date;
    await db.update(goalCheckins).set({ status: 'missed' }).where(and(
      eq(goalCheckins.goalId, goal.id), eq(goalCheckins.status, 'pending'), lt(goalCheckins.checkinDate, today),
    ));
    if (goal.active && today > goal.endDate) {
      await db.update(goals).set({ active: false, updatedAt: now }).where(eq(goals.id, goal.id));
    }
    // A sending row on a newly acquired scheduler lock means the previous delivery was interrupted.
    await db.update(goalCheckins).set({ deliveryState: 'uncertain', lastErrorCode: 'INTERRUPTED_SEND' }).where(and(
      eq(goalCheckins.goalId, goal.id), eq(goalCheckins.deliveryState, 'sending'),
    ));
    const unresolved = await db.select().from(goalCheckins).where(and(
      eq(goalCheckins.goalId, goal.id), eq(goalCheckins.deliveryState, 'uncertain'),
      sql`(${goalCheckins.retryAt} IS NULL OR ${goalCheckins.retryAt} <= ${now})`,
    ));
    for (const row of unresolved) await this.reconcile(db, goal, row);

    const date = reminderDate(goal, new Date());
    if (!date) return;
    await db.insert(goalCheckins).values({ goalId: goal.id, checkinDate: date })
      .onConflictDoNothing({ target: [goalCheckins.goalId, goalCheckins.checkinDate] });
    const [checkin] = await db.select().from(goalCheckins).where(and(eq(goalCheckins.goalId, goal.id), eq(goalCheckins.checkinDate, date)));
    if (!checkin || checkin.status !== 'pending' || !canAttemptDelivery(checkin.deliveryState, checkin.retryAt, new Date())) return;

    let channel: SendableChannels;
    try {
      channel = await this.channelFor(goal);
      const guild = await this.client.guilds.fetch(goal.guildId);
      await guild.members.fetch(goal.targetUserId);
    } catch (error) {
      await db.update(goalCheckins).set({ retryAt: new Date(Date.now() + 15 * 60000), lastErrorCode: errorCode(error) })
        .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'queued')));
      logError(`Goal ${goal.id}, ${date}: reminder preflight failed; retry in 15 minutes.`, error);
      return;
    }

    const claimed = await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(goals).where(eq(goals.id, goal.id)).for('update');
      if (!fresh || reminderDate(fresh, new Date()) !== date) return false;
      const rows = await tx.update(goalCheckins).set({ deliveryState: 'sending', attemptedAt: new Date(), retryAt: null, lastErrorCode: null })
        .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'queued'), eq(goalCheckins.status, 'pending'))).returning({ id: goalCheckins.id });
      return rows.length === 1;
    });
    if (!claimed) return;
    try {
      const message = await channel.send(reminderMessage(goal, date));
      const [saved] = await db.update(goalCheckins).set({ deliveryState: 'sent', discordMessageId: message.id, lastErrorCode: null })
        .where(eq(goalCheckins.id, checkin.id)).returning();
      if (saved && saved.status !== 'pending') await refreshReminder(this.client, goal, saved);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.status >= 400 && error.status < 500) {
        // An explicit rejection is proof that Discord did not create this message.
        await db.update(goalCheckins).set({ deliveryState: 'queued', lastErrorCode: errorCode(error), retryAt: new Date(Date.now() + 15 * 60000) })
          .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'sending')));
        logError(`Goal ${goal.id}, ${date}: Discord rejected reminder; retry in 15 minutes.`, error);
        return;
      }
      // Never resend after an ambiguous Discord/DB failure: delivery may already have succeeded.
      await db.update(goalCheckins).set({ deliveryState: 'uncertain', lastErrorCode: errorCode(error), retryAt: null })
        .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'sending')));
      logError(`Goal ${goal.id}, ${date}: send outcome uncertain; automatic resend suppressed.`, error);
    }
  }

  private async channelFor(goal: Goal): Promise<SendableChannels> {
    const channel = await this.client.channels.fetch(goal.channelId);
    if (!channel?.isSendable() || channel.isDMBased() || channel.guildId !== goal.guildId) throw new Error('Goal channel unavailable.');
    if (channel.isThread() && (channel.archived || channel.locked)) throw new Error('Goal thread is closed.');
    const permissions = channel.permissionsFor(await channel.guild.members.fetchMe());
    const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) throw new Error('Missing channel permissions.');
    return channel;
  }

  private async reconcile(db: Database, goal: Goal, checkin: GoalCheckin): Promise<void> {
    // Bounded history lookup. Absence is never treated as proof that it is safe to send again.
    try {
      const channel = await this.channelFor(goal);
      let before: string | undefined;
      const cutoff = (checkin.attemptedAt ?? checkin.createdAt).getTime() - 5000;
      for (let page = 0; page < 5; page++) {
        const messages = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
        if (!messages.size) break;
        const expected = `goal:yes:${goal.id}:${checkin.checkinDate}`;
        const match = messages.find((message: Message) => message.author.id === this.client.user?.id &&
          message.components.some((row) => 'components' in row && row.components.some((component) => 'customId' in component && component.customId === expected)));
        if (match) {
          await db.update(goalCheckins).set({ deliveryState: 'sent', discordMessageId: match.id, retryAt: null, lastErrorCode: null })
            .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'uncertain')));
          console.log(`Goal ${goal.id}, ${checkin.checkinDate}: recovered delivered reminder.`);
          return;
        }
        const oldest = messages.last();
        if (!oldest || oldest.createdTimestamp < cutoff) break;
        before = oldest.id;
      }
    } catch (error) {
      logError(`Goal ${goal.id}, ${checkin.checkinDate}: could not reconcile uncertain delivery.`, error);
    }
    await db.update(goalCheckins).set({ retryAt: new Date(Date.now() + 60 * 60000) })
      .where(and(eq(goalCheckins.id, checkin.id), eq(goalCheckins.deliveryState, 'uncertain')));
  }
}
