import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure each test starts from a clean DOM — without this, components
// rendered by one test would leak into the next.
afterEach(() => {
  cleanup();
});
