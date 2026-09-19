import type { ModelAsset } from './types.js';

export type GenerationCategory = 'bed' | 'desk' | 'chair' | 'shelf' | 'lamp';
export type FurnitureTemplate = 'bed' | 'desk-pedestal' | 'desk-table' | 'chair' | 'chair-sled' | 'shelf' | 'lamp';
export type DimensionSource = 'product_text' | 'product_url' | 'image_label' | 'estimated' | 'user';
export type ConfirmedDimensions = { widthM: number; heightM: number; depthM: number };
export type DimensionMeasurement = { valueM: number; source: DimensionSource; evidence: string };
export type DimensionReview = {
  width: DimensionMeasurement;
  height: DimensionMeasurement;
  depth: DimensionMeasurement;
};
export type PrepareRequest = {
  imageDataUrl: string;
  sourceUrl?: string | null;
  productText?: string;
  categoryHint?: GenerationCategory | null;
  mode?: 'live' | 'preset';
};
export type PreparedImport = {
  importId: string;
  expiresAt: string;
  title: string;
  category: GenerationCategory;
  template: FurnitureTemplate;
  dimensions: DimensionReview;
  warnings: string[];
  analysisMethod: 'gpt' | 'preset';
  usage: { inputTokens: number; outputTokens: number; cached: boolean };
};
export type GenerateRequest = {
  importId: string;
  productId: string;
  dimensions: ConfirmedDimensions;
  confirmed: true;
  acceptEstimated?: boolean;
};
export type GenerationJob = {
  jobId: string;
  status: 'queued' | 'generating' | 'ready' | 'failed';
  asset: ModelAsset | null;
  dimensions: DimensionReview;
  error: string | null;
  cached: boolean;
};
