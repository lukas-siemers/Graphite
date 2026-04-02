import { View, Text, StyleSheet } from 'react-native';

interface EditorProps {
  noteId: string;
  initialContent?: string;
  onChange?: (content: string) => void;
}

/**
 * Markdown editor component.
 * Phase 1: CodeMirror 6 integration via WebView.
 * This is a placeholder until the WebView + CodeMirror bundle is wired up.
 */
export function Editor({ noteId, initialContent = '' }: EditorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>
        Editor for note {noteId} — CodeMirror integration coming in Phase 1
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    padding: 16,
  },
  placeholder: {
    color: '#555558',
    fontSize: 14,
  },
});
