import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { initDatabase } from '@graphite/db';

export default function MainLayout() {
  useEffect(() => {
    initDatabase().catch(console.error);
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
