import type { SuspendedReason } from '@citizenrun/shared';

/** The system screens, by the precedence of SCR-system-update and the screens after it (SCR-root-layout). */
export type SystemScreenId = 'update' | 'adultsOnly' | 'agreements' | 'suspended';

export type NavItem = 'home' | 'explore' | 'post' | 'activity' | 'messages' | 'profile';

export type RootViewModel = {
  boot: 'starting' | 'ready'; // 'starting': storage and session are still hydrating
  themeChoice: 'system' | 'light' | 'dark';
  fontsReady: boolean;
  system: SystemScreenId | null;
  shell: {
    mode: 'app' | 'bare';
    active: NavItem | null;
    unread: { messages: number; activity: number };
    place: { name: string; districtCount: number; officeCount: number } | null;
    signedIn: boolean;
    showGetAppBar: boolean;
    suspended: { reason: SuspendedReason; since: string } | null;
  };
  createDialogOpen: boolean; // medium and expanded only
  onNavigate: (item: NavItem) => void;
  onReselect: (item: NavItem) => void;
  onCloseCreateDialog: () => void;
};
