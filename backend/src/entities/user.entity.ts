import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * A reviewer.
 *
 * Authentication here is deliberately minimal — the brief rules out production identity
 * and OAuth — but it is a real boundary rather than a spoofable header: each user holds
 * an opaque bearer token, and only its SHA-256 digest is stored.
 *
 * A fast hash is the correct choice for this specific case, and it is worth being clear
 * why, since passwords demand the opposite. These tokens are 256 bits of CSPRNG output,
 * so there is no dictionary to attack and no cost factor worth paying; argon2/bcrypt
 * exist to slow down guessing of *low-entropy human-chosen* secrets. What matters here
 * is that the plaintext is never stored, so a database leak does not hand over live
 * credentials.
 */
@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index("idx_users_email", { unique: true })
  @Column({ type: "varchar", length: 200 })
  email!: string;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  /** argon2id hash of the user's password. Never selected unless asked for by name. */
  @Column({ name: "password_hash", type: "varchar", length: 255, select: false })
  passwordHash!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
