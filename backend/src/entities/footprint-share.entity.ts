import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { SHAREABLE_ROLES, type ShareableRole } from "../domain/access";
import { ProductFootprint } from "./product-footprint.entity";
import { User } from "./user.entity";

/**
 * One grant of access on one submission.
 *
 * The owner is not represented here — ownership lives in `product_footprints.owner_id`.
 * A row in this table always means "somebody other than the owner was given access",
 * which keeps "can this user see it" a single OR between two clear facts.
 */
@Entity({ name: "footprint_shares" })
// One grant per user per footprint: re-sharing updates the role rather than stacking a
// second row, so there is never an ambiguous "which role wins" question.
@Unique("uq_footprint_shares_footprint_user", ["footprintId", "userId"])
// Serves "everything shared with me", which is half of every list query.
@Index("idx_footprint_shares_user", ["userId"])
export class FootprintShare {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "footprint_id", type: "uuid" })
  footprintId!: string;

  @ManyToOne(() => ProductFootprint, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "footprint_id" })
  footprint?: ProductFootprint;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  // Deleting a user removes their grants; it must not delete the submissions.
  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "enum", enum: SHAREABLE_ROLES, enumName: "share_role" })
  role!: ShareableRole;

  /** Who granted it. Nullable so revoking the granter's account keeps the grant valid. */
  @Column({ name: "granted_by_id", type: "uuid", nullable: true })
  grantedById!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "granted_by_id" })
  grantedBy?: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
