import type { ErrorCode, Me } from '@citizenrun/shared';

import type { OnboardingHandleViewModel, OnboardingPhotoViewModel } from '@/features/onboarding';
import type { ViewState } from '@/lib/view-state';

/** SCR-settings-profile. */
export type SettingsProfileViewModel = ViewState<{
  me: Me;
  photo: OnboardingPhotoViewModel['photo'];
  handle: Pick<OnboardingHandleViewModel, 'check' | 'invalidReason' | 'onChange'>;
  save: {
    status: 'idle' | 'sending' | 'saved';
    fields: Partial<Record<'name' | 'bio' | 'link' | 'handle', string>>;
    errorCode: ErrorCode | null;
  };
  onChoosePhoto: () => void;
  onRemovePhoto: () => void;
  onSave: (input: {
    name: string | null;
    bio: string | null;
    link: string | null;
    handle: string;
  }) => void;
}>;
