import type { KpiItem } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface KpiRowProps {
  items: KpiItem[];
}

export function KpiRow({ items }: KpiRowProps) {
  return (
    <div className={styles.kpiRow}>
      {items.map((kpi) => (
        <div key={kpi.id} className={styles.kpiCard}>
          <div className={styles.kpiValue}>{kpi.value}</div>
          <div className={styles.kpiLabel}>{kpi.label}</div>
        </div>
      ))}
    </div>
  );
}
