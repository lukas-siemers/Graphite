// Web stub for expo-sqlite.
// Returns a no-op database so initDatabase() completes without crashing.
// All queries return empty results — web build shows the UI but has no persisted data.
const noopDb = {
  execAsync: async () => {},
  runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
  getFirstAsync: async () => null,
  getAllAsync: async () => [],
  prepareAsync: async () => ({
    executeAsync: async () => ({ lastInsertRowId: 0, changes: 0, getAllAsync: async () => [], getFirstAsync: async () => null }),
    finalizeAsync: async () => {},
  }),
  closeAsync: async () => {},
  withTransactionAsync: async (fn) => fn(),
};

module.exports = {
  openDatabaseAsync: async () => noopDb,
  openDatabaseSync: () => noopDb,
  SQLiteDatabase: function () { return noopDb; },
};
