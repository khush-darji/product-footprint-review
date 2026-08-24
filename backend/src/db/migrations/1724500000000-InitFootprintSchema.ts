import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Initial schema: product footprint submissions and their append-only review timeline.
 *
 * Generated from the entities with `migration:generate`, then edited for two things the
 * generator cannot know about:
 *
 *  1. `uuid_generate_v4()` — which TypeORM emits for `@PrimaryGeneratedColumn("uuid")`
 *     — lives in the `uuid-ossp` extension, which is not installed by default. Without
 *     the CREATE EXTENSION below the very first CREATE TABLE fails.
 *  2. The queue's text search is `ILIKE '%term%'`, which no btree index can serve. The
 *     trigram GIN indexes make it an index scan instead of a sequential one. They are
 *     deliberately not declared on the entity: TypeORM has no metadata for the
 *     `gin_trgm_ops` operator class, so the entity could only describe them wrongly.
 */
export class InitFootprintSchema1724500000000 implements MigrationInterface {
  name = "InitFootprintSchema1724500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(
      `CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."review_decision" AS ENUM('approved', 'rejected')`,
    );

    await queryRunner.query(`
      CREATE TABLE "product_footprints" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "product" character varying(200) NOT NULL,
        "supplier" character varying(200) NOT NULL,
        "category" character varying(100) NOT NULL,
        "emissions_value" numeric(14,4) NOT NULL,
        "uncertainty_percent" numeric(6,2) NOT NULL,
        "status" "public"."review_status" NOT NULL DEFAULT 'pending',
        "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "supplier_notes" text,
        "review_comment" text,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "reviewed_by" character varying(120),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_9e052783787920480a7ddd7e030" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_footprints_emissions_non_negative" CHECK ("emissions_value" >= 0),
        CONSTRAINT "CHK_footprints_uncertainty_range"
          CHECK ("uncertainty_percent" >= 0 AND "uncertainty_percent" <= 100),
        CONSTRAINT "CHK_footprints_review_fields_consistent" CHECK (
          ("status" = 'pending' AND "reviewed_at" IS NULL AND "reviewed_by" IS NULL)
          OR ("status" <> 'pending' AND "reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "review_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "footprint_id" uuid NOT NULL,
        "decision" "public"."review_decision" NOT NULL,
        "comment" text,
        "reviewed_by" character varying(120) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_56256411bd89756b5d504504f59" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_footprints_supplier" ON "product_footprints" ("supplier")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_category" ON "product_footprints" ("category")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_submitted_at" ON "product_footprints" ("submitted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_status_submitted_at" ON "product_footprints" ("status", "submitted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_product_trgm" ON "product_footprints" USING GIN ("product" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_supplier_trgm" ON "product_footprints" USING GIN ("supplier" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_review_events_footprint_created_at" ON "review_events" ("footprint_id", "created_at")`,
    );

    await queryRunner.query(`
      ALTER TABLE "review_events"
        ADD CONSTRAINT "FK_8c735d824227e44cba195761fda"
        FOREIGN KEY ("footprint_id") REFERENCES "product_footprints"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "review_events" DROP CONSTRAINT "FK_8c735d824227e44cba195761fda"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_review_events_footprint_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_supplier_trgm"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_product_trgm"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_status_submitted_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_submitted_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_category"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_supplier"`);
    await queryRunner.query(`DROP TABLE "review_events"`);
    await queryRunner.query(`DROP TABLE "product_footprints"`);
    await queryRunner.query(`DROP TYPE "public"."review_decision"`);
    await queryRunner.query(`DROP TYPE "public"."review_status"`);
    // The extensions are intentionally left installed. Dropping a database-wide
    // extension on the way down would break anything else in the database using it,
    // and both are safe to leave in place.
  }
}
