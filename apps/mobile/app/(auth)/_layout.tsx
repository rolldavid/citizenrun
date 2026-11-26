import { Stack } from 'expo-router';

/** The sign-in group: a stack with no native header, and no gesture back from onboarding to sign-in. */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
