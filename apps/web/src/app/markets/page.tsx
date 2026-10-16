import type { Metadata } from 'next';
import { ModulePreviewPage } from '@/components/workspace/ModulePreviewPage';
import { MODULES } from '@/lib/modules/moduleCatalog';

const definition = MODULES['markets'];

export const metadata: Metadata = { title: definition.title };

export default function Page() {
  return <ModulePreviewPage module={definition} />;
}
