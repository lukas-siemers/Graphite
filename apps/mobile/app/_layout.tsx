/**
 * BUILD 35 — Proper Expo Router root layout with Stack.
 * No imports from @graphite packages. Just Stack + Expo Router.
 */
import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
