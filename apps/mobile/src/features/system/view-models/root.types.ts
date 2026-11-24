/** The system screens drawn in place of the navigator; later members join with their screens (SCR-root-layout). */
export type SystemScreenId = 'update';

export type NavItem = 'home' | 'explore' | 'post' | 'activity' | 'messages' | 'profile';

export type RootViewModel = {
  boot: 'starting' | 'ready'; // 'starting': storage is still hydrating
  themeChoice: 'system' | 'light' | 'dark';
  fontsReady: boolean;
  system: SystemScreenId | null;
  shell: {
    mode: 'app' | 'bare';
    active: NavItem | null;
    unread: { messages: number; activity: number };
    place: { name: string; districtCount: number; officeCount: number } | null;
    signedIn: boolean;
  };
  onNavigate: (item: NavItem) => void;
  onReselect: (item: NavItem) => void;
};
