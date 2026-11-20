import { connectAllowedDb } from '../lib.mjs';

const EPISODES = [
  {
    id: 'GFC_2008',
    title_fr: 'Crise financière mondiale 2008–2009',
    start: '2008-09-01',
    end: '2009-06-30',
    summary: 'Effondrement de Lehman Brothers, stress bancaire mondial, chute des indices actions et pic de volatilité.',
    refs: [{ label: 'Fed History', url: 'https://www.federalreservehistory.org/essays/great-recession-and-its-aftermath' }],
  },
  {
    id: 'EU_DEBT_2011',
    title_fr: 'Crise de la dette souveraine et turbulences 2011',
    start: '2011-07-01',
    end: '2011-12-31',
    summary: 'Tensions sur les dettes européennes et corrections marquées des marchés actions.',
    refs: [],
  },
  {
    id: 'CORR_2018',
    title_fr: 'Corrections de marché 2018',
    start: '2018-02-01',
    end: '2018-12-31',
    summary: 'Volatilité en février puis marché baissier de fin dannee aux Etats-Unis.',
    refs: [],
  },
  {
    id: 'COVID_2020',
    title_fr: 'Krach COVID-19 2020',
    start: '2020-02-19',
    end: '2020-04-30',
    summary: 'Chute brutale des indices liée à la pandémie, puis rebond ; VIX à des niveaux extrêmes.',
    refs: [],
  },
  {
    id: 'BEAR_2022',
    title_fr: 'Marché baissier et resserrement monétaire 2022',
    start: '2022-01-01',
    end: '2022-12-31',
    summary: 'Hausse agressive des taux directeurs, inflation élevée, baisse prolongée des actions.',
    refs: [{ label: 'FOMC', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' }],
  },
  {
    id: 'BANK_2023',
    title_fr: 'Turbulences bancaires 2023',
    start: '2023-03-01',
    end: '2023-05-31',
    summary: 'Défaillances de banques régionales US et stress de liquidité (SVB et suites).',
    refs: [],
  },
];

const client = await connectAllowedDb();
for (const e of EPISODES) {
  await client.query(
    `INSERT INTO market_crisis_episodes (id, title_fr, start_date, end_date, summary_fr, references_json, instruments_hint)
     VALUES ($1,$2,$3::date,$4::date,$5,$6::jsonb,$7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       title_fr = EXCLUDED.title_fr,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       summary_fr = EXCLUDED.summary_fr,
       references_json = EXCLUDED.references_json`,
    [e.id, e.title_fr, e.start, e.end, e.summary, JSON.stringify(e.refs), JSON.stringify(['SPX', 'VIX', 'DJI'])],
  );
}
console.log(JSON.stringify({ ok: true, episodes: EPISODES.length }));
await client.end();