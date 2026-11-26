// SCR-settings-about
export type SettingsAboutViewModel = {
  appVersion: string;
  sources: readonly { name: string; url: string | null }[];
  links: readonly {
    id:
      | 'privacy'
      | 'terms'
      | 'contentPolicy'
      | 'childSafety'
      | 'dmca'
      | 'credits'
      | 'support'
      | 'deleteAccount'
      | 'reportIntimateImage';
    url: string;
  }[];
  onOpen: (url: string) => void;
};
