import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const checkinStatus = pgEnum('checkin_status', ['pending', 'yes', 'no', 'missed']);
export const deliveryState = pgEnum('delivery_state', ['queued', 'sending', 'sent', 'uncertain', 'skipped']);

export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  guildId: varchar('guild_id', { length: 20 }).notNull(),
  channelId: varchar('channel_id', { length: 20 }).notNull(),
  creatorUserId: varchar('creator_user_id', { length: 20 }).notNull(),
  targetUserId: varchar('target_user_id', { length: 20 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  reminderTime: varchar('reminder_time', { length: 5 }).notNull(),
  timezone: varchar('timezone', { length: 100 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('goals_active_id_idx').on(table.active, table.id),
  index('goals_guild_users_idx').on(table.guildId, table.creatorUserId, table.targetUserId),
  check('goals_dates_check', sql`${table.endDate} >= ${table.startDate} AND ${table.endDate} - ${table.startDate} <= 3699`),
  check('goals_time_check', sql`${table.reminderTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  check('goals_title_check', sql`length(trim(${table.title})) > 0`),
]);

export const goalCheckins = pgTable('goal_checkins', {
  id: serial('id').primaryKey(),
  goalId: integer('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  checkinDate: date('checkin_date', { mode: 'string' }).notNull(),
  status: checkinStatus('status').notNull().default('pending'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  discordMessageId: varchar('discord_message_id', { length: 20 }),
  deliveryState: deliveryState('delivery_state').notNull().default('queued'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
  retryAt: timestamp('retry_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 30 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('goal_checkins_goal_date_unique').on(table.goalId, table.checkinDate),
  index('goal_checkins_recovery_idx').on(table.deliveryState, table.goalId),
  check('goal_checkins_response_check', sql`(${table.status} IN ('yes', 'no')) = (${table.respondedAt} IS NOT NULL)`),
]);

export type Goal = typeof goals.$inferSelect;
export type GoalCheckin = typeof goalCheckins.$inferSelect;
