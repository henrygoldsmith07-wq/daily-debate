import "server-only";

/**
 * Auth.js (NextAuth v5) configuration — the app's single source of identity.
 *
 * Two ways in, one `app_users` row behind either:
 *
 * - **Google** (`google`): OAuth 2.0 / OIDC, registered only when both client
 *   credentials are present. A deployment without them still builds and still
 *   offers password sign-in rather than failing on a half-configured provider.
 * - **Password** (`credentials`): the existing scrypt verification, so every
 *   account created before Google sign-in keeps working untouched.
 *
 * A Credentials provider forces the **JWT** session strategy (a database
 * strategy silently ignores credential logins), which replaced the opaque
 * `app_sessions` tokens this app used to mint. The trade is worth stating: a
 * JWT cannot be revoked before it expires, so the lifetime stays pinned to the
 * old cookie's 30 days and `getUser()` still resolves the id against a live
 * row on every request.
 *
 * The token carries this app's OWN user id (`token.uid`), never Google's
 * subject — every debate, match and skill-ledger row is keyed by that id.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { SESSION_TTL_SECONDS } from "./session";
import { verifyPasswordForEmail, upsertGoogleUser } from "./auth";

/** HTTPS-only cookies everywhere except local development. */
const useSecureCookies = process.env.NODE_ENV === "production";

export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "credentials",
    name: "Email and password",
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const email = typeof raw?.email === "string" ? raw.email : "";
      const password = typeof raw?.password === "string" ? raw.password : "";
      if (!email || !password) return null;
      const user = await verifyPasswordForEmail(email, password);
      // null is Auth.js's "rejected" — throwing would turn a mistyped
      // password into a server error page.
      return user ? { id: user.id, email: user.email } : null;
    },
  }),
];

if (googleEnabled) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Identity only: this app never calls a Google API for the user, so it
      // asks for no refresh token and no extra scope.
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: "jwt", maxAge: SESSION_TTL_SECONDS },
  pages: { signIn: "/login" },
  trustHost: true,
  /**
   * Auth.js's own defaults, written out so the session cookie's security
   * properties are visible in this repository rather than being an implicit
   * property of a dependency.
   */
  cookies: {
    sessionToken: {
      // The __Secure- prefix is only legal on an HTTPS cookie, so it is
      // applied exactly when the Secure attribute is.
      name: useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  callbacks: {
    /**
     * An unverified Google address must never be accepted: accounts link by
     * email, so honouring one would let anyone able to create a Google account
     * with someone else's address walk into that person's debate history.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      return Boolean(profile?.email) && profile?.email_verified === true;
    },

    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google" && profile?.email) {
        const row = await upsertGoogleUser({
          sub: profile.sub ?? account.providerAccountId,
          email: profile.email,
          name: typeof profile.name === "string" ? profile.name : null,
          image: typeof profile.picture === "string" ? profile.picture : null,
        });
        token.uid = row.id;
        token.email = row.email;
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
