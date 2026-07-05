import { describe, expect, it } from 'vitest';
import { computeLivePath } from './publish-client';

/**
 * Review finding (Phase 7 final review, Important): `notifyPublish`'s
 * payload used to carry a bare `slug` whose meaning differed by
 * `entityType` — the generated `createRevalidateHandler` then built a
 * revalidation path directly out of that ambiguous value, producing the
 * wrong path for posts/collection entries and a double slash for pages.
 * `computeLivePath` is the one place this codebase now computes the
 * canonical live path, mirroring `resolveEntity` in
 * `src/app/api/client/[slug]/preview/route.ts` exactly. These tests prove
 * each entity type's path is computed correctly, independent of the
 * `notifyPublish` payload plumbing (tested separately in `publish.test.ts`).
 */
describe('computeLivePath', () => {
  it('post -> /blog/{slug}', () => {
    expect(computeLivePath('post', { slug: 'hello-world' })).toBe('/blog/hello-world');
  });

  it('page -> the page\'s own `path`, returned verbatim (already absolute, never re-prefixed)', () => {
    expect(computeLivePath('page', { path: '/about' })).toBe('/about');
    expect(computeLivePath('page', { path: '/' })).toBe('/');
  });

  it('collection_entry -> /{collectionSlug}/{itemSlug}', () => {
    expect(computeLivePath('collection_entry', { slug: 'friday-sermon', collectionSlug: 'sermons' })).toBe(
      '/sermons/friday-sermon'
    );
  });

  it('site_globals -> null (no single canonical path)', () => {
    expect(computeLivePath('site_globals', { slug: 'footer' })).toBeNull();
  });

  it('menu_item -> null (no single canonical path)', () => {
    expect(computeLivePath('menu_item', { slug: 'Home' })).toBeNull();
  });

  it('an unrecognized entityType -> null (fails closed, not a thrown error)', () => {
    expect(computeLivePath('something_else', { slug: 'x' })).toBeNull();
  });

  it('post with no slug -> null rather than "/blog/undefined"', () => {
    expect(computeLivePath('post', {})).toBeNull();
  });

  it('collection_entry missing either half -> null rather than a malformed path', () => {
    expect(computeLivePath('collection_entry', { slug: 'friday-sermon' })).toBeNull();
    expect(computeLivePath('collection_entry', { collectionSlug: 'sermons' })).toBeNull();
  });
});
