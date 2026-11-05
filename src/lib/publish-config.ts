/**
 * Is a client's publishing actually wired up?
 *
 * One definition, because there are now three screens asking the question —
 * the dashboard's "Publishing isn't connected yet" alert, the admin table's
 * Configured/Not set badge, and the settings screen — and they had already
 * drifted once: the admin badge checked `deploy_hook` alone and reported a
 * revalidate-only client as unconfigured while the dashboard said it was fine.
 *
 * Either mechanism alone is enough. They do different things (a deploy hook
 * rebuilds the site, a revalidate URL invalidates specific paths) but the
 * question this answers is only "will publishing here reach the website at
 * all", and either one means yes.
 *
 * Whitespace-only counts as absent: an empty-looking input the operator
 * tabbed through is not a configured endpoint, and treating it as one would
 * silence the very alert meant to catch it.
 */

export interface PublishConfigLike {
  deploy_hook?: string | null;
  revalidate_url?: string | null;
}

export function isPublishingConnected(config: PublishConfigLike | null | undefined): boolean {
  if (!config) return false;
  return !!(config.deploy_hook?.trim() || config.revalidate_url?.trim());
}
