/**
 * Ingest authorized RSS feeds (titles + links + dates) into market_news_items_real.
 */
import https from 'node:https';
import { connectAllowedDb } from '../lib.mjs';
import crypto from 'node:crypto';

const FEEDS = [
  {
    source_id: 'RSS_FED',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    market: 'US',
    category: 'central_bank',
    language: 'en',
  },
  {
    source_id: 'RSS_SEC',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    market: 'US',
    category: 'regulator',
    language: 'en',
  },
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'MarketTradingRoom/1.0 (academic research; local-dev)',
            Accept: 'application/rss+xml,application/xml,text/xml,*/*',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchText(res.headers.location).then(resolve, reject);
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        },
      )
      .on('error', reject);
  });
}

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    const guid = decodeXml((block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || link || title).trim();
    const pub = decodeXml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    const desc = decodeXml((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '').trim();
    if (!title) continue;
    const published = pub ? new Date(pub) : new Date();
    items.push({
      external_id: crypto.createHash('sha1').update(guid).digest('hex').slice(0, 40),
      title: title.slice(0, 500),
      summary: desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400) || null,
      original_url: link || null,
      published_at: published.toISOString(),
    });
  }
  return items;
}

async function main() {
  const client = await connectAllowedDb();
  const summary = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRssItems(xml);
      let upserts = 0;
      for (const it of items) {
        await client.query(
          `INSERT INTO market_news_items_real
            (source_id, external_id, title, summary, original_url, published_at, language, market, category, verification)
           VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,'TITLE_LINK_ONLY')
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             original_url = EXCLUDED.original_url,
             published_at = EXCLUDED.published_at,
             collected_at = NOW()`,
          [
            feed.source_id,
            it.external_id,
            it.title,
            it.summary,
            it.original_url,
            it.published_at,
            feed.language,
            feed.market,
            feed.category,
          ],
        );
        upserts++;
      }
      summary.push({ feed: feed.source_id, ok: true, items: upserts });
    } catch (e) {
      summary.push({ feed: feed.source_id, ok: false, error: String(e.message || e) });
    }
  }
  const count = await client.query('SELECT COUNT(*)::int AS n FROM market_news_items_real');
  console.log(JSON.stringify({ ok: true, summary, total: count.rows[0].n }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});