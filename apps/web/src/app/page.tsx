'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BrandLockup } from '@/components/brand/BrandMark';
import { ProductPreview } from '@/components/marketing/ProductPreview';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { StatusBadge } from '@/components/workspace/primitives';
import { useAuth } from '@/lib/auth/AuthProvider';
import styles from './landing.module.css';

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'trading',
    title: 'Simulated trading desk',
    body: 'Place market and limit orders against virtual capital and see how execution, fees and slippage shape results.',
  },
  {
    icon: 'risk',
    title: 'Portfolio & risk analytics',
    body: 'Track allocation, drawdown, volatility and value at risk with every figure explained in plain language.',
  },
  {
    icon: 'strategy',
    title: 'Strategies & backtesting',
    body: 'Describe a rule-based strategy, replay it on historical scenarios and compare it with a benchmark.',
  },
  {
    icon: 'xai',
    title: 'AI insights you can question',
    body: 'Model outputs come with confidence, drivers and limitations — designed to be explainable, never as advice.',
  },
  {
    icon: 'bank',
    title: 'Bank stress testing',
    body: 'Apply rate, credit and liquidity shocks to a sample balance sheet and read the capital impact step by step.',
  },
  {
    icon: 'actuarial',
    title: 'Actuarial lab',
    body: 'Explore mortality tables, reserves and premium pricing with transparent, reproducible assumptions.',
  },
];

const STEPS = [
  {
    title: 'Create a secure account',
    body: 'Verified email, optional authenticator-app MFA and full control over your signed-in devices.',
  },
  {
    title: 'Practise with virtual capital',
    body: 'Build simulated portfolios and test ideas in a market room where mistakes cost nothing.',
  },
  {
    title: 'Analyse, learn and improve',
    body: 'Review risk, compare strategies and follow guided lessons that connect theory to every decision.',
  },
];

const LIVE_NOW = [
  'Accounts with email verification',
  'Authenticator-app MFA and recovery codes',
  'Device and session management',
  'Role-based administration and audit log',
];

const IN_DEVELOPMENT = [
  'Market data and the simulated order engine',
  'Portfolio, risk and backtesting engines',
  'AI insights and explainability',
  'Stress testing, actuarial lab and academy content',
];

export default function LandingPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  if (status !== 'unauthenticated') {
    return (
      <div className="page-shell" role="status" aria-live="polite">
        <p>{status === 'authenticated' ? 'Opening your dashboard…' : 'Loading…'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link href="/" className={styles.brand} aria-label="Market Trading Room Simulator — home">
            <BrandLockup size={32} />
          </Link>
          <nav aria-label="Sections" className={styles.sections}>
            <a href="#capabilities">Capabilities</a>
            <a href="#how-it-works">How it works</a>
            <a href="#status">Availability</a>
          </nav>
          <div className={styles.topActions}>
            <ThemeToggle />
            <Link href="/login" className="btn btn-ghost">
              Sign in
            </Link>
            <Link href="/register" className={`btn btn-primary ${styles.hideXs}`}>
              Create account
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>
                <span className={styles.kickerDot} aria-hidden />
                Market Trading Room Simulator
              </p>
              <h1 id="hero-title" className={styles.heroTitle}>
                Financial markets, <span className={styles.heroAccent}>without the real-world risk.</span>
              </h1>
              <p className={styles.lead}>
                An interactive financial simulation platform designed to help you understand financial markets,
                practise virtual trading, manage portfolios and make informed investment decisions.
              </p>
              <div className={styles.cta}>
                <Link href="/register" className="btn btn-primary btn-lg">
                  Create your free account
                  <Icon name="arrow-right" size={16} />
                </Link>
                <Link href="/login" className="btn btn-secondary btn-lg">
                  Sign in
                </Link>
              </div>
              <p className={styles.assurance}>
                <Icon name="lock" size={14} />
                Simulation only — no real money, no brokerage account, no investment advice.
              </p>
            </div>
            <div className={styles.heroVisual}>
              <ProductPreview />
            </div>
          </div>
        </section>

        <section id="capabilities" className={styles.section} aria-labelledby="capabilities-title">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Capabilities</p>
            <h2 id="capabilities-title" className={styles.sectionTitle}>
              One market room for trading, risk and financial reasoning
            </h2>
            <p className={styles.sectionLead}>
              Each workspace is designed around a real professional task. Modules marked as preview are designed and
              waiting for their simulation engines.
            </p>
          </div>
          <ul className={styles.pillars}>
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className={styles.pillar}>
                <span className={styles.pillarIcon}>
                  <Icon name={pillar.icon} size={20} />
                </span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
                <StatusBadge status="DESIGNED_PENDING_BACKEND" />
              </li>
            ))}
          </ul>
        </section>

        <section id="how-it-works" className={styles.section} aria-labelledby="workflow-title">
          <div className={styles.sectionHead}>
            <p className="eyebrow">How it works</p>
            <h2 id="workflow-title" className={styles.sectionTitle}>
              From first login to confident decisions
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={`${styles.stepIndex} num`} aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="status" className={styles.section} aria-labelledby="status-title">
          <div className={styles.statusGrid}>
            <div className={styles.sectionHead}>
              <p className="eyebrow">Availability</p>
              <h2 id="status-title" className={styles.sectionTitle}>
                Honest about what works today
              </h2>
              <p className={styles.sectionLead}>
                The secure account platform is live. Market simulation modules are being connected one engine at a
                time, and every screen states which one it is.
              </p>
            </div>
            <div className={styles.statusCard}>
              <div className={styles.statusHead}>
                <h3>Available now</h3>
                <StatusBadge status="LIVE_INTEGRATED" />
              </div>
              <ul className={styles.checks}>
                {LIVE_NOW.map((item) => (
                  <li key={item}>
                    <Icon name="check" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.statusCard}>
              <div className={styles.statusHead}>
                <h3>In development</h3>
                <StatusBadge status="DESIGNED_PENDING_BACKEND" />
              </div>
              <ul className={styles.checks} data-pending="true">
                {IN_DEVELOPMENT.map((item) => (
                  <li key={item}>
                    <Icon name="clock" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.disclaimer} aria-labelledby="disclaimer-title">
          <Icon name="info" size={20} />
          <div>
            <h2 id="disclaimer-title">Simulated trading disclaimer</h2>
            <p>
              Market Trading Room Simulator is an educational simulation. Balances, orders, positions and results are
              virtual and have no monetary value. Nothing on this platform is investment, tax or legal advice, and
              simulated performance does not predict real-world results.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <BrandLockup size={26} />
          <nav aria-label="Footer" className={styles.footerLinks}>
            <Link href="/login">Sign in</Link>
            <Link href="/register">Create account</Link>
            <Link href="/forgot-password">Reset password</Link>
          </nav>
          <p className={styles.footerNote}>Financial markets, without the real-world risk. Educational simulation only.</p>
        </div>
      </footer>
    </div>
  );
}
