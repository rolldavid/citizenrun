export type AgeOutcome =
  | { kind: 'adult'; tier: 'confirmed' | 'declared' } // the store says 18 or over
  | { kind: 'minor'; tier: 'confirmed' | 'declared'; under13: boolean } // the store says under 18; under13: its upper bound is below 13
  | { kind: 'unavailable' }; // no signal, declined, not eligible, old OS, or web

export interface AgeAssurance {
  readonly storeSignalSupported: boolean;
  requestStoreSignal(): Promise<AgeOutcome>;
  significantUpdateAcknowledgmentRequired(): Promise<boolean>; // iOS getRequiredRegulatoryFeaturesAsync; false elsewhere
  acknowledgeSignificantUpdate(): Promise<void>; // iOS showSignificantUpdateAcknowledgmentAsync; no-op elsewhere
}
