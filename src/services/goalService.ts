import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { database, type createDatabase } from '../db/index.js';
import { goals, goalCheckins } from '../db/schema.js';
import { GoalInputError, localClock, validateGoal, parseDate, type GoalInput } from './goalLogic.js';

type Database = ReturnType<typeof createDatabase>['db'];
export class GoalService {
  constructor(readonly db: Database) {}

  async create(input: GoalInput & { guildId: string; channelId: string; creatorUserId: string; targetUserId: string }) {
    const validated = validateGoal(input);
    const [goal] = await this.db.insert(goals).values({
      ...validated, guildId: input.guildId, channelId: input.channelId,
      creatorUserId: input.creatorUserId, targetUserId: input.targetUserId,
      active: localClock(validated.timezone).date <= validated.endDate,
    }).returning();
    if (!goal) throw new Error('Goal insert returned no row.');
    return goal;
  }

  async get(id: number, guildId: string) {
    const [goal] = await this.db.select().from(goals).where(and(eq(goals.id, id), eq(goals.guildId, guildId)));
    if (!goal) throw new GoalInputError('Objectif introuvable dans ce serveur.');
    return goal;
  }

  checkins(id: number) {
    return this.db.select().from(goalCheckins).where(eq(goalCheckins.goalId, id)).orderBy(asc(goalCheckins.checkinDate));
  }

  async list(guildId: string, userId: string) {
    const rows = await this.db.select().from(goals).where(and(
      eq(goals.guildId, guildId), eq(goals.active, true),
      or(eq(goals.creatorUserId, userId), eq(goals.targetUserId, userId)),
    )).orderBy(desc(goals.id));
    return rows.filter((goal) => localClock(goal.timezone).date <= goal.endDate);
  }

  async stop(id: number, guildId: string, actorId: string, administrator: boolean) {
    return this.db.transaction(async (tx) => {
      const [goal] = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.guildId, guildId))).for('update');
      if (!goal) throw new GoalInputError('Objectif introuvable dans ce serveur.');
      if (goal.creatorUserId !== actorId && !administrator) throw new GoalInputError('Seul le créateur ou un administrateur peut arrêter cet objectif.');
      await tx.update(goals).set({ active: false, updatedAt: new Date() }).where(eq(goals.id, id));
      return goal;
    });
  }

  async answer(input: { id: number; date: string; guildId: string; userId: string; messageId: string; status: 'yes' | 'no' }) {
    return this.db.transaction(async (tx) => {
      const [goal] = await tx.select().from(goals).where(and(eq(goals.id, input.id), eq(goals.guildId, input.guildId))).for('update');
      if (!goal) throw new GoalInputError('Objectif introuvable dans ce serveur.');
      if (goal.targetUserId !== input.userId) throw new GoalInputError('Seul l’utilisateur concerné peut répondre à cet objectif.');
      if (!goal.active || input.date !== localClock(goal.timezone).date || input.date < goal.startDate || input.date > goal.endDate) {
        throw new GoalInputError('Cette journée est terminée ou cet objectif est arrêté.');
      }
      const [checkin] = await tx.update(goalCheckins).set({
        status: input.status, respondedAt: new Date(), discordMessageId: input.messageId, deliveryState: 'sent',
        lastErrorCode: null,
      }).where(and(
        eq(goalCheckins.goalId, input.id), eq(goalCheckins.checkinDate, input.date), eq(goalCheckins.status, 'pending'),
        sql`${goalCheckins.deliveryState} IN ('sent', 'sending', 'uncertain')`,
        sql`(${goalCheckins.discordMessageId} IS NULL OR ${goalCheckins.discordMessageId} = ${input.messageId})`,
      )).returning();
      if (!checkin) throw new GoalInputError('Cette journée a déjà une réponse, ou ce rappel n’est plus disponible.');
      return { goal, checkin };
    });
  }

  async setDay(input: { id: number; guildId: string; actorId: string; administrator: boolean; date: string; status: 'yes' | 'no' }) {
    parseDate(input.date);
    return this.db.transaction(async (tx) => {
      const [goal] = await tx.select().from(goals).where(and(eq(goals.id, input.id), eq(goals.guildId, input.guildId))).for('update');
      if (!goal) throw new GoalInputError('Objectif introuvable dans ce serveur.');
      if (goal.creatorUserId !== input.actorId && !input.administrator) throw new GoalInputError('Seul le créateur ou un administrateur peut corriger une journée.');
      if (input.date < goal.startDate || input.date > goal.endDate || input.date > localClock(goal.timezone).date) {
        throw new GoalInputError('Choisis une journée de cet objectif, aujourd’hui ou dans le passé.');
      }
      const [checkin] = await tx.insert(goalCheckins).values({
        goalId: input.id, checkinDate: input.date, status: input.status, respondedAt: new Date(), deliveryState: 'skipped',
      }).onConflictDoUpdate({ target: [goalCheckins.goalId, goalCheckins.checkinDate],
        set: { status: input.status, respondedAt: new Date() },
      }).returning();
      if (!checkin) throw new Error('Check-in update returned no row.');
      return { goal, checkin };
    });
  }
}

export function goalService(): GoalService { return new GoalService(database().db); }
