/** SCR-onboarding-photo (PC6B-17, D-547). */
export type OnboardingPhotoViewModel = {
  photo:
    | { status: 'none' }
    | { status: 'ready'; previewUri: string } // picked and prepared; not yet sent
    | { status: 'uploading'; previewUri: string; sentBytes: number; totalBytes: number }
    | { status: 'failed'; previewUri: string | null; failure: PhotoFailure };
  skipStatus: 'idle' | 'sending';
  offline: boolean; // the device has no connection: no submitting callback runs
  onChoose: () => void; // upload.pickAvatarPhoto(), then upload.preparePhoto(item, { crop }) with the centred square (PM-upload, D-547)
  onContinue: () => void; // E-UPL-01, upload.send, E-ME-02
  onSkip: () => void; // E-ME-10
  onOpenSettings: () => void; // links.openAppSettings(): the action of the photos_blocked notice
};

export type PhotoFailure =
  | 'photos_blocked' // PickOutcome 'denied' with state 'blocked'
  | 'unsupported_format'
  | 'photo_too_large'
  | 'prepare_failed' // PrepareOutcome 'rejected' and 'failed'
  | 'upload_failed' // SendOutcome 'refused', 'failed', or 'expired' twice
  | 'rate_limited'
  | 'generic'; // E-UPL-01 or E-ME-02 refused
