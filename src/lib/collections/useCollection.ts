'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { getCollectionDef, listAllCollections } from '@/lib/collections/registry';
import { listItems, getItem, deleteItem, type CollectionRecord } from '@/lib/collections/adapter';
import type { Collection } from '@/lib/supabase/types';

/** Resolves the current user's role and the client_id that reads/writes should be scoped to. */
export function useResolvedClient() {
  const { selectedClientId } = useSelectedClient();
  const [clientId, setClientId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (!cancelled) setLoading(false); return; }

      const { data: profile } = await supabase
        .from('profiles').select('client_id, role').eq('id', user.id).single();

      if (cancelled) return;
      const admin = profile?.role === 'ne_admin';
      setIsAdmin(admin);
      setClientId(admin ? (selectedClientId ?? null) : (profile?.client_id ?? null));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [selectedClientId]);

  return { clientId, isAdmin, loading };
}

export function useCollection(slug: string) {
  const { clientId, isAdmin, loading: clientLoading } = useResolvedClient();
  const [def, setDef] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const result = await getCollectionDef(supabase, clientId, slug);
      if (!cancelled) { setDef(result); setLoading(false); }
    }
    if (!clientLoading) load();
    return () => { cancelled = true; };
  }, [slug, clientId, clientLoading]);

  return { def, clientId, isAdmin, loading: clientLoading || loading };
}

export function useAllCollections() {
  const { clientId, loading: clientLoading } = useResolvedClient();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  async function refetch() {
    setLoading(true);
    const supabase = createClient();
    const result = await listAllCollections(supabase, clientId);
    setCollections(result);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const result = await listAllCollections(supabase, clientId);
      if (!cancelled) { setCollections(result); setLoading(false); }
    }
    if (!clientLoading) load();
    return () => { cancelled = true; };
  }, [clientLoading, clientId]);

  return { collections, clientId, loading: clientLoading || loading, refetch };
}

export function useCollectionItems(def: Collection | null, clientId: string | null) {
  const [items, setItems] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function refetch() {
    if (!def) return;
    setLoading(true);
    const supabase = createClient();
    const result = await listItems(supabase, def, clientId);
    setItems(result);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!def) { setLoading(false); return; }
      setLoading(true);
      const supabase = createClient();
      const result = await listItems(supabase, def, clientId);
      if (!cancelled) { setItems(result); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [def, clientId]);

  const remove = useCallback(async (id: string) => {
    if (!def) return;
    const supabase = createClient();
    await deleteItem(supabase, def, id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, [def]);

  return { items, loading, refetch, remove };
}

export function useCollectionItem(def: Collection | null, id: string) {
  const isNew = id === 'new';
  const [item, setItem] = useState<CollectionRecord | null>(null);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!def || isNew) { setLoading(false); return; }
      setLoading(true);
      const supabase = createClient();
      const result = await getItem(supabase, def, id);
      if (!cancelled) { setItem(result); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [def, id, isNew]);

  return { item, isNew, loading };
}
