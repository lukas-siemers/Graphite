import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { tokens } from '@graphite/ui';
import { getDatabase } from '@graphite/db';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';

type SaveStatus = 'Saved' | 'Saving...';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface EditorProps {
  onToggleDrawing?: () => void;
  drawingOpen?: boolean;
}

/** Design-token styles passed to react-native-markdown-display */
const markdownStyles = {
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: tokens.textBody,
    backgroundColor: tokens.bgBase,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  heading1: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: tokens.textPrimary,
    marginTop: 20,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: tokens.textPrimary,
    marginTop: 16,
    marginBottom: 6,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: tokens.textPrimary,
    marginTop: 12,
    marginBottom: 4,
  },
  paragraph: {
    color: tokens.textBody,
    marginTop: 0,
    marginBottom: 12,
  },
  strong: {
    color: tokens.textPrimary,
    fontWeight: '700' as const,
  },
  em: {
    color: tokens.textBody,
    fontStyle: 'italic' as const,
  },
  link: {
    color: tokens.accent,
    textDecorationLine: 'underline' as const,
  },
  blockquote: {
    backgroundColor: tokens.bgSidebar,
    borderLeftWidth: 3,
    borderLeftColor: tokens.accent,
    paddingLeft: 12,
    marginVertical: 8,
  },
  code_inline: {
    fontFamily: 'Courier',
    fontSize: 14,
    color: tokens.accentLight,
    backgroundColor: tokens.bgDeep,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  fence: {
    backgroundColor: tokens.bgDeep,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 0,
    padding: 16,
    marginVertical: 12,
  },
  code_block: {
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 20,
    color: tokens.accentLight,
    backgroundColor: tokens.bgDeep,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    color: tokens.textBody,
    marginBottom: 4,
  },
  hr: {
    backgroundColor: tokens.border,
    height: 1,
    marginVertical: 16,
  },
};

/**
 * Custom rule for fenced code blocks — adds a language label in textHint
 * above the code content.
 */
function buildMarkdownRules() {
  return {
    fence: (
      node: any,
      children: any,
      _parent: any,
      styles: any,
    ) => {
      const lang: string = node.sourceInfo ? node.sourceInfo.trim() : '';
      return (
        <View key={node.key} style={styles.fence}>
          {lang.length > 0 && (
            <Text
              style={{
                fontFamily: 'Courier',
                fontSize: 10,
                color: tokens.textHint,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              {lang}
            </Text>
          )}
          <Text style={styles.code_block}>
            {node.content}
          </Text>
        </View>
      );
    },
  };
}

export default function Editor({ onToggleDrawing: _onToggleDrawing, drawingOpen: _drawingOpen }: EditorProps) {
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const saveNote = useNoteStore((s) => s.saveNote);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);
  const folders = useFolderStore((s) => s.folders);
  const activeFolderId = useFolderStore((s) => s.activeFolderId);

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  const [localTitle, setLocalTitle] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('Saved');
  const [previewMode, setPreviewMode] = useState(false);

  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when active note changes; exit preview when switching notes
  useEffect(() => {
    if (activeNote) {
      setLocalTitle(activeNote.title);
      setLocalBody(activeNote.body);
      setSaveStatus('Saved');
      setPreviewMode(false);
    }
  }, [activeNoteId]);

  const persistSave = useCallback(
    async (patch: { title?: string; body?: string }) => {
      if (!activeNoteId) return;
      setSaveStatus('Saving...');
      try {
        const db = getDatabase();
        await saveNote(db, activeNoteId, patch);
        setSaveStatus('Saved');
      } catch (_) {
        setSaveStatus('Saved');
      }
    },
    [activeNoteId, saveNote],
  );

  function handleTitleChange(text: string) {
    setLocalTitle(text);
    setSaveStatus('Saving...');
    if (titleDebounce.current) clearTimeout(titleDebounce.current);
    titleDebounce.current = setTimeout(() => {
      persistSave({ title: text });
    }, 500);
  }

  function handleBodyChange(text: string) {
    setLocalBody(text);
    setSaveStatus('Saving...');
    if (bodyDebounce.current) clearTimeout(bodyDebounce.current);
    bodyDebounce.current = setTimeout(() => {
      persistSave({ body: text });
    }, 500);
  }

  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId);
  const activeFolder = folders.find((f) => f.id === activeFolderId);

  const breadcrumb = [activeNotebook?.name, activeFolder?.name]
    .filter(Boolean)
    .join(' \u203A ');

  const wordCount = countWords(localBody);
  const markdownRules = buildMarkdownRules();

  if (!activeNote) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 14, color: tokens.textHint }}>
          Select a note
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      {/* Title area */}
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 20,
          paddingBottom: 4,
        }}
      >
        <TextInput
          value={localTitle}
          onChangeText={handleTitleChange}
          placeholder="Untitled"
          placeholderTextColor={tokens.textHint}
          editable={!previewMode}
          style={{
            fontSize: 28,
            fontWeight: '700',
            color: tokens.textPrimary,
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
          }}
        />
      </View>

      {/* Breadcrumb */}
      {breadcrumb.length > 0 && (
        <View style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
          <Text style={{ fontSize: 12, color: tokens.textMuted }}>
            {breadcrumb}
          </Text>
        </View>
      )}

      {/* Content area — edit or preview */}
      {previewMode ? (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Markdown style={markdownStyles} rules={markdownRules}>
            {localBody.length > 0 ? localBody : ' '}
          </Markdown>
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={localBody}
            onChangeText={handleBodyChange}
            multiline
            placeholder="Start writing..."
            placeholderTextColor={tokens.textHint}
            style={{
              fontSize: 16,
              lineHeight: 24,
              color: tokens.textBody,
              backgroundColor: tokens.bgBase,
              padding: 24,
              minHeight: 300,
              textAlignVertical: 'top',
            }}
          />
        </ScrollView>
      )}

      {/* Status bar */}
      <View
        style={{
          flexDirection: 'row',
          height: 32,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontSize: 11,
            color: tokens.textHint,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {wordCount} WORDS \u00B7 {saveStatus.toUpperCase()}
        </Text>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          {/* Preview toggle */}
          <Pressable onPress={() => setPreviewMode((v) => !v)}>
            <Text
              style={{
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: previewMode ? tokens.accent : tokens.textHint,
                fontWeight: previewMode ? '700' : '400',
              }}
            >
              {previewMode ? 'EDITING' : 'PREVIEW'}
            </Text>
          </Pressable>
          <Text
            style={{
              fontSize: 11,
              color: tokens.textHint,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            MARKDOWN GUIDE
          </Text>
          <Text
            style={{
              fontSize: 11,
              color: tokens.textHint,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            SUPPORT
          </Text>
        </View>
      </View>
    </View>
  );
}
