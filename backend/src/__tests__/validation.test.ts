/**
 * The validation layer's contract, independent of which library implements it.
 *
 * These are the cases a rewrite of `lib/validation.ts` breaks silently: the difference
 * between "omitted" and "explicitly null", empty strings in a query, whitespace-only
 * text, and the slack allowed on a client's clock. None of them are visible in the happy
 * path, and all of them change what reaches the database.
 */
import request from "supertest";
import { createApp } from "../app";
import { AppDataSource } from "../db/data-source";
import { ProductFootprint } from "../entities/product-footprint.entity";
import { auth, createFootprint, createUser, type TestUser } from "./helpers/factories";

const app = createApp();
const CREATE_BODY = {
  product: "P",
  supplier: "S",
  category: "C",
  emissionsValue: 1,
  uncertaintyPercent: 1,
};

let owner: TestUser;

beforeEach(async () => {
  owner = await createUser();
});

describe("omitted vs. explicitly null", () => {
  it("leaves a field alone when the key is absent", async () => {
    const footprint = await createFootprint(owner.id);
    await AppDataSource.getRepository(ProductFootprint).update(
      { id: footprint.id },
      { supplierNotes: "Original note" },
    );

    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner))
      .send({ supplier: "Renamed" });

    expect(res.status).toBe(200);
    expect(res.body.supplierNotes).toBe("Original note");
  });

  it("clears a field when the key is explicitly null", async () => {
    const footprint = await createFootprint(owner.id);
    await AppDataSource.getRepository(ProductFootprint).update(
      { id: footprint.id },
      { supplierNotes: "Original note" },
    );

    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner))
      .send({ supplierNotes: null });

    expect(res.status).toBe(200);
    expect(res.body.supplierNotes).toBeNull();
  });

  it("treats an empty string as 'not provided' rather than 'set to empty'", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...CREATE_BODY, supplierNotes: "   " });

    expect(res.status).toBe(201);
    expect(res.body.supplierNotes).toBeNull();
  });

  it("rejects an update whose every key was stripped as unknown", async () => {
    // `status` is not a field the update schema names, so the body is empty by the time
    // it is checked -- a silent no-op would look to the client like a successful edit.
    const footprint = await createFootprint(owner.id);
    const res = await request(app)
      .patch(`/api/v1/footprints/${footprint.id}`)
      .set(auth(owner))
      .send({ status: "approved" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("at least one field");
  });
});

describe("query strings", () => {
  it("treats an empty filter as absent rather than as a search for nothing", async () => {
    await createFootprint(owner.id, { product: "Findable" });

    const res = await request(app).get("/api/v1/footprints?q=&category=").set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it("coerces the text a query string carries into numbers and booleans", async () => {
    const res = await request(app)
      .get("/api/v1/footprints?limit=5&highRiskOnly=true")
      .set(auth(owner));

    expect(res.status).toBe(200);
    expect(res.body.pageInfo.limit).toBe(5);
  });

  it("rejects a limit that is not a number", async () => {
    const res = await request(app).get("/api/v1/footprints?limit=abc").set(auth(owner));

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("limit");
  });

  it("rejects a boolean that is neither true nor false", async () => {
    const res = await request(app)
      .get("/api/v1/footprints?highRiskOnly=maybe")
      .set(auth(owner));

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("highRiskOnly");
  });
});

describe("collecting every problem at once", () => {
  it("reports all the bad fields in one response, not the first", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ product: "", supplier: "", category: "", emissionsValue: -1, uncertaintyPercent: 500 });

    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "product",
        "supplier",
        "category",
        "emissionsValue",
        "uncertaintyPercent",
      ]),
    );
  });
});

describe("clock skew on submittedAt", () => {
  it("accepts a timestamp slightly ahead of the server's clock", async () => {
    // A client whose clock is thirty seconds fast is not backdating anything, and
    // rejecting it would make submissions fail for reasons nobody can act on.
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...CREATE_BODY, submittedAt: new Date(Date.now() + 30_000).toISOString() });

    expect(res.status).toBe(201);
  });

  it("still rejects a timestamp well beyond that slack", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...CREATE_BODY, submittedAt: new Date(Date.now() + 86_400_000).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain("future");
  });

  it("rejects a submittedAt that is not a date at all", async () => {
    const res = await request(app)
      .post("/api/v1/footprints")
      .set(auth(owner))
      .send({ ...CREATE_BODY, submittedAt: "nonsense" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("submittedAt");
  });
});
