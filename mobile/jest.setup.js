const mockAsyncStorage = new Map();

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key) => Promise.resolve(mockAsyncStorage.get(key) ?? null)),
    setItem: jest.fn((key, value) => {
      mockAsyncStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key) => {
      mockAsyncStorage.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      mockAsyncStorage.clear();
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Array.from(mockAsyncStorage.keys()))),
    multiRemove: jest.fn((keys = []) => {
      keys.forEach((key) => mockAsyncStorage.delete(key));
      return Promise.resolve();
    }),
  },
}));

const mockSqliteDb = {
  execAsync: jest.fn(() => Promise.resolve()),
  runAsync: jest.fn(() => Promise.resolve({ changes: 1, lastInsertRowId: 1 })),
  getFirstAsync: jest.fn(() => Promise.resolve(null)),
  getAllAsync: jest.fn(() => Promise.resolve([])),
  withTransactionAsync: jest.fn((callback) => callback()),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => Promise.resolve(mockSqliteDb)),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));
