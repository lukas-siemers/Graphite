import { View, Text, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';

export default function MainScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Graphite</Text>
      <Text style={styles.subtitle}>Phase 1 coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: tokens.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: tokens.textMuted,
    marginTop: 8,
  },
});
