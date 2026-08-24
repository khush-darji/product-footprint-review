/**
 * Keyset pagination and sorting — including the pure cursor helpers, which are worth
 * testing directly because they are where an off-by-one silently drops a row.
 */
import request from "supertest";
import { createApp } from "../app";
import { decodeCursor, encodeCursor, toPage } from "../lib/pagination";
import { isHighRisk, RISK_THRESHOLDS } from "../domain/footprint";
import { capabilitiesFor } from "../domain/access";
import { auth, createFootprint, createUser, type TestUser } from "./helpers/factories";

const app = createApp();
const UUID = "11111111-1111-4111-8111-111111111111";

let owner: TestUser;

beforeEach(async () => {
  owner = await createUser();
});

describe("cursor encoding", () => {
  it("round-trips", () => {
    const cursor = { sortKey: "submittedAt", sortValue: "2026-01-01T00:00:00.000Z", id: UUID };
    expect(decodeCursor(encodeCursor(cursor), "submittedAt")).toEqual(cursor);
  });

  it("rejects a cursor issued for a different sort", () => {
    const cursor = encodeCursor({ sortKey: "emissionsValue", sortValue: "10", id: UUID });
    expect(() => decodeCursor(cursor, "submittedAt")).toThrow(/issued for sort/);
  });

  it("rejects garbage rather than passing it to the database", () => {
    expect(() => decodeCursor("not-a-cursor", "submittedAt")).toThrow(/Malformed/);
    const badId = encodeCursor({ sortKey: "submittedAt", sortValue: "x", id: "nope" });
    expect(() => decodeCursor(badId, "submittedAt")).toThrow(/Malformed/);
  });
});

describe("toPage", () => {
  it("trims the over-fetched row and reports more", () => {
    const rows = [1, 2, 3, 4];
    const page = toPage(rows, 3, (n) => ({ sortKey: "n", sortValue: String(n), id: UUID }));
    expect(page.items).toEqual([1, 2, 3]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  it("reports no more when the page is not full", () => {
    const page = toPage([1, 2], 3, (n) => ({ sortKey: "n", sortValue: String(n), id: UUID }));
    expect(page.items).toEqual([1, 2]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe("paging the queue", () => {
  it("walks every row exactly once, with no duplicates or gaps", async () => {
    for (let i = 0; i < 10; i += 1) {
      await createFootprint(owner.id, {
        emissionsValue: i,
        submittedAt: new Date(Date.now() - i * 60_000),
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url: string =
        `/api/v1/footprints?limit=3` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const res = await request(app).get(url).set(auth(owner));
      expect(res.status).toBe(200);

      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.pageInfo.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(4);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("bounds the page size", async () => {
    const res = await request(app).get("/api/v1/footprints?limit=500").set(auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("limit");
  });
});

describe("sorting", () => {
  beforeEach(async () => {
    await createFootprint(owner.id, { product: "Low", emissionsValue: 1 });
    await createFootprint(owner.id, { product: "High", emissionsValue: 5000 });
    await createFootprint(owner.id, { product: "Mid", emissionsValue: 100 });
  });

  it("orders by emissions descending", async () => {
    const res = await request(app)
      .get("/api/v1/footprints?sort=emissionsValue&order=desc")
      .set(auth(owner));
    expect(res.body.items.map((i: { product: string }) => i.product)).toEqual([
      "High",
      "Mid",
      "Low",
    ]);
  });

  it("orders by emissions ascending", async () => {
    const res = await request(app)
      .get("/api/v1/footprints?sort=emissionsValue&order=asc")
      .set(auth(owner));
    expect(res.body.items.map((i: { product: string }) => i.product)).toEqual([
      "Low",
      "Mid",
      "High",
    ]);
  });

  it("refuses a sort column that is not on the allowlist", async () => {
    // An ORDER BY identifier cannot be parameterised, so this has to be rejected at the
    // boundary rather than escaped.
    const res = await request(app)
      .get("/api/v1/footprints?sort=owner_id;DROP TABLE users--")
      .set(auth(owner));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("risk flags", () => {
  it("flags submissions at or above either threshold", () => {
    expect(isHighRisk({ emissionsValue: RISK_THRESHOLDS.highEmissionsValue, uncertaintyPercent: 1 })).toBe(true);
    expect(isHighRisk({ emissionsValue: 1, uncertaintyPercent: RISK_THRESHOLDS.highUncertaintyPercent })).toBe(true);
    expect(isHighRisk({ emissionsValue: 1, uncertaintyPercent: 1 })).toBe(false);
  });

  it("computes isHighRisk server-side so the client cannot disagree", async () => {
    await createFootprint(owner.id, { product: "Hot", emissionsValue: 900, uncertaintyPercent: 2 });
    await createFootprint(owner.id, { product: "Cold", emissionsValue: 1, uncertaintyPercent: 2 });

    const res = await request(app).get("/api/v1/footprints").set(auth(owner));
    const byProduct = Object.fromEntries(
      res.body.items.map((i: { product: string; isHighRisk: boolean }) => [i.product, i.isHighRisk]),
    );
    expect(byProduct).toEqual({ Hot: true, Cold: false });
  });

  it("filters to hotspots only", async () => {
    await createFootprint(owner.id, { emissionsValue: 900 });
    await createFootprint(owner.id, { emissionsValue: 1 });

    const res = await request(app)
      .get("/api/v1/footprints?highRiskOnly=true")
      .set(auth(owner));
    expect(res.body.total).toBe(1);
  });
});

describe("capability table", () => {
  it("matches the documented access model", () => {
    expect(capabilitiesFor("owner")).toEqual({
      canView: true, canReview: true, canEdit: true, canShare: true, canDelete: true,
    });
    expect(capabilitiesFor("editor")).toEqual({
      canView: true, canReview: true, canEdit: true, canShare: false, canDelete: false,
    });
    expect(capabilitiesFor("viewer")).toEqual({
      canView: true, canReview: false, canEdit: false, canShare: false, canDelete: false,
    });
  });
});
