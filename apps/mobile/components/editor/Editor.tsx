import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
} from 'react-native';
import { tokens } from '@graphite/ui';
import { getDatabase } from '@graphite/db';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';
import { useFolderStore } from '../../stores/use-folder-store';

type SaveStatus = 'Saved' | 'Saving...';

const TOOLBAR_BUTTONS = ['B', 'I', 'H1', '<>', 'Link', '\u270F'] as const;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface EditorProps {
  /** Called when the pencil toolbar button is pressed. When provided the
   *  parent is responsible for toggling the drawing canvas; the editor's own
   *  `isDrawing` state is ignored for that button. */
  onToggleDrawing?: () => void;
  /** Mirrors the drawing-open state from the parent so the toolbar button
   *  can show the active style correctly. */
  drawingOpen?: boolean;
}

export default function Editor({ onToggleDrawing, drawingOpen = false }: EditorProps) {
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
  const [isDrawing, setIsDrawing] = useState(false);

  const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when active note changes
  useEffect(() => {
    if (activeNote) {
      setLocalTitle(activeNote.title);
      setLocalBody(activeNote.body);
      setSaveStatus('Saved');
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
    .join(' / ');

  const wordCount = countWords(localBody);

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

      {/* Toolbar */}
      <View
        style={{
          flexDirection: 'row',
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: tokens.border,
          paddingHorizontal: 8,
          paddingVertical: 4,
          alignItems: 'center',
        }}
      >
        {TOOLBAR_BUTTONS.map((btn) => {
          const isDrawBtn = btn === '\u270F';
          return (
            <ToolbarButton
              key={btn}
              label={btn}
              onPress={
                isDrawBtn
                  ? () => {
                      if (onToggleDrawing) {
                        onToggleDrawing();
                      } else {
                        setIsDrawing((v) => !v);
                      }
                    }
                  : undefined
              }
              active={isDrawBtn && (onToggleDrawing ? drawingOpen : isDrawing)}
            />
          );
        })}
      </View>

      {/* Content area */}
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

      {/* Status bar */}
      <View
        style={{
          flexDirection: 'row',
          height: 32,
          paddingHorizontal: 16,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ fontSize: 11, color: tokens.textMuted }}>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </Text>
        <Text style={{ fontSize: 11, color: tokens.textHint }}>{saveStatus}</Text>
      </View>
    </View>
  );
}

interface ToolbarButtonProps {
  label: string;
  onPress?: () => void;
  active?: boolean;
}

function ToolbarButton({ label, onPress, active }: ToolbarButtonProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        minWidth: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 4,
        backgroundColor:
          active || pressed ? tokens.bgBright : tokens.bgHover,
        borderRadius: 0,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: '600',
          color: active ? tokens.accent : tokens.textBody,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
