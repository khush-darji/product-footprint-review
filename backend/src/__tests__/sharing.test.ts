/**
 * Granting, changing and revoking access.
 */
import request from "supertest";
import { createApp } from "../app";
import { auth, createFootprint, createUser, type TestUser } from "./helpers/factories";

const app = createApp();

let owner: TestUser;
let colleague: TestUser;

beforeEach(async () => {
  owner = await createUser({ displayName: "Owner" });
  colleague = await createUser({ displayName: "Colleague" });
});

describe("granting", () => {
  it("gives the recipient access they did not have before", async () => {
    const footprint = await createFootprint(owner.id);

    const before = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(colleague));
    expect(before.status).toBe(404);

    const grant = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "viewer" });

    expect(grant.status).toBe(201);
    expect(grant.body).toMatchObject({
      role: "viewer",
      user: { id: colleague.id },
      grantedBy: { id: owner.id },
    });

    const after = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(colleague));
    expect(after.status).toBe(200);
    expect(after.body.accessRole).toBe("viewer");
  });

  it("matches the recipient's email case-insensitively", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email.toUpperCase(), role: "editor" });

    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe(colleague.id);
  });

  it("changes the role instead of creating a second grant", async () => {
    const footprint = await createFootprint(owner.id);

    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "viewer" });

    const upgrade = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "editor" });

    expect(upgrade.status).toBe(201);
    expect(upgrade.body.role).toBe("editor");

    const shares = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner));
    expect(shares.body.items).toHaveLength(1);

    // The upgraded role must actually take effect, not just be reported.
    const review = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(colleague))
      .send({ decision: "approved" });
    expect(review.status).toBe(200);
  });

  it("rejects an unknown email with an explanation", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: "nobody@example.com", role: "viewer" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("nobody@example.com");
  });

  it("rejects a malformed email", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: "not-an-email", role: "viewer" });
    expect(res.status).toBe(400);
  });

  it("refuses to grant the owner role", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "owner" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("editor");
  });

  it("refuses to share with yourself", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: owner.email, role: "viewer" });

    expect(res.status).toBe(409);
  });
});

describe("revoking", () => {
  it("removes access immediately", async () => {
    const footprint = await createFootprint(owner.id);
    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "editor" });

    const revoke = await request(app)
      .delete(`/api/v1/footprints/${footprint.id}/shares/${colleague.id}`)
      .set(auth(owner));
    expect(revoke.status).toBe(204);

    const after = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(colleague));
    expect(after.status).toBe(404);

    // And the write path closes too, not just the read path.
    const review = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(colleague))
      .send({ decision: "approved" });
    expect(review.status).toBe(404);
  });

  it("404s when revoking access the user never had", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .delete(`/api/v1/footprints/${footprint.id}/shares/${colleague.id}`)
      .set(auth(owner));
    expect(res.status).toBe(404);
  });
});

describe("who may manage sharing", () => {
  it("hides the share list from a non-owner who can otherwise read the submission", async () => {
    const footprint = await createFootprint(owner.id);
    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "editor" });

    const readable = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(colleague));
    expect(readable.status).toBe(200);

    const shares = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(colleague));
    expect(shares.status).toBe(403);
  });

  it("404s share management for a stranger, revealing nothing", async () => {
    const stranger = await createUser();
    const footprint = await createFootprint(owner.id);

    const res = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(stranger));
    expect(res.status).toBe(404);
  });
});

describe("deleting a submission", () => {
  it("cascades to its shares", async () => {
    const footprint = await createFootprint(owner.id);
    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(owner))
      .send({ email: colleague.email, role: "viewer" });

    const deleted = await request(app)
      .delete(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner));
    expect(deleted.status).toBe(204);

    const after = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(colleague));
    expect(after.status).toBe(404);
  });
});
