export type Role = 'ne_admin' | 'client_admin' | 'editor';
export type PostStatus = 'draft' | 'published' | 'archived';
export type PageStatus = 'draft' | 'published';

export interface Client {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  deploy_hook: string | null;
  github_repo: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  client_id: string | null;
  role: Role;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  clients?: Client;
}

export interface Post {
  id: string;
  client_id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_url: string | null;
  category: string;
  tags: string[];
  status: PostStatus;
  seo_title: string | null;
  seo_description: string | null;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  client_id: string;
  title: string;
  path: string;
  content: string;
  status: PageStatus;
  visibility: 'public' | 'private';
  updated_at: string;
}
