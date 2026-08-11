import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import * as aesjs from "aes-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// Expo SecureStore caps individual values at ~2048 bytes, and a full
// Supabase session (access token + refresh token + user metadata) routinely
// exceeds that. So the session itself lives in AsyncStorage (unbounded, but
// unencrypted at rest), encrypted with an AES-256 key that's small enough
// to fit in SecureStore (Keychain/Keystore-backed) -- the key is what's
// actually protected, and without it the AsyncStorage blob is opaque.
class LargeSecureStore {
  private async getEncryptionKey(): Promise<Uint8Array> {
    const existing = await SecureStore.getItemAsync("supabase-encryption-key");
    const key: string = existing ?? aesjs.utils.hex.fromBytes(crypto.getRandomValues(new Uint8Array(32)));
    if (!existing) {
      await SecureStore.setItemAsync("supabase-encryption-key", key);
    }
    return aesjs.utils.hex.toBytes(key);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    const encryptionKey = await this.getEncryptionKey();
    // aes-js's real export is ModeOfOperation.ctr, not a top-level
    // ModeOfOperationCTR -- the latter is undefined, so calling `new` on it
    // throws "undefined cannot be used as a constructor" (confirmed the hard
    // way: every real sign-in failed here, invisible to Stage 1's Jest tests
    // because they mock this whole module at the boundary).
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey);
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(encrypted));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async setItem(key: string, value: string) {
    const encryptionKey = await this.getEncryptionKey();
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey);
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await AsyncStorage.setItem(key, aesjs.utils.hex.fromBytes(encryptedBytes));
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example).");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE (not the default 'implicit' flow) is what lets signInWithOAuth's
    // redirect be exchanged for a session via exchangeCodeForSession() --
    // see lib/AuthProvider.tsx's signInWithGoogle().
    flowType: "pkce",
  },
});
