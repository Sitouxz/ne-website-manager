/**
 * Web-address helpers shared by the post and page editors.
 *
 * Both editors let a user type the address their content will live at. Before
 * this module the page editor's field was raw free text: typing `About Us`
 * saved `About Us` verbatim, which then travelled all the way into the publish
 * webhook's `path` (see `computeLivePath` in `lib/publish-client.ts`) and
 * revalidated an address that doesn't exist on the client's site. Nothing in
 * the UI ever said the value was wrong.
 *
 * Normalising on blur — not on every keystroke, which fights the caret — turns
 * that class of mistake into something the user simply cannot make.
 */

/**
 * Converts free text into a URL-safe slug: lowercase, alphanumerics, single
 * hyphens, no leading or trailing hyphen. `"Ramadan Timings 2026!"` ->
 * `"ramadan-timings-2026"`.
 *
 * Matches the inline `slugify` both editors already used, extracted so the two
 * can't drift apart.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalises a page path to the shape the rest of the system assumes: exactly
 * one leading slash, lowercase, hyphen-separated, no trailing slash.
 *
 *   `"About Us"`      -> `"/about-us"`
 *   `"/Our Team/"`    -> `"/our-team"`
 *   `"blog/my post"`  -> `"/blog/my-post"`
 *   `""`              -> `"/"`   (the homepage, not an empty address)
 *
 * Multi-segment paths are preserved — each segment is slugified
 * independently — because a client site legitimately has `/services/branding`.
 */
export function normalizePath(input: string): string {
  const segments = input
    .split('/')
    .map((segment) => slugify(segment))
    .filter((segment) => segment.length > 0);

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}
