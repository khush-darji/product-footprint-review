/**
 * Per-suite lifecycle: one connection for the file, a clean database before each test.
 *
 * Truncating before each test rather than after means a failing test leaves its rows
 * behind for inspection, and a suite that crashes cannot poison the next one.
 */
import { connect, disconnect, truncateAll } from "./test-db";

beforeAll(async () => {
  await connect();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  // Without this the pool keeps the event loop alive and Jest hangs after passing.
  await disconnect();
});
