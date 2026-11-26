import { Tabs } from 'expo-router';

import { RootTabBar } from '@/features/system';

/**
 * The tabs navigator: C-TabBar through RootTabBar, each tab mounted on first focus and kept. The
 * router shows only the tab screens a layout declares, so each tab route is listed here.
 */
export default function TabsLayout() {
  return (
    <Tabs tabBar={() => <RootTabBar />} screenOptions={{ headerShown: false, lazy: true }}>
      <Tabs.Screen name="index" />
    </Tabs>
  );
}
