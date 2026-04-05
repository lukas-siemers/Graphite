import { View, Text, Pressable, FlatList } from 'react-native';
import { tokens } from '@graphite/ui';
import { useTagStore } from '../../stores/use-tag-store';

export default function TagList() {
  const tags = useTagStore((s) => s.tags);
  const activeTag = useTagStore((s) => s.activeTag);
  const setActiveTag = useTagStore((s) => s.setActiveTag);

  if (tags.length === 0) return null;

  return (
    <View>
      {/* Section label */}
      <View
        style={{
          paddingLeft: 14,
          paddingRight: 8,
          paddingTop: 14,
          paddingBottom: 6,
        }}
      >
        <Text
          style={{
            fontSize: 10,
            fontWeight: '600',
            color: tokens.textHint,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
        >
          TAGS
        </Text>
      </View>

      {/* Tag list */}
      <FlatList
        data={tags}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderItem={({ item }) => {
          const isActive = activeTag === item.name;
          return (
            <Pressable
              onPress={() => setActiveTag(item.name)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 7,
                paddingLeft: isActive ? 12 : 14,
                paddingRight: 14,
                borderLeftWidth: isActive ? 2 : 0,
                borderLeftColor: tokens.accent,
                backgroundColor: isActive ? tokens.accentTint : 'transparent',
              }}
            >
              <Text
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: isActive ? tokens.accentLight : tokens.textMuted,
                  fontWeight: isActive ? '600' : '400',
                }}
                numberOfLines={1}
              >
                # {item.name}
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  color: tokens.textHint,
                  fontWeight: '500',
                  minWidth: 16,
                  textAlign: 'right',
                }}
              >
                {item.count}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
