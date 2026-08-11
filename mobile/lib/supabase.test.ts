import { describe, it, expect, jest, beforeAll } from "@jest/globals";

// Every other test in this repo mocks this whole module (jest.mock("../lib/supabase")),
// which means LargeSecureStore's real body -- including its calls into aes-js -- never
// actually executes anywhere in Stage 1. That's exactly how a real bug shipped
// invisibly: LargeSecureStore called `new aesjs.ModeOfOperationCTR(...)`, a
// constructor that doesn't exist on the real aes-js export (the real one is
// `aesjs.ModeOfOperation.ctr`), and every real sign-in threw "undefined cannot be
// used as a constructor" the moment a session was first persisted -- caught only
// by a real Stage 2 (Detox, real emulator) run, and even then only by extracting a
// frame from the failure video, since the error never showed up in a log.
//
// This test deliberately does NOT mock aes-js, @react-native-async-storage/async-
// storage's actual encryption math, or expo-secure-store's actual key handling --
// only the true external boundaries (AsyncStorage/SecureStore's storage backends,
// and supabase-js's createClient, so this stays a fast, offline unit test). That
// leaves LargeSecureStore's real encrypt/decrypt round trip -- and therefore its
// real usage of aes-js's actual API -- genuinely exercised, so a call into a
// nonexistent method on a real dependency fails Stage 1 immediately instead of
// waiting for a real device in Stage 2 to find it.
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const mockCreateClient = jest.fn();
jest.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe("LargeSecureStore (lib/supabase.ts's session storage adapter)", () => {
  let storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

  beforeAll(() => {
    // lib/supabase.ts throws at import time without these -- every other test
    // avoids that by mocking the module away entirely (see this file's header
    // comment on why that's exactly the gap this test exists to close).
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    require("./supabase");
    const options = (mockCreateClient.mock.calls[0] as unknown[])[2] as { auth: { storage: typeof storage } };
    storage = options.auth.storage;
  });

  it("round-trips a value through real encrypt/decrypt without throwing", async () => {
    const AsyncStorage = require("@react-native-async-storage/async-storage");
    const SecureStore = require("expo-secure-store");

    let persistedEncryptionKey: string | null = null;
    let persistedBlob: string | null = null;
    (SecureStore.getItemAsync as jest.Mock<any>).mockImplementation(async () => persistedEncryptionKey);
    (SecureStore.setItemAsync as jest.Mock<any>).mockImplementation(async (_key: string, value: string) => {
      persistedEncryptionKey = value;
    });
    (AsyncStorage.getItem as jest.Mock<any>).mockImplementation(async () => persistedBlob);
    (AsyncStorage.setItem as jest.Mock<any>).mockImplementation(async (_key: string, value: string) => {
      persistedBlob = value;
    });

    const session = JSON.stringify({ access_token: "a.b.c", refresh_token: "d.e.f" });

    // This is the exact call that used to throw "undefined cannot be used as
    // a constructor" on every real first-ever sign-in.
    await storage.setItem("supabase-session", session);
    expect(persistedBlob).toEqual(expect.any(String));

    const readBack = await storage.getItem("supabase-session");
    expect(readBack).toBe(session);
  });
});
