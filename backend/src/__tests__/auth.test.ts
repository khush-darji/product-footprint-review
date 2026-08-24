/**
 * Sign in, sign out, and the properties that make a login endpoint safe.
 */
import request from "supertest";
import { createApp } from "../app";
import { AppDataSource } from "../db/data-source";
import { Session } from "../entities/session.entity";
import { SESSION_COOKIE } from "../middleware/auth";
import { hashSessionToken, verifyPassword } from "../services/auth.service";
import { auth, createFootprint, createUser, type TestUser } from "./helpers/factories";

const app = createApp();

let user: TestUser;

beforeEach(async () => {
  user = await createUser({ email: "reviewer@example.com", displayName: "A Reviewer" });
});

/** Pulls the session cookie out of a `set-cookie` header. */
function sessionCookieFrom(res: request.Response): string | null {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ?? null;
}

describe("signing in", () => {
  it("accepts the right password and sets an httpOnly session cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: user.email, displayName: "A Reviewer" });

    const cookie = sessionCookieFrom(res);
    expect(cookie).not.toBeNull();
    // httpOnly is what stops an XSS bug reading the session; SameSite is the CSRF guard.
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("lets that cookie reach a protected endpoint", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password });

    const res = await request(app)
      .get("/api/v1/footprints")
      .set("Cookie", sessionCookieFrom(login) as string);

    expect(res.status).toBe(200);
  });

  it("matches the email case-insensitively", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email.toUpperCase(), password: user.password });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(sessionCookieFrom(res)).toBeNull();
  });

  it("gives an unknown email and a wrong password the identical response", async () => {
    // Different messages here would be an account-enumeration oracle: an attacker could
    // learn which addresses have accounts without ever guessing a password.
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "whatever" });

    const wrongPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "whatever" });

    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
    expect(unknown.body.error.code).toBe(wrongPassword.body.error.code);
  });

  it("validates the request shape before touching the database", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain("email");
    expect(paths).toContain("password");
  });

  it("never returns the password hash", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password });

    expect(JSON.stringify(res.body)).not.toContain("$argon2");
    expect(Object.keys(res.body.user).sort()).toEqual(["displayName", "email", "id"]);
  });
});

describe("password storage", () => {
  it("stores an argon2id hash, never the password", async () => {
    const row = await AppDataSource.getRepository("users")
      .createQueryBuilder("u")
      .select("u.password_hash", "hash")
      .where("u.id = :id", { id: user.id })
      .getRawOne<{ hash: string }>();

    expect(row?.hash).toMatch(/^\$argon2id\$/);
    expect(row?.hash).not.toContain(user.password);
    await expect(verifyPassword(row?.hash ?? "", user.password)).resolves.toBe(true);
  });

  it("treats an unparseable stored hash as a failed login rather than throwing", async () => {
    // This is what a migration-backfilled placeholder looks like; such an account has to
    // be locked out, not crash the endpoint.
    await expect(verifyPassword("!", "anything")).resolves.toBe(false);
  });
});

describe("who am I", () => {
  it("returns the signed-in user", async () => {
    const res = await request(app).get("/api/v1/auth/me").set(auth(user));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, email: user.email });
  });

  it("401s without a session", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("signing out", () => {
  it("revokes the session immediately", async () => {
    const before = await request(app).get("/api/v1/auth/me").set(auth(user));
    expect(before.status).toBe(200);

    const out = await request(app).post("/api/v1/auth/logout").set(auth(user));
    expect(out.status).toBe(204);

    // Server-side sessions are used precisely so this is true; a JWT would still verify.
    const after = await request(app).get("/api/v1/auth/me").set(auth(user));
    expect(after.status).toBe(401);
  });

  it("deletes the session row rather than just clearing the cookie", async () => {
    await request(app).post("/api/v1/auth/logout").set(auth(user));

    const remaining = await AppDataSource.getRepository(Session).count({
      where: { tokenHash: hashSessionToken(user.sessionToken) },
    });
    expect(remaining).toBe(0);
  });

  it("closes the data path, not just the identity endpoint", async () => {
    const footprint = await createFootprint(user.id);
    await request(app).post("/api/v1/auth/logout").set(auth(user));

    const res = await request(app).get(`/api/v1/footprints/${footprint.id}`).set(auth(user));
    expect(res.status).toBe(401);
  });

  it("succeeds even with no session, so a stale cookie can always be cleared", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
  });
});

describe("expired sessions", () => {
  it("rejects a session past its expiry and removes it", async () => {
    await AppDataSource.getRepository(Session).update(
      { tokenHash: hashSessionToken(user.sessionToken) },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const res = await request(app).get("/api/v1/auth/me").set(auth(user));
    expect(res.status).toBe(401);

    const remaining = await AppDataSource.getRepository(Session).count({
      where: { tokenHash: hashSessionToken(user.sessionToken) },
    });
    expect(remaining).toBe(0);
  });
});

describe("session isolation", () => {
  it("does not let one user's session read another user's submissions", async () => {
    const other = await createUser();
    const secret = await createFootprint(other.id);

    const res = await request(app).get(`/api/v1/footprints/${secret.id}`).set(auth(user));
    expect(res.status).toBe(404);
  });

  it("signing one user out leaves another's session working", async () => {
    const other = await createUser();
    await request(app).post("/api/v1/auth/logout").set(auth(user));

    const res = await request(app).get("/api/v1/auth/me").set(auth(other));
    expect(res.status).toBe(200);
  });
});
