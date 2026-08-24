/**
 * Development fixtures: supplier-reported product footprints spanning the kinds of
 * value-chain emissions this tool reviews — batteries, raw materials, electronic
 * components, grid infrastructure, vehicle parts, packaging and logistics.
 *
 * ALL FIGURES AND SUPPLIER NAMES BELOW ARE INVENTED for local development and demos.
 * Nothing here is a real emissions disclosure, a real supplier, or a real number.
 *
 * The mix is chosen to exercise the review queue rather than to be representative:
 * roughly two thirds pending, a spread of categories and suppliers, and several rows
 * over the risk thresholds (>= 500 kg CO2e or >= 25% uncertainty) so the hotspot flag
 * and the `highRiskOnly` filter have something to select.
 *
 * Ownership is spread across the seeded users, and a few submissions are shared as
 * viewer or editor so the access model is visible the moment the app is opened — see
 * SHARES below.
 *
 * Idempotent: does nothing if the table already has rows. Pass `force` to wipe first.
 */
import type { DataSource } from "typeorm";
import type { ShareableRole } from "../../domain/access";
import type { ReviewDecision, ReviewStatus } from "../../domain/footprint";
import { FootprintShare } from "../../entities/footprint-share.entity";
import { ProductFootprint } from "../../entities/product-footprint.entity";
import { ReviewEvent } from "../../entities/review-event.entity";
import { seedUsers } from "./users.seed";

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

interface SeedRow {
  /** Which seeded user owns this submission. */
  ownerEmail: string;
  product: string;
  supplier: string;
  category: string;
  emissionsValue: number;
  uncertaintyPercent: number;
  status: ReviewStatus;
  submittedDaysAgo: number;
  supplierNotes?: string;
  review?: { decision: ReviewDecision; by: string; comment: string; daysAgo: number };
}

