#!/usr/bin/env node
/** Fail on obvious user-facing English phrases in Angular templates (heuristic).
 * Also inventories Spring messages*.properties + learning_fr.properties coverage. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('apps/web/src');
const apiRes = path.resolve('apps/api/src/main/resources');
const allow = new Set([
  'MarketQuest',
  'FinStories',
  'VaR',
  'TVaR',
  'PIF',
  'MarketLab',
  'API',
  'MFA',
  'OK',
  'HTML',
  'CSS',
  'JSON',
  'DT',
  'TND',
  'USD',
  'EUR',
  'SMA',
  'EMA',
  'RSI',
  'MACD',
  // Identical FR/EN product terms kept intentionally
  'Sessions',
  'Backtesting',
]);
const englishy =
  /\b(Welcome|Sign in|Sign up|Password|Dashboard|Loading|Error|Success|Cancel|Submit|Save|Delete|Settings|Profile|Sessions|Overview|Markets|Trading Desk|Portfolios|Risk Analytics|Something went wrong|Try again|No data|Create account|Forgot password)\b/;
const hits = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p);
    } else if (/\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts') && !name.includes('-testing.')) {
      const text = fs.readFileSync(p, 'utf8');
      if (p.includes(`${path.sep}i18n${path.sep}`)) continue;
      for (const line of text.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ') || trimmed.includes(' from ')) {
          continue;
        }
        if (/\b(export class|extends Error|throw new Error)\b/.test(line)) continue;
        if (englishy.test(line)) {
          const m = line.match(englishy);
          if (m && !allow.has(m[0])) hits.push({ file: path.relative(root, p), line: trimmed.slice(0, 160), match: m[0] });
        }
      }
    }
  }
}

function propsKeys(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => l.split('=', 1)[0].trim());
}

walk(root);

const messageFiles = ['messages.properties', 'messages_fr.properties', 'learning_fr.properties']
  .map((name) => ({ name, path: path.join(apiRes, name) }))
  .filter((f) => fs.existsSync(f.path));

const propsInventory = messageFiles.map((f) => {
  const keys = propsKeys(f.path);
  const sample = keys.slice(0, 12);
  return { name: f.name, count: keys.length, sample };
});

const learningKeys = propsKeys(path.join(apiRes, 'learning_fr.properties'));
const missionSlugs = [
  'my-first-trade',
  'protect-your-capital',
  'diversification-challenge',
  'breaking-news',
  'market-shock',
  'sector-collapse',
  'interest-rate-shock',
  'liquidity-crisis',
  'overconfident-trader',
  'survive-the-market-crash',
];
const missionCoverage = missionSlugs.map((slug) => {
  const prefix = `mission.${slug}.`;
  const related = learningKeys.filter((k) => k.startsWith(prefix));
  return {
    slug,
    title: related.includes(`${prefix}title`),
    summary: related.includes(`${prefix}summary`),
    context: related.includes(`${prefix}briefing.context`),
    rules: related.filter((k) => k.includes('.briefing.rule.')).length,
    tips: related.filter((k) => k.includes('.briefing.tip.')).length,
    objectives: related.filter((k) => k.includes('.objective.')).length,
    events: related.filter((k) => k.includes('.event.') && k.endsWith('.headline')).length,
    totalKeys: related.length,
  };
});

const out = path.resolve('docs/ui/FRENCH_COVERAGE_SCAN.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
const body = [
  '# French coverage scan (heuristic)',
  '',
  `Angular template hits: ${hits.length}`,
  '',
  '## Spring / learning resource bundles',
  '',
  ...propsInventory.map((p) => `- \`${p.name}\`: **${p.count}** keys`),
  '',
  '### MarketQuest overlay (`learning_fr.properties`)',
  '',
  '| Mission slug | title | summary | context | rules | tips | objectives | event headlines | keys |',
  '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...missionCoverage.map(
    (m) =>
      `| \`${m.slug}\` | ${m.title ? 'yes' : 'no'} | ${m.summary ? 'yes' : 'no'} | ${m.context ? 'yes' : 'no'} | ${m.rules} | ${m.tips} | ${m.objectives} | ${m.events} | ${m.totalKeys} |`,
  ),
  '',
  '## Angular English hits',
  '',
  ...hits.slice(0, 200).map((h) => `- \`${h.file}\`: **${h.match}** — ${h.line}`),
  '',
].join('\n');
fs.writeFileSync(out, body, 'utf8');
console.log(`Wrote ${out} with ${hits.length} Angular hits; bundles: ${propsInventory.map((p) => `${p.name}=${p.count}`).join(', ')}`);
if (hits.length > 0) process.exitCode = 1;