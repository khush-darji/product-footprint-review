import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Users, footprint ownership, and viewer/editor sharing.
 *
 * Generated from the entities, then corrected for two things the generator got wrong —
 * both of them predicted in the README:
 *
 *  1. It wanted to DROP the two trigram indexes (it has no metadata for the
 *     `gin_trgm_ops` operator class) and recreate them in `down()` *without* the
 *     operator class, which would silently turn the queue search back into a sequential
 *     scan. Those statements are removed; the indexes are left alone.
 *  2. It emitted `ADD "owner_id" uuid NOT NULL` against a table that already holds rows,
 *     which fails outright. Replaced with the add-nullable / backfill / enforce sequence.
 *
 * The backfill needs an owner for pre-existing submissions, so it creates a "Legacy
 * import" account and assigns them to it. **No bearer token is ever issued for that
 * account** — its token hash has no known preimage — so those rows are owned but
 * unreachable until a real user takes them over. That is the safe direction to fail:
 * the alternative, assigning them to the first real user, would silently hand one
 * person everything.
 */
export class AddUsersAndSharing1724700000000 implements MigrationInterface {
  name = "AddUsersAndSharing1724700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(200) NOT NULL,
        "display_name" character varying(120) NOT NULL,
        "api_token_hash" character(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_users_token_hash" ON "users" ("api_token_hash")`,
    );

    await queryRunner.query(`CREATE TYPE "public"."share_role" AS ENUM('editor', 'viewer')`);

    await queryRunner.query(`
      CREATE TABLE "footprint_shares" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "footprint_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" "public"."share_role" NOT NULL,
        "granted_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_footprint_shares_footprint_user" UNIQUE ("footprint_id", "user_id"),
        CONSTRAINT "PK_8b05e1a3a37111a718e76e99541" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_footprint_shares_user" ON "footprint_shares" ("user_id")`,
    );

    /* --- owner_id: add nullable, backfill, then enforce ------------------------- */
    await queryRunner.query(`ALTER TABLE "product_footprints" ADD "owner_id" uuid`);

    // Only create the placeholder account if there is actually something to assign.
    await queryRunner.query(`
      INSERT INTO "users" ("email", "display_name", "api_token_hash")
      SELECT
        'legacy-import@invalid.local',
        'Legacy import',
        -- 64 hex characters with no known preimage: this account can never authenticate.
        md5(random()::text) || md5(random()::text)
      WHERE EXISTS (SELECT 1 FROM "product_footprints" WHERE "owner_id" IS NULL)
    `);

    await queryRunner.query(`
      UPDATE "product_footprints"
      SET "owner_id" = (SELECT "id" FROM "users" WHERE "email" = 'legacy-import@invalid.local')
      WHERE "owner_id" IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "product_footprints" ALTER COLUMN "owner_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_footprints_owner" ON "product_footprints" ("owner_id")`,
    );

    /* --- foreign keys ----------------------------------------------------------- */
    await queryRunner.query(`
      ALTER TABLE "product_footprints"
        ADD CONSTRAINT "FK_6281ce9207deb2da4dab9b0b604"
        FOREIGN KEY ("owner_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "footprint_shares"
        ADD CONSTRAINT "FK_f2283b9495cbdd52b1df2f7f317"
        FOREIGN KEY ("footprint_id") REFERENCES "product_footprints"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "footprint_shares"
        ADD CONSTRAINT "FK_9d4683c4e446b475de6ac60e1cc"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "footprint_shares"
        ADD CONSTRAINT "FK_694572ae53ae07d321600f03089"
        FOREIGN KEY ("granted_by_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "footprint_shares" DROP CONSTRAINT "FK_694572ae53ae07d321600f03089"`,
    );
    await queryRunner.query(
      `ALTER TABLE "footprint_shares" DROP CONSTRAINT "FK_9d4683c4e446b475de6ac60e1cc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "footprint_shares" DROP CONSTRAINT "FK_f2283b9495cbdd52b1df2f7f317"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_footprints" DROP CONSTRAINT "FK_6281ce9207deb2da4dab9b0b604"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_footprints_owner"`);
    await queryRunner.query(`ALTER TABLE "product_footprints" DROP COLUMN "owner_id"`);
    await queryRunner.query(`DROP INDEX "public"."idx_footprint_shares_user"`);
    await queryRunner.query(`DROP TABLE "footprint_shares"`);
    await queryRunner.query(`DROP TYPE "public"."share_role"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
