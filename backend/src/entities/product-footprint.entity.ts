import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { REVIEW_STATUSES, type ReviewStatus } from "../domain/footprint";
import { ReviewEvent } from "./review-event.entity";
import { numericTransformer } from "./transformers";
import { User } from "./user.entity";

/**
 * A supplier's carbon footprint submission for one product, and the object a reviewer
 * approves or rejects.
 *
 * `reviewComment` / `reviewedAt` / `reviewedBy` denormalise the most recent decision
 * onto the row so the list view does not need a join. The authoritative history is the
 * `reviews` relation — both are written in the same transaction.
 */
@Entity({ name: "product_footprints" })
// Serves the default queue query (`WHERE status = ... ORDER BY submitted_at DESC`) and,
// on its leading column alone, the status facet counts.
@Index("idx_footprints_status_submitted_at", ["status", "submittedAt"])
@Index("idx_footprints_submitted_at", ["submittedAt"])
/* Invariants the database enforces regardless of which client writes the row. The
 * service validates the same things and returns a friendly 400; these are the backstop
 * for a bad migration, a manual `psql` edit, or a future second writer. */
@Check("CHK_footprints_emissions_non_negative", `"emissions_value" >= 0`)
@Check(
  "CHK_footprints_uncertainty_range",
  `"uncertainty_percent" >= 0 AND "uncertainty_percent" <= 100`,
)
@Check(
  "CHK_footprints_review_fields_consistent",
  `("status" = 'pending' AND "reviewed_at" IS NULL AND "reviewed_by" IS NULL)
   OR ("status" <> 'pending' AND "reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL)`,
)
export class ProductFootprint {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * The user who created the submission, and the only one who can share or delete it.
   * Every read query is scoped against this column or a row in `footprint_shares`.
   */
  @Index("idx_footprints_owner")
  @Column({ name: "owner_id", type: "uuid" })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "owner_id" })
  owner?: User;

  @Column({ type: "varchar", length: 200 })
  product!: string;

  /** The tier-1 supplier that reported the figure. */
  @Index("idx_footprints_supplier")
  @Column({ type: "varchar", length: 200 })
  supplier!: string;

  @Index("idx_footprints_category")
  @Column({ type: "varchar", length: 100 })
  category!: string;

  /** kg CO2e per unit. `numeric` rather than float: this number ends up in reporting. */
  @Column({
    name: "emissions_value",
    type: "numeric",
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  emissionsValue!: number;

  /** Uncertainty as a percentage, e.g. 12 means ±12%. */
  @Column({
    name: "uncertainty_percent",
    type: "numeric",
    precision: 6,
    scale: 2,
    transformer: numericTransformer,
  })
  uncertaintyPercent!: number;

  @Column({
    type: "enum",
    enum: REVIEW_STATUSES,
    enumName: "review_status",
    default: "pending",
  })
  status!: ReviewStatus;

  @Column({ name: "submitted_at", type: "timestamptz" })
  submittedAt!: Date;

  /** Free-text notes the supplier included with the submission. */
  @Column({ name: "supplier_notes", type: "text", nullable: true })
  supplierNotes!: string | null;

  /** Comment attached to the most recent decision. Null while pending. */
  @Column({ name: "review_comment", type: "text", nullable: true })
  reviewComment!: string | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: "reviewed_by", type: "varchar", length: 120, nullable: true })
  reviewedBy!: string | null;

  @OneToMany(() => ReviewEvent, (event) => event.footprint)
  reviews?: ReviewEvent[];

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
