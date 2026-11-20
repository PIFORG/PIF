/** Libelles FR pour valeurs techniques API. Affichage uniquement. */

const MODULE_LABELS: Record<string, string> = {
  'Missions pedagogiques': 'Missions pédagogiques',
  'Modeles IA': 'Modèles IA',
  'Scenarios bancaires': 'Scénarios bancaires',
  'Defis virtuels': 'Défis virtuels',
  'Tarification frequence / severite': 'Tarification fréquence / sévérité',
  'Pertes agregees Panjer / Monte-Carlo': 'Pertes agrégées Panjer / Monte-Carlo',
  'Capital economique / ALM': 'Capital économique / ALM',
};

const STATUS_LABELS: Record<string, string> = {
  LIVE: 'En service',
  LIVE_WRITES: 'En service (écritures)',
  PLANNED: 'Planifié',
  PARTIAL: 'Partiel',
  OFFLINE: 'Hors service',
  AVAILABLE: 'Disponible',
  LOCKED: 'Verrouillé',
  CONFIGURED: 'Configuré',
  IMPLEMENTED: 'Implémenté',
  PLAYABLE: 'Jouable',
};

export function displayApiModuleLabel(label: string | null | undefined): string {
  if (!label) return '—';
  return MODULE_LABELS[label] ?? label;
}

export function displayApiStatus(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? STATUS_LABELS[status.toUpperCase()] ?? status;
}