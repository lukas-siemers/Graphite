/**
 * BUILD 33 — ISOLATION TEST
 *
 * Zero imports from @graphite packages, no Supabase, no AuthGate.
 * Only core React Native + Expo Router.
 * If this still shows black, the issue is in the native layer or Expo Router.
 * If this shows the red screen, the issue is in our @graphite imports.
 */
import React from 'react';
import { View, Text, Platform } from 'react-native';

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FF0000', alignItems: 'center', justifyContent: 'center', paddingTop: 100 }}>
      <Text style={{ fontSize: 36, fontWeight: '900', color: '#FFFFFF' }}>
        BUILD 33
      </Text>
      <Text style={{ fontSize: 20, color: '#FFFFFF', marginTop: 16 }}>
        ISOLATION TEST
      </Text>
      <Text style={{ fontSize: 16, color: '#FFFFFF', marginTop: 12 }}>
        Platform: {Platform.OS}
      </Text>
      <Text style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }}>
        If you see RED the JS works
      </Text>
    </View>
  );
}
