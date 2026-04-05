import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { tokens } from '@graphite/ui';
import type { Folder } from '@graphite/db';

interface MoveNoteModalProps {
  visible: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCancel: () => void;
}

/**
 * Folder picker for "Move to folder...". Lists every folder in the note's
 * notebook plus a "(No folder)" option at the top. Tap a row to move.
 *
 * Presented as a centered sheet over a translucent backdrop. Sharp edges
 * (0px radius) and flat fills per the Digital Monolith design rules.
 */
export default function MoveNoteModal({
  visible,
  folders,
  currentFolderId,
  onSelect,
  onCancel,
}: MoveNoteModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: 320,
            maxHeight: 440,
            backgroundColor: tokens.bgSidebar,
            borderWidth: 1,
            borderColor: tokens.border,
          }}
        >
          {/* Header */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: tokens.border,
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
              MOVE TO FOLDER
            </Text>
          </View>

          {/* Folder list */}
          <ScrollView style={{ maxHeight: 340 }}>
            <FolderRow
              label="(No folder)"
              active={currentFolderId === null}
              onPress={() => onSelect(null)}
            />
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                label={f.name}
                active={currentFolderId === f.id}
                onPress={() => onSelect(f.id)}
              />
            ))}
          </ScrollView>

          {/* Cancel */}
          <Pressable
            onPress={onCancel}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: tokens.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 13, color: tokens.textBody }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FolderRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderLeftWidth: 2,
        borderLeftColor: active ? tokens.accent : 'transparent',
        backgroundColor: active ? tokens.bgHover : 'transparent',
      }}
    >
      <Text
        style={{
          fontSize: 14,
          color: active ? tokens.accentLight : tokens.textBody,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