const SEED_ROWS: SeedRow[] = [
  // ---- Electronics & components ----------------------------------------------------
  {
    ownerEmail: "r.osei@example.com",
    product: "OLED Display Panel (55-inch)",
    supplier: "Arcline Display Systems",
    category: "Electronic Components",
    emissionsValue: 218.4,
    uncertaintyPercent: 14,
    status: "pending",
    submittedDaysAgo: 1,
    supplierNotes: "Cradle-to-gate. Panel fab moved to a higher-renewables grid in Q2.",
  },
  {
    ownerEmail: "r.osei@example.com",
    product: "Lithium-Ion Cell (18650, 3.6V)",
    supplier: "Kyushu Cell Technologies",
    category: "Battery Systems",
    emissionsValue: 612,
    uncertaintyPercent: 22,
    status: "pending",
    submittedDaysAgo: 3,
    supplierNotes: "Cathode sourcing changed to a new mine site this year.",
  },
  {
    ownerEmail: "r.osei@example.com",
    product: "CMOS Image Sensor Module",
    supplier: "Arcline Display Systems",
    category: "Electronic Components",
    emissionsValue: 47.9,
    uncertaintyPercent: 11,
    status: "pending",
    submittedDaysAgo: 2,
    supplierNotes: "Wafer-level figure; excludes final assembly.",
  },
  {
    ownerEmail: "r.osei@example.com",
    product: "Injection-Moulded ABS Housing",
    supplier: "Loop Polymer Group",
    category: "Plastics & Polymers",
    emissionsValue: 3.8,
    uncertaintyPercent: 9,
    status: "approved",
    submittedDaysAgo: 9,
    review: {
      decision: "approved",
      by: "R. Osei",
      comment: "Consistent with the recycled-content share they reported last quarter.",
      daysAgo: 7,
    },
  },
  {
    ownerEmail: "r.osei@example.com",
    product: "Corrugated Retail Packaging (Large)",
    supplier: "Loop Polymer Group",
    category: "Packaging",
    emissionsValue: 0.62,
    uncertaintyPercent: 12,
    status: "pending",
    submittedDaysAgo: 0,
  },
  {
    ownerEmail: "r.osei@example.com",
    product: "Printed Circuit Board Assembly (Main Logic)",
    supplier: "Halden Precision Works",
    category: "Electronic Components",
    emissionsValue: 89.5,
    uncertaintyPercent: 27,
    status: "rejected",
    submittedDaysAgo: 20,
    review: {
      decision: "rejected",
      by: "T. Adeyemi",
      comment:
        "Solder and plating stages not disclosed - uncertainty too wide to use. Resubmit with process-level data.",
      daysAgo: 18,
    },
  },

  // ---- Automotive & raw materials ---------------------------------------------------
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "EV Traction Battery Pack (65 kWh)",
    supplier: "Vantage Cell Co.",
    category: "Battery Systems",
    emissionsValue: 4820,
    uncertaintyPercent: 26,
    status: "pending",
    submittedDaysAgo: 1,
    supplierNotes:
      "Largest single line item in the vehicle footprint. Pack-level, includes module assembly.",
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Cold-Rolled Automotive Steel (per tonne)",
    supplier: "Kastellan Materials",
    category: "Raw Materials",
    emissionsValue: 1850,
    uncertaintyPercent: 30,
    status: "pending",
    submittedDaysAgo: 1,
    supplierNotes: "Estimate; blast-furnace route. Smelter-level data not yet available.",
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Aluminium Body Panel (per tonne)",
    supplier: "Norrhall Metals",
    category: "Raw Materials",
    emissionsValue: 540,
    uncertaintyPercent: 28,
    status: "pending",
    submittedDaysAgo: 2,
    supplierNotes: "First submission for this product line. Primary aluminium share ~60%.",
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Synthetic Rubber Tyre (Passenger)",
    supplier: "Meridian Elastomers",
    category: "Vehicle Components",
    emissionsValue: 27.4,
    uncertaintyPercent: 18,
    status: "pending",
    submittedDaysAgo: 4,
    supplierNotes: "Includes upstream feedstock emissions.",
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Polyurethane Seat Foam (per seat set)",
    supplier: "Meridian Elastomers",
    category: "Vehicle Components",
    emissionsValue: 12.9,
    uncertaintyPercent: 13,
    status: "pending",
    submittedDaysAgo: 5,
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Cast Iron Engine Block",
    supplier: "Thornfield Castings",
    category: "Vehicle Components",
    emissionsValue: 96.2,
    uncertaintyPercent: 10,
    status: "approved",
    submittedDaysAgo: 12,
    review: {
      decision: "approved",
      by: "R. Osei",
      comment: "Matches last year's figure within tolerance. Foundry data verified.",
      daysAgo: 10,
    },
  },
  {
    ownerEmail: "t.adeyemi@example.com",
    product: "Inbound Logistics (Tier-1 road freight, per tonne-km)",
    supplier: "Pelham Freight Group",
    category: "Logistics",
    emissionsValue: 0.11,
    uncertaintyPercent: 7,
    status: "approved",
    submittedDaysAgo: 14,
    review: {
      decision: "approved",
      by: "T. Adeyemi",
      comment: "Fleet mix and load factors check out against telematics.",
      daysAgo: 12,
    },
  },

  // ---- Grid infrastructure -----------------------------------------------------------
  {
    ownerEmail: "m.lindqvist@example.com",
    product: "SF6-Free Gas-Insulated Switchgear (145 kV)",
    supplier: "Orrick Switchgear",
    category: "Grid Infrastructure",
    emissionsValue: 3240,
    uncertaintyPercent: 33,
    status: "pending",
    submittedDaysAgo: 0,
    supplierNotes:
      "New alternative-gas design. Manufacturing figure only - excludes the avoided SF6 leakage benefit over the asset life.",
  },
  {
    ownerEmail: "m.lindqvist@example.com",
    product: "XLPE Underground Cable (400 kV, per km)",
    supplier: "Pelham Cable Systems",
    category: "Grid Infrastructure",
    emissionsValue: 1120,
    uncertaintyPercent: 19,
    status: "pending",
    submittedDaysAgo: 2,
    supplierNotes: "Copper conductor dominates; insulation stage is ~8% of the total.",
  },
  {
    ownerEmail: "m.lindqvist@example.com",
    product: "Transmission Tower Lattice Steel (per tonne)",
    supplier: "Kastellan Materials",
    category: "Raw Materials",
    emissionsValue: 2180,
    uncertaintyPercent: 24,
    status: "pending",
    submittedDaysAgo: 3,
    supplierNotes: "Galvanising stage included. Same mill as the automotive coil line.",
  },
  {
    ownerEmail: "m.lindqvist@example.com",
    product: "Distribution Transformer (11kV/415V, 500 kVA)",
    supplier: "Orrick Switchgear",
    category: "Grid Infrastructure",
    emissionsValue: 428,
    uncertaintyPercent: 16,
    status: "pending",
    submittedDaysAgo: 6,
  },
  {
    ownerEmail: "m.lindqvist@example.com",
    product: "ACSR Overhead Conductor (per km)",
    supplier: "Pelham Cable Systems",
    category: "Grid Infrastructure",
    emissionsValue: 74.6,
    uncertaintyPercent: 9,
    status: "approved",
    submittedDaysAgo: 11,
    review: {
      decision: "approved",
      by: "T. Adeyemi",
      comment: "Within expected range for aluminium-steel conductor.",
      daysAgo: 10,
    },
  },
];

