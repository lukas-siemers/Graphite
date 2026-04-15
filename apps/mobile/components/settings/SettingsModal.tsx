import { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import {
  useFontStore,
  APP_FONT_OPTIONS,
  type AppFontKey,
} from '../../stores/use-font-store';

type SectionKey =
  | 'profile'
  | 'appearance'
  | 'storage'
  | 'sync'
  | 'about'
  | 'account';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SettingsModal({ visible, onClose }: SettingsModalProps) {
  const [section, setSection] = useState<SectionKey>('appearance');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: 760,
            maxWidth: '92%',
            height: 560,
            maxHeight: '92%',
            backgroundColor: tokens.bgSidebar,
            flexDirection: 'column',
          }}
        >
          {/* Build 123: X close button absolute-positioned in the panel's
              top-right corner. Taps close the modal without saving anything
              explicit — font changes auto-persist as the user picks them. */}
          <Pressable
            onPress={onClose}
            accessibilityLabel="Close settings"
            style={({ pressed }) => ({
              position: 'absolute',
              top: 8,
              right: 8,
              width: 30,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? tokens.bgHover : 'transparent',
              zIndex: 10,
            })}
          >
            <MaterialCommunityIcons
              name="close"
              size={18}
              color={tokens.textMuted}
            />
          </Pressable>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <SectionRail section={section} onSelect={setSection} />
            <SectionBody section={section} onClose={onClose} />
          </View>
          {/* Build 123: footer with a Save & Close action. Font / section
              selections already auto-persist (font to SQLite, sections are
              view-state only), so this button is semantically "Done" — it
              just confirms the user's choice and dismisses the modal. */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              paddingVertical: 12,
              paddingHorizontal: 16,
              gap: 8,
              backgroundColor: tokens.bgBase,
            }}
          >
            <Pressable
              onPress={onClose}
              accessibilityLabel="Cancel"
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: pressed ? tokens.bgHover : 'transparent',
                borderWidth: 1,
                borderColor: tokens.border,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: tokens.textBody,
                  fontWeight: '500',
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Save and close"
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: '#FFFFFF',
                  fontWeight: '600',
                }}
              >
                Save & Close
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionRail({
  section,
  onSelect,
}: {
  section: SectionKey;
  onSelect: (s: SectionKey) => void;
}) {
  const items: Array<{ key: SectionKey; label: string; icon: string }> = [
    { key: 'profile', label: 'Profile', icon: 'account-circle-outline' },
    { key: 'appearance', label: 'Appearance', icon: 'palette-outline' },
    { key: 'storage', label: 'Storage', icon: 'database-outline' },
    { key: 'sync', label: 'Sync', icon: 'cloud-sync-outline' },
    { key: 'about', label: 'About', icon: 'information-outline' },
    { key: 'account', label: 'Account', icon: 'logout' },
  ];
  return (
    <View
      style={{
        width: 180,
        paddingVertical: 16,
        paddingHorizontal: 8,
        backgroundColor: tokens.bgBase,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          color: tokens.textMuted,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          paddingHorizontal: 10,
          marginBottom: 10,
        }}
      >
        Settings
      </Text>
      {items.map((item) => {
        const active = section === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: active
                ? tokens.accentTint
                : pressed
                ? tokens.bgHover
                : 'transparent',
              borderLeftWidth: active ? 2 : 0,
              borderLeftColor: tokens.accent,
            })}
          >
            <MaterialCommunityIcons
              name={item.icon as any}
              size={16}
              color={active ? tokens.accent : tokens.textMuted}
            />
            <Text
              style={{
                fontSize: 13,
                color: active ? tokens.accentLight : tokens.textBody,
                fontWeight: active ? '600' : '500',
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionBody({
  section,
  onClose,
}: {
  section: SectionKey;
  onClose: () => void;
}) {
  return (
    <View style={{ flex: 1, padding: 24 }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {section === 'profile' && <ProfileSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'storage' && <StorageSection />}
        {section === 'sync' && <SyncSection />}
        {section === 'about' && <AboutSection />}
        {section === 'account' && <AccountSection onClose={onClose} />}
      </ScrollView>
    </View>
  );
}

function SectionHeading({ text }: { text: string }) {
  return (
    <Text
      style={{
        fontSize: 18,
        fontWeight: '700',
        color: tokens.textPrimary,
        marginBottom: 4,
      }}
    >
      {text}
    </Text>
  );
}

function SectionSubtitle({ text }: { text: string }) {
  return (
    <Text
      style={{
        fontSize: 12,
        color: tokens.textMuted,
        marginBottom: 20,
      }}
    >
      {text}
    </Text>
  );
}

function ProfileSection() {
  return (
    <View>
      <SectionHeading text="Profile" />
      <SectionSubtitle text="Your Graphite account identity." />
      <ComingSoon note="Display-name + avatar editing lands in Build 122." />
    </View>
  );
}

function AppearanceSection() {
  const font = useFontStore((s) => s.font);
  const setFont = useFontStore((s) => s.setFont);
  return (
    <View>
      <SectionHeading text="Appearance" />
      <SectionSubtitle text="Choose a font family for the app interface." />
      <View style={{ gap: 6 }}>
        {APP_FONT_OPTIONS.map((opt) => {
          const selected = opt.key === font;
          return (
            <Pressable
              key={opt.key}
              onPress={() => void setFont(opt.key as AppFontKey)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
                paddingHorizontal: 14,
                backgroundColor: selected
                  ? tokens.accentTint
                  : pressed
                  ? tokens.bgHover
                  : tokens.bgBase,
                borderLeftWidth: selected ? 2 : 0,
                borderLeftColor: tokens.accent,
              })}
            >
              <View>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: selected ? tokens.accentLight : tokens.textPrimary,
                    fontFamily: opt.bold ?? undefined,
                  }}
                >
                  {opt.label}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: tokens.textMuted,
                    marginTop: 2,
                    fontFamily: opt.regular ?? undefined,
                  }}
                >
                  {opt.description} — The quick brown fox jumps over the lazy dog.
                </Text>
              </View>
              {selected && (
                <MaterialCommunityIcons
                  name="check"
                  size={18}
                  color={tokens.accent}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StorageSection() {
  return (
    <View>
      <SectionHeading text="Storage" />
      <SectionSubtitle text="Local database and cached assets." />
      <ComingSoon note="Per-notebook size breakdown + Delete All Data (with Supabase cascade) lands in Build 122." />
    </View>
  );
}

function SyncSection() {
  return (
    <View>
      <SectionHeading text="Sync" />
      <SectionSubtitle text="Cross-device sync and subscription." />
      <ComingSoon note="Last-synced timestamp + force re-sync + manage subscription lands in Build 122." />
    </View>
  );
}

function AboutSection() {
  const version =
    (Constants.expoConfig?.version as string | undefined) ?? 'unknown';
  const build =
    ((Constants.expoConfig?.ios as { buildNumber?: string } | undefined)
      ?.buildNumber as string | undefined) ?? 'unknown';
  return (
    <View>
      <SectionHeading text="About" />
      <SectionSubtitle text="Version info and credits." />
      <InfoRow label="Version" value={version} />
      <InfoRow label="Build" value={build} />
      <InfoRow label="Platform" value="iOS / iPad" />
      <View style={{ height: 16 }} />
      <Text style={{ fontSize: 11, color: tokens.textHint, lineHeight: 16 }}>
        Graphite is a cross-platform markdown note-taking app built for Apple
        Pencil on iPad. Feedback: lukas.siemers123@gmail.com.
      </Text>
    </View>
  );
}

function AccountSection({ onClose }: { onClose: () => void }) {
  async function confirmLogout() {
    Alert.alert(
      'Log out of Graphite?',
      'Your local notes stay on this device. Sync will pause until you log back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              const { getSupabaseClient } = await import('@graphite/sync');
              await getSupabaseClient().auth.signOut();
            } catch {
              // ignore — AuthGate will redirect on session change anyway
            }
            onClose();
          },
        },
      ],
    );
  }
  return (
    <View>
      <SectionHeading text="Account" />
      <SectionSubtitle text="Sign out of your Graphite account." />
      <Pressable
        onPress={confirmLogout}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          paddingVertical: 10,
          paddingHorizontal: 16,
          backgroundColor: pressed ? tokens.bgHover : tokens.bgBase,
          borderWidth: 1,
          borderColor: tokens.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        })}
      >
        <MaterialCommunityIcons name="logout" size={14} color={tokens.textBody} />
        <Text
          style={{
            fontSize: 13,
            fontWeight: '600',
            color: tokens.textBody,
          }}
        >
          Log out
        </Text>
      </Pressable>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: tokens.border,
      }}
    >
      <Text style={{ fontSize: 12, color: tokens.textMuted, width: 100 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 12, color: tokens.textBody, fontWeight: '500' }}>
        {value}
      </Text>
    </View>
  );
}

function ComingSoon({ note }: { note: string }) {
  return (
    <View
      style={{
        padding: 14,
        backgroundColor: tokens.bgBase,
        borderLeftWidth: 2,
        borderLeftColor: tokens.accent,
      }}
    >
      <Text style={{ fontSize: 12, color: tokens.textMuted, lineHeight: 18 }}>
        {note}
      </Text>
    </View>
  );
}
