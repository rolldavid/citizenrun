export type AgeOutcome =
  | { kind: 'adult'; tier: 'confirmed' | 'declared' } // the store says 18 or over
  | { kind: 'minor'; tier: 'confirmed' | 'declared'; under13: boolean } // the store says under 18; under13: its upper bound is below 13
  | { kind: 'unavailable' }; // no signal, declined, not eligible, old OS, or web

export interface AgeAssurance {
  readonly storeSignalSupported: boolean;
  requestStoreSignal(): Promise<AgeOutcome>;
  significantUpdateAcknowledgmentRequired(): Promise<boolean>; // iOS getRequiredRegulatoryFeaturesAsync; false elsewhere
  acknowledgeSignificantUpdate(): Promise<void>; // iOS showSignificantUpdateAcknowledgmentAsync; no-op elsewhere
  /** The date-of-birth gate (CTL-75): adult when `today` (UTC, 'YYYY-MM-DD') is on or after the first day of
   *  the month after the birth month, 18 years later. Pure; the month and year never leave the device. */
  evaluateBirthMonth(birth: { year: number; month: number }, today: string): 'adult' | 'minor';
  /** The gate's lock: the ISO instant until which the gate asks nothing again (storage 'ageGate.blockedUntil'), or null. */
  gateBlockedUntil(): string | null;
  /** Locks the gate for 24 hours from `now` (CTL-75). */
  blockGate(now: Date): void;
}
