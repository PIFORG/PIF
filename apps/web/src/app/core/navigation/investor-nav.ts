import type { NavItem } from './workspace-nav';

/** Top-level investor navbar sections (horizontal). No admin entries. */
export interface InvestorNavSection {
  id: string;
  label: string;
  /** Direct destination when the section has no dropdown. */
  href?: string;
  match?: string[];
  children?: NavItem[];
}

/**
 * Real Angular destinations only. Labels are user-facing; hrefs match app.routes.ts.
 */
export const INVESTOR_NAV: InvestorNavSection[] = [
  {
    id: 'overview',
    label: "Vue d'ensemble",
    href: '/dashboard',
  },
  {
    id: 'markets',
    label: 'Marchés',
    children: [
      { href: '/markets', label: 'Cotations', icon: 'markets', status: 'LIVE_INTEGRATED' },
    ],
  },
  {
    id: 'trade',
    label: 'Négociation',
    children: [
      { href: '/trading', label: 'Salle des marchés', icon: 'trading', status: 'LIVE_INTEGRATED' },
    ],
  },
  {
    id: 'portfolios',
    label: 'Portefeuilles',
    href: '/portfolios',
  },
  {
    id: 'analyze',
    label: 'Analyses',
    children: [
      { href: '/risk', label: 'Analyser les risques', icon: 'risk', status: 'LIVE_INTEGRATED' },
      {
        href: '/backtesting',
        label: 'Tester une stratégie',
        icon: 'strategy',
        status: 'LIVE_INTEGRATED',
        match: ['/strategies', '/backtesting'],
      },
      { href: '/strategies', label: 'Catalogue de stratégies', icon: 'strategy', status: 'LIVE_INTEGRATED' },
      { href: '/ai', label: 'Prévisions de marché', icon: 'ai', status: 'LIVE_INTEGRATED' },
      { href: '/explainability', label: 'Comprendre les prévisions', icon: 'xai', status: 'LIVE_INTEGRATED' },
      { href: '/stress-testing', label: 'Simuler une crise bancaire', icon: 'bank', status: 'LIVE_INTEGRATED' },
      {
        href: '/actuarial',
        label: 'Assurance et actuariat',
        icon: 'actuarial',
        status: 'LIVE_INTEGRATED',
        match: ['/actuarial'],
      },
    ],
  },
  {
    id: 'learn',
    label: 'Apprentissage',
    children: [
      {
        href: '/learn',
        label: 'Mon parcours',
        icon: 'academy',
        status: 'LIVE_INTEGRATED',
        match: ['/learn'],
      },
      { href: '/stories', label: 'Histoires financières', icon: 'stories', status: 'LIVE_INTEGRATED' },
      { href: '/challenges', label: 'Défis boursiers', icon: 'challenge', status: 'LIVE_INTEGRATED' },
      { href: '/rooms', label: 'Salles de marché', icon: 'challenge', status: 'LIVE_INTEGRATED', match: ['/rooms'] },
    ],
  },
];

export const INVESTOR_MOBILE_PRIMARY = ['/dashboard', '/markets', '/trading', '/learn', '/settings/profile'];

export function isInvestorSectionActive(section: InvestorNavSection, pathname: string): boolean {
  if (section.href) {
    return pathname === section.href || pathname.startsWith(`${section.href}/`);
  }
  return (section.children ?? []).some((item) => {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
    return (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
  });
}

export function isInvestorItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
}

/** All investor destinations reachable from the navbar (for coverage checks). */
export function investorNavHrefs(): string[] {
  const hrefs: string[] = [];
  for (const section of INVESTOR_NAV) {
    if (section.href) hrefs.push(section.href);
    for (const child of section.children ?? []) hrefs.push(child.href);
  }
  return hrefs;
}
