import type { PublishEvent } from '@/lib/publish';

/**
 * Which publish event, if any, a status change should announce to the client's
 * website.
 *
 * This existed inline in three bulk-action handlers and was wrong in all three
 * the same way: every takedown fired `content.deleted`, whether or not the
 * content had ever been live. Moving forty drafts to draft, or archiving forty
 * drafts, rebuilt the client's site forty times over a change no visitor could
 * see. The single-item editors got it right; the bulk paths were written later
 * and each re-derived the rule slightly wrong.
 *
 * The rule, stated once:
 *
 *  - Becoming live → `content.published`, or `content.updated` if it already
 *    was (an edit to live content, not a new arrival).
 *  - Leaving live → `content.deleted`. From the website's point of view the
 *    content is gone; a generated `createRevalidateHandler` treats it exactly
 *    like a removal.
 *  - Never live, still not live → `null`. Nothing to say.
 *
 * "Live" is passed in rather than inferred, because it differs per table:
 * a post is live at `status === 'published'`, a page must also be
 * `visibility === 'public'`, and `properties` calls the state `active`.
 */
export function statusChangeEvent(wasLive: boolean, willBeLive: boolean): PublishEvent | null {
  if (willBeLive) return wasLive ? 'content.updated' : 'content.published';
  return wasLive ? 'content.deleted' : null;
}
