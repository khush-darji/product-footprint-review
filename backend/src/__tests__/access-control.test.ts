/**
 * The tests that matter most: does the data path actually keep other people's
 * submissions out of a response?
 *
 * These drive the real HTTP stack against a real database. Mocking the repository here
 * would test the mock — the whole question is whether the SQL scopes correctly, and a
 * stubbed repository cannot answer it.
 */
import request from "supertest";
import { createApp } from "../app";
import { auth, createFootprint, createUser, share, type TestUser } from "./helpers/factories";

const app = createApp();

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let stranger: TestUser;

beforeEach(async () => {
  owner = await createUser({ displayName: "Owner" });
  editor = await createUser({ displayName: "Editor" });
  viewer = await createUser({ displayName: "Viewer" });
  stranger = await createUser({ displayName: "Stranger" });
});

describe("authentication", () => {
  it("rejects a request with no token", async () => {
    const res = await request(app).get("/api/v1/footprints");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("rejects an unknown session cookie", async () => {
    const res = await request(app)
      .get("/api/v1/footprints")
      .set("Cookie", "footprint_session=not-a-real-session");
    expect(res.status).toBe(401);
  });

  it("refuses a session token supplied as a bearer header", async () => {
    // There is exactly one way in — the httpOnly cookie. Accepting a header too would
    // undo the protection that keeps page JavaScript from using a stolen token.
    const res = await request(app)
      .get("/api/v1/footprints")
      .set("Authorization", `Bearer ${owner.sessionToken}`);
    expect(res.status).toBe(401);
  });

  it("never returns the token hash on the user endpoints", async () => {
    const res = await request(app).get("/api/v1/users").set(auth(owner));
    expect(res.status).toBe(200);
    for (const user of res.body.items) {
      expect(Object.keys(user).sort()).toEqual(["displayName", "email", "id"]);
    }
  });
});

describe("list scoping", () => {
  it("returns only submissions the caller owns or has been granted", async () => {
    await createFootprint(owner.id, { product: "Mine" });
    const sharedIn = await createFootprint(stranger.id, { product: "Shared in" });
    await createFootprint(stranger.id, { product: "Not mine" });
    await share(sharedIn.id, owner.id, "viewer", stranger.id);

    const res = await request(app).get("/api/v1/footprints").set(auth(owner));

    expect(res.status).toBe(200);
    const products = res.body.items.map((i: { product: string }) => i.product).sort();
    expect(products).toEqual(["Mine", "Shared in"]);
    expect(res.body.total).toBe(2);
    // The one nobody shared must not appear under any filter.
    expect(products).not.toContain("Not mine");
  });

  it("does not leak other users' rows through the stats endpoint", async () => {
    await createFootprint(owner.id);
    await createFootprint(stranger.id);
    await createFootprint(stranger.id);

    const res = await request(app).get("/api/v1/footprints/stats").set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.owned).toBe(1);
  });

  it("separates owned from shared via ?scope=", async () => {
    await createFootprint(owner.id);
    const sharedIn = await createFootprint(stranger.id);
    await share(sharedIn.id, owner.id, "editor", stranger.id);

    const owned = await request(app).get("/api/v1/footprints?scope=owned").set(auth(owner));
    const shared = await request(app).get("/api/v1/footprints?scope=shared").set(auth(owner));

    expect(owned.body.total).toBe(1);
    expect(shared.body.total).toBe(1);
    expect(shared.body.items[0].id).toBe(sharedIn.id);
  });
});

describe("IDOR: fetching a submission by id", () => {
  it("404s for a submission that is not shared with the caller", async () => {
    const secret = await createFootprint(owner.id);

    const res = await request(app).get(`/api/v1/footprints/${secret.id}`).set(auth(stranger));

    // 404 rather than 403: a 403 would confirm the submission exists.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("404s on the review timeline of an inaccessible submission", async () => {
    const secret = await createFootprint(owner.id);
    const res = await request(app)
      .get(`/api/v1/footprints/${secret.id}/reviews`)
      .set(auth(stranger));
    expect(res.status).toBe(404);
  });

  it("404s when reviewing an inaccessible submission, without revealing it exists", async () => {
    const secret = await createFootprint(owner.id);
    const res = await request(app)
      .post(`/api/v1/footprints/${secret.id}/review`)
      .set(auth(stranger))
      .send({ decision: "approved" });
    expect(res.status).toBe(404);
  });

  it("404s identically for a submission that does not exist at all", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const res = await request(app).get(`/api/v1/footprints/${missing}`).set(auth(stranger));
    expect(res.status).toBe(404);
  });
});

