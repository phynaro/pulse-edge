import { useMemo, useState } from 'react';

function readStoredOrder(storageKey: string): string[] {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? JSON.parse(value) as string[] : [];
  } catch (error) {
    console.error(`Failed to parse saved order '${storageKey}':`, error);
    return [];
  }
}

export function usePersistentOrder<T extends { id: string }>(items: T[], storageKey: string) {
  const [orderIds, setOrderIds] = useState<string[]>(() => readStoredOrder(storageKey));

  const orderedItems = useMemo(() => [...items].sort((a, b) => {
    const indexA = orderIds.indexOf(a.id);
    const indexB = orderIds.indexOf(b.id);
    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  }), [items, orderIds]);

  const saveOrder = (ordered: T[], trailingIds: string[] = []) => {
    const leadingIds = ordered.map(item => item.id);
    const used = new Set([...leadingIds, ...trailingIds]);
    const next = [...leadingIds, ...trailingIds, ...orderIds.filter(id => !used.has(id))];
    setOrderIds(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  return { orderedItems, saveOrder };
}
