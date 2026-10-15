import type {ReactNode} from 'react';
import styles from './owner-auth.module.css';

export default function OwnerAuthFrame({children}:{children:ReactNode}) {
  return <div className={styles.shell}>
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static logo PNG with explicit width/height; vinext's next/image would route it through /_next/image and lazy-load the above-the-fold logo */}
      <a className={styles.brand} href="/" aria-label="LumaNest TV home"><img src="/logo.png" alt="LumaNest TV" width="195" height="50"/></a>
      <a href="/">Return to website ↗</a>
    </header>
    <main className={styles.main}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>LumaNest owner access</p>
        <h1>Your business.<br/>Your <em>space.</em></h1>
        <p>Manage customers, subscriptions, and payments from your private LumaNest console.</p>
      </div>
      <section className={styles.card} aria-label="Owner access">{children}</section>
    </main>
  </div>;
}
