import { eq, like, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { getDb, schema } from "@/db";
import { siteConfig } from "@/config/site";
import { isWithinGrace, restoreAccount } from "@/lib/account/account";
import { createAdapter } from "@/lib/auth/adapter";

const { users } = schema;

/** Seed users (db:seed) sign in through the dev-only provider below. Never enabled in production. */
export const DEV_LOGIN_ENABLED = process.env.NODE_ENV === "development";
export const SEED_EMAIL_LIKE = "%@seed.invalid";

export const providerAvailability = {
  google: !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  email: !!process.env.RESEND_API_KEY,
  dev: DEV_LOGIN_ENABLED,
};

const isOwnerEmail = (email?: string | null) =>
  !!email &&
  !!process.env.OWNER_EMAIL &&
  email.toLowerCase() === process.env.OWNER_EMAIL.trim().toLowerCase();

// Config is built lazily so importing this file (e.g. during `next build`) never touches the DB.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: createAdapter(),
  // JWT sessions: required by the dev credentials provider, and cheap. Account state (suspended,
  // deleted, role) is re-read from the database on every request in lib/auth/session.ts.
  session: { strategy: "jwt" as const },
  trustHost: true,
  pages: { signIn: "/sign-in", verifyRequest: "/sign-in/check-email", error: "/sign-in" },
  providers: [
    ...(providerAvailability.google
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            // Google verifies email ownership, so linking to an existing email-link account is safe.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(providerAvailability.email
      ? [Resend({ apiKey: process.env.RESEND_API_KEY, from: siteConfig.emailFrom })]
      : []),
    ...(DEV_LOGIN_ENABLED
      ? [
          Credentials({
            id: "dev",
            name: "Dev sign-in",
            credentials: { identifier: {} },
            async authorize(credentials) {
              const identifier = String(credentials?.identifier ?? "").toLowerCase();
              const [user] = await getDb()
                .select()
                .from(users)
                .where(
                  sql`(${users.handle} = ${identifier} OR ${users.email} = ${identifier}) AND ${like(users.email, SEED_EMAIL_LIKE)}`,
                )
                .limit(1);
              return user
                ? { id: user.id, email: user.email, name: user.displayName, image: user.image }
                : null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.id) return true; // new user: created after this callback
      const [row] = await getDb().select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!row) return true;
      if (row.status !== "active") return false;
      // A deleted account can come back by signing in during the grace period (see events below).
      return !row.deletedAt || isWithinGrace(row.deletedAt);
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    async signIn({ user, isNewUser }) {
      if (!user.id) return;
      const db = getDb();
      await restoreAccount(user.id);
      // Owner role comes from OWNER_EMAIL; granted at first sign-in (and re-checked each time).
      if (isOwnerEmail(user.email)) {
        await db.update(users).set({ role: "owner" }).where(eq(users.id, user.id));
      }
      // Seed the display name from the provider profile when there isn't one yet.
      if (isNewUser && user.name) {
        await db.update(users).set({ displayName: user.name }).where(eq(users.id, user.id));
      }
    },
  },
}));
