import { Database } from 'lucide-react';
import { ICON_MAP } from './icons';

export default function DynamicIcon({ name, size, className }: { name: string; size?: number; className?: string }) {
  const IconComponent = ICON_MAP[name] || Database;
  return <IconComponent size={size} className={className} />;
}
