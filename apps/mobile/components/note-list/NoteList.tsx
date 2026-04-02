import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
} from 'react-native';
import { tokens } from '@graphite/ui';
import { getDatabase, searchNotes } from '@graphite/db';
import type { Note } from '@graphite/db';
import { useNoteStore } from '../../stores/use-note-store';
import { useNotebookStore } from '../../stores/use-notebook-store';

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s/gm, '')
    .replace(/\*+/g, '')
    .replace(/`/g, '')
    .trim();
}

function formatTimestamp(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  const oneMinute = 60 * 1000;
  const oneHour = 60 * oneMinute;
  const oneDay = 24 * oneHour;

  if (diff < oneHour) {
    const mins = Math.max(1, Math.floor(diff / oneMinute));
    return `${mins} min ago`;
  }
  if (diff < oneDay) {
    const hours = Math.floor(diff / oneHour);
    return `${hours}h ago`;
  }
  if (diff < 2 * oneDay) {
    return 'Yesterday';
  }
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface NoteCardProps {
  note: Note;
  isActive: boolean;
  onPress: () => void;
}

function NoteCard({ note, isActive, onPress }: NoteCardProps) {
  const preview = stripMarkdown(note.body);
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderLeftWidth: 2,
        borderLeftColor: isActive ? tokens.accent : 'transparent',
        backgroundColor: isActive ? tokens.bgActive : 'transparent',
        paddingLeft: 14,
        paddingRight: 16,
        paddingVertical: 12,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: '600',
          color: tokens.textPrimary,
        }}
        numberOfLines={1}
      >
        {note.title || 'Untitled'}
      </Text>
      {preview.length > 0 && (
        <Text
          style={{
            fontSize: 12,
            color: tokens.textMuted,
            marginTop: 2,
          }}
          numberOfLines={2}
        >
          {preview}
        </Text>
      )}
      <Text
        style={{
          fontSize: 11,
          color: tokens.textHint,
          marginTop: 4,
        }}
      >
        {formatTimestamp(note.updatedAt)}
      </Text>
    </Pressable>
  );
}

export default function NoteList() {
  const notes = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const activeNotebookId = useNotebookStore((s) => s.activeNotebookId);

  const [displayedNotes, setDisplayedNotes] = useState<Note[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shownNotes = displayedNotes ?? notes;

  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!text.trim()) {
          setDisplayedNotes(null);
          return;
        }
        if (!activeNotebookId) return;
        try {
          const db = getDatabase();
          const results = await searchNotes(db, activeNotebookId, text.trim());
          setDisplayedNotes(results);
        } catch (_) {
          // fallback to local filter
          const lower = text.toLowerCase();
          setDisplayedNotes(
            notes.filter(
              (n) =>
                n.title.toLowerCase().includes(lower) ||
                n.body.toLowerCase().includes(lower),
            ),
          );
        }
      }, 300);
    },
    [activeNotebookId, notes],
  );

  function handleNotePress(noteId: string) {
    setActiveNote(noteId);
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: '600',
            color: tokens.textMuted,
            letterSpacing: 1,
          }}
        >
          NOTES
        </Text>
        <Text style={{ fontSize: 11, color: tokens.textHint }}>
          {shownNotes.length}
        </Text>
      </View>

      {/* Search bar */}
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <TextInput
          value={searchQuery}
          onChangeText={handleSearch}
          placeholder="Search..."
          placeholderTextColor={tokens.textHint}
          style={{
            backgroundColor: tokens.bgHover,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 2,
            fontSize: 14,
            color: tokens.textBody,
          }}
        />
      </View>

      {/* Note list */}
      <FlatList
        data={shownNotes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            isActive={item.id === activeNoteId}
            onPress={() => handleNotePress(item.id)}
          />
        )}
        ItemSeparatorComponent={null}
        style={{ flex: 1 }}
      />
    </View>
  );
}
