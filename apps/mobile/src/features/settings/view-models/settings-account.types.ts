import type { Me } from '@citizenrun/shared';

import type { SignInViewModel } from '@/features/auth';
import type { ViewState } from '@/lib/view-state';

// SCR-settings-account
export type SettingsAccountViewModel = ViewState<{
  me: Me;
  addEmail: {
    stage: 'closed' | 'email' | 'code';
    email: SignInViewModel['email'];
    code: SignInViewModel['code'];
  };
  onOpenAddEmail: () => void;
  onCloseAddEmail: () => void;
}>;
