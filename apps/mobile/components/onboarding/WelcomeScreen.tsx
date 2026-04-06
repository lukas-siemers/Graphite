import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';

interface WelcomeScreenProps {
  onComplete: () => void;
}

const FEATURES: Array<{
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
}> = [
  { icon: 'notebook-edit-outline', label: 'Write in Markdown' },
  { icon: 'draw', label: 'Draw with Apple Pencil' },
  { icon: 'folder-multiple-outline', label: 'Organize with Notebooks' },
];

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <View style={styles.overlay}>
      <View style={styles.content}>
        <Text style={styles.title}>Graphite</Text>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.icon} style={styles.featureRow}>
              <MaterialCommunityIcons
                name={f.icon}
                size={24}
                color={tokens.accentLight}
              />
              <Text style={styles.featureText}>{f.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onComplete}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: pressed ? tokens.accentPressed : tokens.accent },
          ]}
        >
          <Text style={styles.buttonText}>GET STARTED</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: tokens.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  content: {
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: tokens.textPrimary,
    marginBottom: 48,
    letterSpacing: -0.5,
  },
  features: {
    width: '100%',
    marginBottom: 48,
    gap: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  featureText: {
    fontSize: 16,
    color: tokens.textBody,
  },
  button: {
    width: '100%',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
