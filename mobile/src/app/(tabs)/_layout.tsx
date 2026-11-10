import React from 'react';
import { Tabs } from 'expo-router';
import { BottomNav } from '../../components/ui';
import { AddSheetHost } from '../../components/AddSheet';
import { C } from '../../theme';

/**
 * The five main screens live in one tab navigator, so switching tabs only shows a screen that
 * is already built instead of rebuilding it (and re-reading the database) on every tap.
 * Hidden tabs are frozen: they don't re-render while the agent is elsewhere, and catch up the
 * moment they are shown again.
 */
export default function TabsLayout() {
  return (
    <>
    <Tabs
      backBehavior="initialRoute"
      tabBar={() => <BottomNav />}
      screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="today" />
      <Tabs.Screen name="followups" />
      <Tabs.Screen name="assistant" />
      <Tabs.Screen name="patients" />
      <Tabs.Screen name="me" />
    </Tabs>
    {/* The centre "+ Add" sheet, opened by the bottom bar (or openAddSheet() from any tab screen). */}
    <AddSheetHost />
    </>
  );
}