describe("role capabilities", () => {
  it("reports the caller's own role and capabilities on the same submission", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, editor.id, "editor", owner.id);
    await share(footprint.id, viewer.id, "viewer", owner.id);

    const asOwner = await request(app).get(`/api/v1/footprints/${footprint.id}`).set(auth(owner));
    const asEditor = await request(app).get(`/api/v1/footprints/${footprint.id}`).set(auth(editor));
    const asViewer = await request(app).get(`/api/v1/footprints/${footprint.id}`).set(auth(viewer));

    expect(asOwner.body.accessRole).toBe("owner");
    expect(asOwner.body.capabilities).toMatchObject({ canReview: true, canShare: true, canDelete: true });

    expect(asEditor.body.accessRole).toBe("editor");
    expect(asEditor.body.capabilities).toMatchObject({ canReview: true, canShare: false, canDelete: false });

    expect(asViewer.body.accessRole).toBe("viewer");
    expect(asViewer.body.capabilities).toMatchObject({ canReview: false, canEdit: false, canShare: false });
  });

  it("lets an editor approve", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, editor.id, "editor", owner.id);

    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(editor))
      .send({ decision: "approved", comment: "Checked." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.reviewedBy).toBe("Editor");
  });

  it("refuses to let a viewer approve, even though they can read it", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, viewer.id, "viewer", owner.id);

    const readable = await request(app)
      .get(`/api/v1/footprints/${footprint.id}`)
      .set(auth(viewer));
    expect(readable.status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/review`)
      .set(auth(viewer))
      .send({ decision: "approved" });

    // 403, not 404: the viewer already knows the submission exists.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("refuses to let a viewer edit", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, viewer.id, "viewer", owner.id);

    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(viewer))
      .send({ emissionsValue: 1 });

    expect(res.status).toBe(403);
  });

  it("refuses to let an editor delete or share", async () => {
    const footprint = await createFootprint(owner.id);
    await share(footprint.id, editor.id, "editor", owner.id);

    const deleted = await request(app)
      .delete(`/api/v1/footprints/${footprint.id}`)
      .set(auth(editor));
    expect(deleted.status).toBe(403);

    const shared = await request(app)
      .post(`/api/v1/footprints/${footprint.id}/shares`)
      .set(auth(editor))
      .send({ email: stranger.email, role: "viewer" });
    expect(shared.status).toBe(403);
  });
});

describe("mass assignment", () => {
  it("ignores an ownerId supplied in the create body", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({
        product: "P",
        supplier: "S",
        category: "C",
        emissionsValue: 1,
        uncertaintyPercent: 1,
        // A client trying to create a submission owned by somebody else.
        ownerId: stranger.id,
        status: "approved",
      });

    expect(res.status).toBe(201);
    expect(res.body.owner.id).toBe(owner.id);
    expect(res.body.status).toBe("pending");

    // And the stranger must not be able to see it.
    const asStranger = await request(app)
      .get(`/api/v1/footprints/${res.body.id}`)
      .set(auth(stranger));
    expect(asStranger.status).toBe(404);
  });

  it("ignores a status supplied in the update body", async () => {
    const footprint = await createFootprint(owner.id);

    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner))
      .send({ supplier: "Renamed", status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.supplier).toBe("Renamed");
    expect(res.body.status).toBe("pending");
  });
});
