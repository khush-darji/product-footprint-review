import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { REVIEW_DECISIONS, type ReviewDecision } from "../domain/footprint";
import { ProductFootprint } from "./product-footprint.entity";

/**
 * One decision in a submission's review timeline: append-only, never updated.
 *
 * Keeping the history separate from the denormalised "latest decision" columns on
 * `product_footprints` means re-opening a submission for a second review is a new row
 * rather than a destructive overwrite of who said what.
 */
@Entity({ name: "review_events" })
@Index("idx_review_events_footprint_created_at", ["footprintId", "createdAt"])
export class ReviewEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "footprint_id", type: "uuid" })
  footprintId!: string;

  @ManyToOne(() => ProductFootprint, (footprint) => footprint.reviews, {
    onDelete: "CASCADE",
    nullable: false,
  })
  @JoinColumn({ name: "footprint_id" })
  footprint?: ProductFootprint;

  @Column({ type: "enum", enum: REVIEW_DECISIONS, enumName: "review_decision" })
  decision!: ReviewDecision;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @Column({ name: "reviewed_by", type: "varchar", length: 120 })
  reviewedBy!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
