/**
 * Bulk review: deciding several submissions in one call.
 *
 * The behaviour worth pinning down is the partial one. A bulk decision is not
 * all-or-nothing — one stale or forbidden id must not throw away the reviewer's other
 * decisions, and it must not be silently reported as a success either. Every test below
 * is about which half of the response an id lands in.
 */
import request from "supertest";
import { createApp } from "../app";
import { AppDataSource } from "../db/data-source";
import { ProductFootprint } from "../entities/product-footprint.entity";
import { ReviewEvent } from "../entities/review-event.entity";
import { auth, createFootprint, createUser, share, type TestUser } from "./helpers/factories";

const app = createApp();
const ENDPOINT = "/api/v1/footprints/bulk-review";

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  owner = await createUser({ displayName: "R. Osei" });
  editor = await createUser({ displayName: "T. Adeyemi" });
  viewer = await createUser({ displayName: "K. Mensah" });
  outsider = await createUser({ displayName: "Nobody" });
});

describe("validation", () => {
  it("rejects an empty id list — there is nothing to decide", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [], decision: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("ids");
  });

  it("rejects a non-uuid id, naming the index so the client knows which", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [footprint.id, "fp-001"], decision: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("ids[1]");
  });

  it("rejects a batch over the cap rather than doing unbounded work", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    );

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids, decision: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("at most 100");
  });

  it("rejects a decision that is not approved or rejected", async () => {
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [footprint.id], decision: "maybe" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("approved");
  });

  it("requires authentication", async () => {
    const res = await request(app).post(ENDPOINT).send({ ids: [], decision: "approved" });
    expect(res.status).toBe(401);
  });
});

describe("deciding a batch", () => {
  it("approves every selected submission and records the shared comment on each", async () => {
    const first = await createFootprint(owner.id);
    const second = await createFootprint(owner.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({
        ids: [first.id, second.id],
        decision: "approved",
        comment: "Verified against the 2025 supplier audit.",
      });

    expect(res.status).toBe(200);
    expect(res.body.failed).toEqual([]);
    expect(res.body.succeeded).toHaveLength(2);
    for (const dto of res.body.succeeded) {
      expect(dto.status).toBe("approved");
      expect(dto.reviewComment).toBe("Verified against the 2025 supplier audit.");
      // The joined owner is what tells the UI whose submission it was; see
      // createFootprint in the service for why this is re-read rather than mapped.
      expect(dto.owner.id).toBe(owner.id);
    }
  });

  it("rejects a batch, and the comment is optional there too", async () => {
    const footprint = await createFootprint(owner.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [footprint.id], decision: "rejected" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded[0].status).toBe("rejected");
    expect(res.body.succeeded[0].reviewComment).toBeNull();
  });

  it("appends one timeline entry per submission, attributed to the caller", async () => {
    const first = await createFootprint(owner.id);
    const second = await createFootprint(owner.id);

    await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [first.id, second.id], decision: "approved", comment: "Batch sign-off" });

    const events = await AppDataSource.getRepository(ReviewEvent).find();
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.decision).toBe("approved");
      expect(event.comment).toBe("Batch sign-off");
      expect(event.reviewedBy).toBe("R. Osei");
    }
  });

  it("decides a duplicated id once, not twice", async () => {
    const footprint = await createFootprint(owner.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [footprint.id, footprint.id], decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(1);
    expect(res.body.failed).toEqual([]);

    const events = await AppDataSource.getRepository(ReviewEvent).count({
      where: { footprintId: footprint.id },
    });
    expect(events).toBe(1);
  });

  it("lets an editor decide a submission shared with them", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, editor.id, "editor", owner.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(editor))
      .send({ ids: [footprint.id], decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded[0].reviewedBy).toBe("T. Adeyemi");
  });
});

describe("partial failure", () => {
  it("decides what it can and reports the rest, rather than failing the batch", async () => {
    const good = await createFootprint(owner.id);
    const alreadyDecided = await createFootprint(owner.id, { status: "approved" });

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [good.id, alreadyDecided.id], decision: "approved" });

    // 200, not 4xx: "one of two was already approved" is the answer, not an error.
    expect(res.status).toBe(200);
    expect(res.body.succeeded.map((f: { id: string }) => f.id)).toEqual([good.id]);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0]).toMatchObject({ id: alreadyDecided.id, code: "conflict" });
  });

  it("does not roll back the decisions it made", async () => {
    const good = await createFootprint(owner.id);
    const alreadyDecided = await createFootprint(owner.id, { status: "rejected" });

    await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [good.id, alreadyDecided.id], decision: "approved" });

    const persisted = await AppDataSource.getRepository(ProductFootprint).findOneOrFail({
      where: { id: good.id },
    });
    expect(persisted.status).toBe("approved");
  });

  it("reports a viewer's submission as forbidden without touching it", async () => {
    const mine = await createFootprint(owner.id);
    const theirs = await createFootprint(editor.id);
    await share(theirs.id, owner.id, "viewer", editor.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [mine.id, theirs.id], decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(1);
    expect(res.body.failed[0]).toMatchObject({ id: theirs.id, code: "forbidden" });

    const untouched = await AppDataSource.getRepository(ProductFootprint).findOneOrFail({
      where: { id: theirs.id },
    });
    expect(untouched.status).toBe("pending");
  });

  it("reports an inaccessible submission as not_found, never as forbidden", async () => {
    // A 403 would confirm the submission exists — the same reason the single-submission
    // endpoint 404s. Batching must not become the way to enumerate other people's rows.
    const hidden = await createFootprint(outsider.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(owner))
      .send({ ids: [hidden.id], decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.failed[0]).toMatchObject({ id: hidden.id, code: "not_found" });
  });

  it("gives a viewer no way to decide anything", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, viewer.id, "viewer", owner.id);

    const res = await request(app)
      .post(ENDPOINT)
      .set(auth(viewer))
      .send({ ids: [footprint.id], decision: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.failed[0].code).toBe("forbidden");

    const untouched = await AppDataSource.getRepository(ProductFootprint).findOneOrFail({
      where: { id: footprint.id },
    });
    expect(untouched.status).toBe("pending");
  });
});

describe("concurrent bulk reviews", () => {
  it("lets exactly one of two overlapping batches decide each submission", async () => {
    const first = await createFootprint(owner.id);
    const second = await createFootprint(owner.id);
    await share(first.id, editor.id, "editor", owner.id);
    await share(second.id, editor.id, "editor", owner.id);

    // The same two submissions, listed in opposite orders. The service sorts ids before
    // locking precisely so this cannot deadlock: both requests take the row locks in the
    // same order and the second waits rather than holding what the first needs.
    const [a, b] = await Promise.all([
      request(app)
        .post(ENDPOINT)
        .set(auth(owner))
        .send({ ids: [first.id, second.id], decision: "approved" }),
      request(app)
        .post(ENDPOINT)
        .set(auth(editor))
        .send({ ids: [second.id, first.id], decision: "rejected" }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    // Between them they decided each submission once, and each one has one timeline entry.
    expect(a.body.succeeded.length + b.body.succeeded.length).toBe(2);
    expect(a.body.failed.length + b.body.failed.length).toBe(2);

    for (const id of [first.id, second.id]) {
      const events = await AppDataSource.getRepository(ReviewEvent).count({
        where: { footprintId: id },
      });
      expect(events).toBe(1);
    }
  });
});
