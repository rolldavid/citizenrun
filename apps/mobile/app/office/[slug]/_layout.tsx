import { Stack } from 'expo-router';

// A deep link to a page under the office opens with the office page under it.
export const unstable_settings = { initialRouteName: 'index' };

export default function OfficeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
