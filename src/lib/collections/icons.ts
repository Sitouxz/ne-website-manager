import * as LucideIcons from 'lucide-react';
import { Boxes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICONS = LucideIcons as unknown as Record<string, LucideIcon>;

export function getIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Boxes;
  return ICONS[name] ?? Boxes;
}
