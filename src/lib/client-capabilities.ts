import type { Client, ClientCapabilities } from '@/lib/supabase/types';

export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  posts: true,
  pages: true,
  properties: false,
  media: true,
  collections: true,
  navigation: true,
  forms: true,
  announcements: true,
  analytics: true,
  social: true,
  seo: true,
  team: true,
};

const LEGACY_SLUG_OVERRIDES: Record<string, Partial<ClientCapabilities>> = {
  'kamal-karim': {
    posts: false,
    pages: false,
    properties: true,
    media: true,
    collections: false,
    navigation: false,
  },
};

export function getClientCapabilities(client: Client | null | undefined): ClientCapabilities {
  return {
    ...DEFAULT_CLIENT_CAPABILITIES,
    ...(client?.slug ? LEGACY_SLUG_OVERRIDES[client.slug] : null),
    ...(client?.capabilities ?? null),
  };
}
