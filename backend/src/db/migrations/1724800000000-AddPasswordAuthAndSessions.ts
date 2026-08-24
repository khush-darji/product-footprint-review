import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Replaces bearer-token auth with email + password login and server-side sessions.
 *
 * Generated from the entities, then corrected for the same two things the generator gets
 * wrong every time in this project:
 *
 *  1. It wanted to DROP the two trigram indexes and recreate them in `down()` *without*
 *     `gin_trgm_ops`, silently turning the queue search back into a sequential scan.
 *     Removed; the indexes are left alone. (This is the third migration it has tried it
 *     on — see the note in the README.)
 *  2. It emitted `ADD "password_hash" character varying(255) NOT NULL` against a table
 *     that already holds users, which fails outright. Replaced with add-nullable /
 *     backfill / enforce.
 *
 * The backfill writes `'!'` — deliberately not a valid argon2 hash. `verifyPassword`
 * treats an unparseable hash as a failed login, so any pre-existing account is locked
 * out until a real password is set rather than being left with a guessable one. That is
 * the safe direction to fail.
 */
export class AddPasswordAuthAndSessions1724800000000 implements MigrationInterface {
  name = "AddPasswordAuthAndSessions1724800000000";

  /** Not a valid argon2 encoded hash, so it can never verify against any password. */
  private static readonly UNUSABLE = "!";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* --- users: token -> password ---------------------------------------------- */
    await queryRunner.query(`DROP INDEX "public"."idx_users_token_hash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "api_token_hash"`);

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "password_hash" character varying(255)`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "password_hash" = $1 WHERE "password_hash" IS NULL`,
      [AddPasswordAuthAndSessions1724800000000.UNUSABLE],
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`,
    );

    /* --- sessions ---------------------------------------------------------------- */
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "token_hash" character(64) NOT NULL,
        "user_id" uuid NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_sessions_token_hash" ON "sessions" ("token_hash")`,
    );
    // Serves the expiry sweep; the lookup itself goes through the unique token index.
    await queryRunner.query(
      `CREATE INDEX "idx_sessions_expires_at" ON "sessions" ("expires_at")`,
    );
    await queryRunner.query(`
      ALTER TABLE "sessions"
        ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_expires_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_token_hash"`);
    await queryRunner.query(`DROP TABLE "sessions"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "api_token_hash" character(64)`,
    );
    // Same reasoning in reverse: a 64-character sentinel with no known preimage, so no
    // reverted account is left with a usable token.
    await queryRunner.query(
      `UPDATE "users" SET "api_token_hash" = md5(random()::text) || md5(random()::text) WHERE "api_token_hash" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "api_token_hash" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_users_token_hash" ON "users" ("api_token_hash")`,
    );
  }
}
