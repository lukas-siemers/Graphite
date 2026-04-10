/**
 * BUILD 35 — Pure diagnostic route.
 * If you see this RED screen, Expo Router + Stack + JS bundle all work.
 * No redirect, no @graphite imports, no AuthGate.
 */
import React from 'react';
import { View, Text, Platform } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FF0000', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <Text style={{ fontSize: 42, fontWeight: '900', color: '#FFFFFF' }}>
        BUILD 35
      </Text>
      <Text style={{ fontSize: 22, color: '#FFFFFF', marginTop: 20, textAlign: 'center' }}>
        Expo Router works!
      </Text>
      <Text style={{ fontSize: 16, color: '#FFFFFF', marginTop: 16 }}>
        Platform: {Platform.OS}
      </Text>
    </View>
  );
}
