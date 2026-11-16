import { and, eq, sql } from "drizzle-orm";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { getDb, schema } from "@/db";

const { users, accounts, verificationTokens } = schema;

type UserRow = typeof users.$inferSelect;

const toAdapterUser = (u: UserRow): AdapterUser => ({
  id: u.id,
  email: u.email,
  emailVerified: u.emailVerified,
  name: u.displayName,
  image: u.image,
});

const byEmail = (email: string) => sql`lower(${users.email}) = ${email.toLowerCase()}`;

/**
 * Auth.js adapter for our schema. Hand-written (rather than @auth/drizzle-adapter) because our
 * `users` table calls the name column `displayName`, and a user's `handle` is chosen *after*
 * sign-up (onboarding). Sessions are JWTs, so no session methods are needed.
 */
export function createAdapter(): Adapter {
  const db = getDb();
  return {
    async createUser(data) {
      const [row] = await db
        .insert(users)
        .values({
          email: data.email.toLowerCase(),
          emailVerified: data.emailVerified,
          displayName: data.name,
          image: data.image,
        })
        .returning();
      return toAdapterUser(row);
    },

    async getUser(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email) {
      const [row] = await db.select().from(users).where(byEmail(email)).limit(1);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const [row] = await db
        .select({ user: users })
        .from(accounts)
        .innerJoin(users, eq(accounts.userId, users.id))
        .where(
          and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)),
        )
        .limit(1);
      return row ? toAdapterUser(row.user) : null;
    },

    async updateUser(data) {
      const set: Partial<typeof users.$inferInsert> = {};
      if (data.email !== undefined) set.email = data.email.toLowerCase();
      if (data.emailVerified !== undefined) set.emailVerified = data.emailVerified;
      if (data.image !== undefined) set.image = data.image;
      // `name` from the provider only seeds displayName at creation; later edits are the user's.
      const [row] = Object.keys(set).length
        ? await db.update(users).set(set).where(eq(users.id, data.id)).returning()
        : await db.select().from(users).where(eq(users.id, data.id)).limit(1);
      return toAdapterUser(row);
    },

    async linkAccount(account) {
      await db.insert(accounts).values({
        userId: account.userId,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        refresh_token: account.refresh_token,
        access_token: account.access_token,
        expires_at: account.expires_at,
        token_type: account.token_type,
        scope: account.scope,
        id_token: account.id_token,
        session_state: account.session_state as string | undefined,
      });
    },

    async createVerificationToken(token) {
      const [row] = await db
        .insert(verificationTokens)
        .values({ ...token, identifier: token.identifier.toLowerCase() })
        .returning();
      return row;
    },

    async useVerificationToken({ identifier, token }) {
      const [row] = await db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, identifier.toLowerCase()),
            eq(verificationTokens.token, token),
          ),
        )
        .returning();
      return row ?? null;
    },
  };
}
