import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { tokens } from '@graphite/ui';

interface LoginScreenProps {
  onAuth: (email: string, password: string, mode: 'signin' | 'signup') => Promise<void>;
  onSkip: () => void;
}

export default function LoginScreen({ onAuth, onSkip }: LoginScreenProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onAuth(email.trim(), password, mode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: tokens.bgBase }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 32,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / wordmark */}
        <Text
          style={{
            fontSize: 28,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: -0.5,
            marginBottom: 8,
          }}
        >
          Graphite
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: tokens.textMuted,
            marginBottom: 40,
          }}
        >
          {mode === 'signin' ? 'Sign in to sync your notes' : 'Create your account'}
        </Text>

        {/* Email input */}
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={tokens.textHint}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            width: '100%',
            maxWidth: 340,
            height: 44,
            backgroundColor: tokens.bgSidebar,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 0,
            paddingHorizontal: 12,
            color: tokens.textBody,
            fontSize: 14,
            marginBottom: 12,
          }}
        />

        {/* Password input */}
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={tokens.textHint}
          secureTextEntry
          style={{
            width: '100%',
            maxWidth: 340,
            height: 44,
            backgroundColor: tokens.bgSidebar,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 0,
            paddingHorizontal: 12,
            color: tokens.textBody,
            fontSize: 14,
            marginBottom: 20,
          }}
        />

        {/* Error message */}
        {error && (
          <Text
            style={{
              color: '#FF4444',
              fontSize: 13,
              marginBottom: 16,
              maxWidth: 340,
              width: '100%',
            }}
          >
            {error}
          </Text>
        )}

        {/* Submit button */}
        <Pressable
          onPress={handleSubmit}
          disabled={loading}
          style={({ pressed }) => ({
            width: '100%',
            maxWidth: 340,
            height: 44,
            backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
            borderRadius: 0,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: loading ? 0.6 : 1,
            marginBottom: 16,
          })}
        >
          {loading ? (
            <ActivityIndicator color={tokens.bgBase} />
          ) : (
            <Text style={{ fontSize: 14, fontWeight: '600', color: tokens.bgBase }}>
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </Text>
          )}
        </Pressable>

        {/* Toggle signin/signup */}
        <Pressable
          onPress={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          <Text style={{ fontSize: 13, color: tokens.textMuted }}>
            {mode === 'signin'
              ? "Don't have an account? "
              : 'Already have an account? '}
            <Text style={{ color: tokens.accent, fontWeight: '600' }}>
              {mode === 'signin' ? 'Sign Up' : 'Sign In'}
            </Text>
          </Text>
        </Pressable>

        {/* Skip / continue offline */}
        <Pressable onPress={onSkip} style={{ marginTop: 32 }}>
          <Text style={{ fontSize: 13, color: tokens.textHint }}>
            Continue without account
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
