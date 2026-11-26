// SCR-settings-appearance
export type SettingsAppearanceViewModel = {
  choice: 'system' | 'light' | 'dark';
  onChange: (choice: 'system' | 'light' | 'dark') => void;
};
