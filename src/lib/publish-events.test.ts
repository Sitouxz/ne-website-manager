import { describe, expect, it } from 'vitest';
import { statusChangeEvent } from './publish-events';

describe('statusChangeEvent', () => {
  it('announces a first publish', () => {
    expect(statusChangeEvent(false, true)).toBe('content.published');
  });

  it('announces an edit to already-live content as an update', () => {
    expect(statusChangeEvent(true, true)).toBe('content.updated');
  });

  it('announces a takedown as a deletion', () => {
    // From the website's point of view the content is gone, and a generated
    // `createRevalidateHandler` treats it exactly like a removal.
    expect(statusChangeEvent(true, false)).toBe('content.deleted');
  });

  it('says nothing when content was never live and still is not', () => {
    // The bug this function exists to prevent: archiving forty drafts fired
    // forty `content.deleted` events and rebuilt the client's site for a
    // change no visitor could see.
    expect(statusChangeEvent(false, false)).toBeNull();
  });
});
