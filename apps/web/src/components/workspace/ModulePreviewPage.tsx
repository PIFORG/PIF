'use client';

import Link from 'next/link';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { Icon } from '@/components/ui/Icon';
import { PageHeading, Panel } from '@/components/workspace/primitives';
import type { BlueprintBlock, ModuleDefinition } from '@/lib/modules/moduleCatalog';
import styles from './ModulePreviewPage.module.css';

function Wireframe({ kind }: { kind: BlueprintBlock['kind'] }) {
  switch (kind) {
    case 'chart':
      return (
        <div className={styles.wfChart}>
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      );
    case 'table':
      return (
        <div className={styles.wfTable}>
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} data-head={i === 0 ? 'true' : undefined} />
          ))}
        </div>
      );
    case 'kpis':
      return (
        <div className={styles.wfKpis}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      );
    case 'heatmap':
      return (
        <div className={styles.wfHeat}>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      );
    case 'form':
      return (
        <div className={styles.wfForm}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} />
          ))}
          <span data-button="true" />
        </div>
      );
    default:
      return (
        <div className={styles.wfList}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      );
  }
}

/** Fully disabled ticket; explains why instead of pretending to submit. */
function OrderTicketPreview() {
  return (
    <form className={styles.ticket} aria-describedby="ticket-disabled" onSubmit={(e) => e.preventDefault()}>
      <fieldset disabled className={styles.ticketFields}>
        <legend className="sr-only">Simulated order ticket (disabled)</legend>
        <div className={styles.sides} role="group" aria-label="Side">
          <button type="button" className={styles.side} data-side="buy">
            Buy
          </button>
          <button type="button" className={styles.side} data-side="sell">
            Sell
          </button>
        </div>
        <label className="field">
          <span className="field-label">Instrument</span>
          <input className="input" placeholder="Search a symbol" />
        </label>
        <div className={styles.ticketRow}>
          <label className="field">
            <span className="field-label">Order type</span>
            <select className="select" defaultValue="LIMIT">
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP">Stop</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Quantity</span>
            <input className="input num" inputMode="numeric" placeholder="0" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Limit price</span>
          <input className="input num" inputMode="decimal" placeholder="0.00" />
        </label>
        <button type="submit" className="btn btn-primary">
          Review order
        </button>
      </fieldset>
      <p id="ticket-disabled" className={styles.ticketNote}>
        <Icon name="lock" size={14} />
        Disabled: the simulated execution engine is not connected, so no order can be placed yet.
      </p>
    </form>
  );
}

function ModulePreviewContent({ module }: { module: ModuleDefinition }) {
  return (
    <AppShell>
      <div className="page-shell">
        <PageHeading
          eyebrow={module.group}
          title={module.title}
          description={module.summary}
          status="DESIGNED_PENDING_BACKEND"
          actions={
            <Link href="/dashboard" className="btn btn-secondary">
              Back to overview
            </Link>
          }
        />

        <div className={styles.notice} role="note">
          <Icon name="info" size={18} />
          <div>
            <strong>Designed, not yet connected.</strong> This screen shows the planned layout only. It does not generate
            prices, orders, balances, scores or results, and nothing here is saved.
            {module.safeguard ? <span className={styles.safeguard}>{module.safeguard}</span> : null}
          </div>
        </div>

        <section aria-labelledby="layout-title" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 id="layout-title">Designed layout</h2>
            <span className={styles.layoutTag}>Layout preview · no data</span>
          </div>
          <div className={styles.blueprint}>
            {module.blueprint.map((block) => (
              <div key={block.title} className={styles.block} data-span={block.span}>
                <div className={styles.blockHead}>
                  <h3>{block.title}</h3>
                  <span>{block.note}</span>
                </div>
                {module.slug === 'trading' && block.kind === 'form' ? <OrderTicketPreview /> : <Wireframe kind={block.kind} />}
              </div>
            ))}
          </div>
        </section>

        <div className={styles.columns}>
          <Panel id="capabilities" title="What this module will do">
            <ul className={styles.capabilities}>
              {module.capabilities.map((item) => (
                <li key={item}>
                  <Icon name="check" size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel id="concepts" title="Key concepts" description="Read these before the module goes live.">
            <dl className={styles.concepts}>
              {module.concepts.map((c) => (
                <div key={c.term}>
                  <dt>{c.term}</dt>
                  <dd>{c.definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <Panel
          id="contract"
          title="Backend contract required"
          description="Proposed endpoints this screen needs. None of them exist in the API yet."
          className={styles.contractPanel}
        >
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Proposed API endpoints for {module.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {module.contracts.map((c) => (
                  <tr key={`${c.method} ${c.path}`}>
                    <td>
                      <span className={styles.method} data-method={c.method}>
                        {c.method}
                      </span>
                    </td>
                    <td className="mono">{c.path}</td>
                    <td>{c.purpose}</td>
                    <td>
                      <span className="badge badge-muted">Proposed</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

export function ModulePreviewPage({ module }: { module: ModuleDefinition }) {
  return (
    <ProtectedRoute>
      <ModulePreviewContent module={module} />
    </ProtectedRoute>
  );
}