/**
 * Demo grants, so the access model is visible immediately.
 *
 * Matched by product name because seeded ids are generated. J. Park deliberately owns
 * nothing and is granted only viewer roles — open the app as J. Park and the approve
 * and reject buttons are gone, and the server rejects the call even if they are forced
 * back on in the browser.
 */
const SHARES: { product: string; email: string; role: ShareableRole }[] = [
  // Osei shares two electronics submissions out: one editable, one read-only.
  { product: "Lithium-Ion Cell (18650, 3.6V)", email: "t.adeyemi@example.com", role: "editor" },
  { product: "Lithium-Ion Cell (18650, 3.6V)", email: "j.park@example.com", role: "viewer" },
  { product: "OLED Display Panel (55-inch)", email: "j.park@example.com", role: "viewer" },
  // Adeyemi gives Osei edit rights on the biggest hotspot in the automotive set.
  { product: "EV Traction Battery Pack (65 kWh)", email: "r.osei@example.com", role: "editor" },
  { product: "Cold-Rolled Automotive Steel (per tonne)", email: "m.lindqvist@example.com", role: "viewer" },
  // Lindqvist shares a grid submission with Adeyemi as an editor.
  { product: "SF6-Free Gas-Insulated Switchgear (145 kV)", email: "t.adeyemi@example.com", role: "editor" },
  { product: "XLPE Underground Cable (400 kV, per km)", email: "j.park@example.com", role: "viewer" },
];

export interface SeedResult {
  inserted: number;
  shares: number;
  skipped: boolean;
}

export async function seedFootprints(
  dataSource: DataSource,
  options: { force?: boolean } = {},
): Promise<SeedResult> {
  const footprints = dataSource.getRepository(ProductFootprint);

  // Users first: footprints cannot exist without an owner, and the seed users are
  // upserted so re-running refreshes their tokens rather than colliding.
  const users = await seedUsers(dataSource);
  const userIdByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user.id]));

  function ownerIdFor(email: string): string {
    const id = userIdByEmail.get(email.toLowerCase());
    if (!id) throw new Error(`Seed refers to unknown user "${email}"`);
    return id;
  }

  if (options.force) {
    // TRUNCATE ... CASCADE also clears review_events and footprint_shares via their
    // foreign keys.
    await dataSource.query(`TRUNCATE TABLE "product_footprints" CASCADE`);
  } else if ((await footprints.count()) > 0) {
    return { inserted: 0, shares: 0, skipped: true };
  }

  // One transaction: a half-seeded database is worse than an empty one, because it
  // looks like it worked.
  const idByProduct = new Map<string, string>();

  await dataSource.transaction(async (manager) => {
    for (const row of SEED_ROWS) {
      const reviewedAt = row.review ? daysAgo(row.review.daysAgo) : null;

      const saved = await manager.getRepository(ProductFootprint).save(
        manager.getRepository(ProductFootprint).create({
          ownerId: ownerIdFor(row.ownerEmail),
          product: row.product,
          supplier: row.supplier,
          category: row.category,
          emissionsValue: row.emissionsValue,
          uncertaintyPercent: row.uncertaintyPercent,
          status: row.status,
          submittedAt: daysAgo(row.submittedDaysAgo),
          supplierNotes: row.supplierNotes ?? null,
          reviewComment: row.review?.comment ?? null,
          reviewedAt,
          reviewedBy: row.review?.by ?? null,
        }),
      );

      idByProduct.set(row.product, saved.id);

      if (row.review && reviewedAt) {
        await manager.getRepository(ReviewEvent).insert({
          footprintId: saved.id,
          decision: row.review.decision,
          comment: row.review.comment,
          reviewedBy: row.review.by,
          createdAt: reviewedAt,
        });
      }
    }

    for (const share of SHARES) {
      const footprintId = idByProduct.get(share.product);
      if (!footprintId) throw new Error(`Share refers to unknown product "${share.product}"`);

      const owner = SEED_ROWS.find((row) => row.product === share.product)?.ownerEmail;
      if (!owner) throw new Error(`No owner for "${share.product}"`);

      await manager.getRepository(FootprintShare).insert({
        footprintId,
        userId: ownerIdFor(share.email),
        role: share.role,
        grantedById: ownerIdFor(owner),
      });
    }
  });

  return { inserted: SEED_ROWS.length, shares: SHARES.length, skipped: false };
}
