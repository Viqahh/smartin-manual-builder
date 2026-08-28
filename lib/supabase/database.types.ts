/**
 * Hand-authored database types for Phase 2 (kept in sync with supabase/migrations/*.sql).
 * Replace with `npm run db:types` output (`supabase gen types typescript --local`) once a
 * local/hosted project is available — see docs/PHASE_2.md.
 */

export type MembershipRole =
  | "DEVELOPER"
  | "TECHNICAL_REVIEWER"
  | "COMPLIANCE_REVIEWER"
  | "ADMIN";

export type EaPlatform = "MT4" | "MT5";

export type MtTimeframeDb =
  | "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1" | "MN1";

export type EaParamTypeDb = "bool" | "int" | "double" | "string" | "enum" | "color";
export type EaParamMutabilityDb = "before_start" | "may_change_live" | "needs_reattach";

export type ManualStatusDb =
  | "DRAFT" | "TECHNICAL_REVIEW" | "COMPLIANCE_REVIEW" | "CHANGES_REQUESTED"
  | "APPROVED" | "PUBLISHED" | "ARCHIVED";

export type ManualBlockTypeDb =
  | "text" | "steps" | "image" | "callout" | "parameterTable" | "faq";

export type ImageScanStatusDb = "pending" | "clean" | "failed" | "skipped";
export type SectionCompletionStateDb = "incomplete" | "in_progress" | "complete" | "issue";

type Timestamps = { created_at: string; updated_at: string };

export interface OrganizationRow extends Timestamps {
  id: string;
  name: string;
  slug: string;
}

export interface ProfileRow extends Timestamps {
  id: string;
  email: string;
  display_name: string;
}

export interface MembershipRow extends Timestamps {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  is_active: boolean;
}

export interface EaProductRow extends Timestamps {
  id: string;
  organization_id: string;
  owner_id: string | null;
  name: string;
  slug: string;
  description: string;
  archived_at: string | null;
}

export interface EaVersionRow extends Timestamps {
  id: string;
  organization_id: string;
  ea_product_id: string;
  version: string;
  platform: EaPlatform;
  release_date: string | null;
  requirements: Record<string, unknown>;
  support: Record<string, unknown>;
}

export interface EaVersionSetupRow extends Timestamps {
  id: string;
  organization_id: string;
  ea_version_id: string;
  symbol: string;
  timeframe: MtTimeframeDb;
  preset_ref: string | null;
  tested_minimum_lot: number | null;
  notes: string | null;
  is_supported: boolean;
  position: number;
}

export interface ParameterGroupRow extends Timestamps {
  id: string;
  organization_id: string;
  ea_version_id: string;
  name: string;
  position: number;
}

export interface EaParameterRow extends Timestamps {
  id: string;
  organization_id: string;
  parameter_group_id: string;
  display_name: string;
  technical_name: string;
  param_type: EaParamTypeDb;
  default_value: string | null;
  unit: string | null;
  min_value: string | null;
  max_value: string | null;
  enum_options: string[];
  safe_range: string | null;
  description: string | null;
  order_effect: string | null;
  mutability: EaParamMutabilityDb;
  notes: string | null;
  required: boolean;
  position: number;
}

export interface ManualRow extends Timestamps {
  id: string;
  organization_id: string;
  ea_product_id: string;
  template_id: string | null;
  locale: string;
}

export interface ManualVersionRow extends Timestamps {
  id: string;
  organization_id: string;
  manual_id: string;
  ea_version_id: string;
  version: string;
  status: ManualStatusDb;
  template_version: number | null;
  completion: Record<string, unknown>;
  row_version: number;
  published_at: string | null;
  reviewed_at: string | null;
}

export interface ManualSectionRow extends Timestamps {
  id: string;
  organization_id: string;
  manual_version_id: string;
  section_key: string;
  title: string;
  required: boolean;
  is_custom: boolean;
  position: number;
  completion_state: SectionCompletionStateDb;
  row_version: number;
}

export interface ManualBlockRow extends Timestamps {
  id: string;
  organization_id: string;
  manual_section_id: string;
  block_type: ManualBlockTypeDb;
  payload: Record<string, unknown>;
  position: number;
  image_asset_id: string | null;
  parameter_group_ids: string[];
  deleted_at: string | null;
  row_version: number;
}

export interface ImageAssetRow extends Timestamps {
  id: string;
  organization_id: string;
  owner_id: string | null;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  alt_text: string | null;
  annotations: Record<string, unknown>;
  scan_status: ImageScanStatusDb;
}

export interface AuditEventRow {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
