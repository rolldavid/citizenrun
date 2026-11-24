import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { Haptics } from './types';

const ANDROID_CONFIRM_MIN_API = 30; // PM-haptics

/** Fire and forget: a call never throws and its promise is never left unhandled. */
function play(run: () => Promise<void>): void {
  try {
    void run().catch(() => undefined);
  } catch {
    // the library threw synchronously
  }
}

function android(type: ExpoHaptics.AndroidHaptics): void {
  play(() => ExpoHaptics.performAndroidHapticsAsync(type));
}

function confirmCapable(): boolean {
  return typeof Platform.Version === 'number' && Platform.Version >= ANDROID_CONFIRM_MIN_API;
}

export const haptics: Haptics = {
  supported: true,
  selection: () => {
    if (Platform.OS === 'android') {
      android(ExpoHaptics.AndroidHaptics.Clock_Tick);
      return;
    }
    play(() => ExpoHaptics.selectionAsync());
  },
  impact: (weight) => {
    if (Platform.OS === 'android') {
      android(
        weight === 'light'
          ? ExpoHaptics.AndroidHaptics.Context_Click
          : ExpoHaptics.AndroidHaptics.Long_Press,
      );
      return;
    }
    play(() =>
      ExpoHaptics.impactAsync(
        weight === 'light'
          ? ExpoHaptics.ImpactFeedbackStyle.Light
          : ExpoHaptics.ImpactFeedbackStyle.Medium,
      ),
    );
  },
  notify: (kind) => {
    if (Platform.OS === 'android') {
      if (!confirmCapable()) {
        android(ExpoHaptics.AndroidHaptics.Long_Press);
        return;
      }
      android(
        kind === 'success' ? ExpoHaptics.AndroidHaptics.Confirm : ExpoHaptics.AndroidHaptics.Reject,
      );
      return;
    }
    play(() =>
      ExpoHaptics.notificationAsync(
        kind === 'success'
          ? ExpoHaptics.NotificationFeedbackType.Success
          : ExpoHaptics.NotificationFeedbackType.Warning,
      ),
    );
  },
};

export type * from './types';
