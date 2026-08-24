/**
 * The review flow: validation, conflicts, the timeline, and the concurrency guarantee.
 */
import request from "supertest";
import { createApp } from "../app";
import { AppDataSource } from "../db/data-source";
import { ReviewEvent } from "../entities/review-event.entity";
import { auth, createFootprint, createUser, share, type TestUser } from "./helpers/factories";

const app = createApp();

let owner: TestUser;
let editor: TestUser;

beforeEach(async () => {
  owner = await createUser({ displayName: "R. Osei" });
  editor = await createUser({ displayName: "T. Adeyemi" });
});

describe("validation", () => {
  it("rejects a decision that is not approved or rejected", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "maybe" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    // The message has to be usable by the UI, not just correct.
    expect(res.body.error.details[0].message).toContain("approved");
  });

  it("rejects a missing decision", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("decision");
  });

  it("rejects a non-uuid id before it reaches the database", async () => {
    const res = await request(app).get("/api/v1/footprints/fp-001").set(auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("UUID");
  });

  it("rejects malformed JSON with a 400, not a 500", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_body");
  });

  it("bounds the emissions value and uncertainty", async () => {
    const base = { product: "P", supplier: "S", category: "C" };

    const negative = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...base, emissionsValue: -1, uncertaintyPercent: 5 });
    expect(negative.status).toBe(400);

    const over100 = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...base, emissionsValue: 1, uncertaintyPercent: 101 });
    expect(over100.status).toBe(400);
  });

  it("rejects a future submittedAt", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({
        product: "P",
        supplier: "S",
        category: "C",
        emissionsValue: 1,
        uncertaintyPercent: 1,
        submittedAt: tomorrow,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("future");
  });

  it("accepts a review with no comment — the decision is the signal", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.reviewComment).toBeNull();
  });
});

describe("invalid review actions", () => {
  it("409s when reviewing a submission that is already decided", async () => {
    const footprint = await createFootprint(owner.id);

    const first = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "approved" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "rejected" });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("conflict");
    expect(second.body.error.message).toContain("already");
  });

  it("409s when editing a submission that is no longer pending", async () => {
    const footprint = await createFootprint(owner.id, { status: "approved" });

    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner))
      .send({ supplier: "New" });

    expect(res.status).toBe(409);
  });
});

describe("review timeline", () => {
  it("appends an event carrying status, comment and createdAt", async () => {
    const footprint = await createFootprint(owner.id);

    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "rejected", comment: "Kiln energy source not disclosed." });

    const res = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/reviews`)
      .set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      status: "rejected",
      decision: "rejected",
      comment: "Kiln energy source not disclosed.",
      reviewedBy: "R. Osei",
    });
    expect(new Date(res.body.items[0].createdAt).getTime()).toBeGreaterThan(0);
  });

  it("attributes the event to the authenticated reviewer, not a client-supplied name", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, editor.id, "editor", owner.id);

    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(editor))
      .send({ decision: "approved", reviewedBy: "Somebody Else" });

    const res = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/reviews`)
      .set(auth(editor));

    expect(res.body.items[0].reviewedBy).toBe("T. Adeyemi");
  });

  it("is visible to a viewer", async () => {
    const viewer = await createUser();
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, viewer.id, "viewer", owner.id);

    await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(owner))
      .send({ decision: "approved" });

    const res = await request(app)
      .get(`/api/v1/footprints/${footprint.id}/reviews`)
      .set(auth(viewer));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe("concurrent reviews", () => {
  it("lets exactly one of many simultaneous approvals win", async () => {
    const footprint = await createFootprint(owner.id);

    // Fired together so they contend for the same row. Without the SELECT ... FOR UPDATE
    // in the repository, several of these would pass the pending check and all write.
    const attempts = Array.from({ length: 8 }, () =>
      request(app)
        .post(`/api/v1/footprints/${footprint.id}/review`)
        .set(auth(owner))
        .send({ decision: "approved" }),
    );

    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);

    // And the timeline must hold one entry, not eight.
    const events = await AppDataSource.getRepository(ReviewEvent).count({
      where: { footprintId: footprint.id },
    });
    expect(events).toBe(1);
  });
});
