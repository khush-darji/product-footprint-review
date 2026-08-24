import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./user.entity";

/**
 * A signed-in session.
 *
 * Server-side sessions rather than JWTs, for one reason that matters here: **they revoke
 * instantly**. Signing out deletes this row and the next request fails, whereas a
 * self-contained JWT stays valid until it expires no matter what the server wants.
 * Given the app's whole point is controlling who can see what, "revoke takes effect now"
 * is worth a database round trip per request.
 *
 * Only the SHA-256 digest of the session token is stored. A fast hash is right here (and
 * wrong for the password on `User`) because the token is 256 bits of CSPRNG output —
 * there is no dictionary to attack, and the only property needed is that a leaked
 * database does not contain usable session cookies.
 */
@Entity({ name: "sessions" })
export class Session {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** SHA-256 of the session token, hex-encoded. Unique so lookup is one indexed read. */
  @Index("idx_sessions_token_hash", { unique: true })
  @Column({ name: "token_hash", type: "char", length: 64 })
  tokenHash!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "user_id" })
  user?: User;

  /** Absolute expiry. Checked on every request and swept on login. */
  @Index("idx_sessions_expires_at")
  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
