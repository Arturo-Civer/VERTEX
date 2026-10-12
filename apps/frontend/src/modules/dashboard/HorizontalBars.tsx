import type { BarItem } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface HorizontalBarsProps {
  title: string;
  items: BarItem[];
}

export function HorizontalBars({ title, items }: HorizontalBarsProps) {
  const max = Math.max(...items.map((i) => i.hours), 1);

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <div className={styles.barList}>
        {items.map((item) => {
          const pct = (item.hours / max) * 100;
          return (
            <div key={item.id} className={styles.barRow}>
              <span className={styles.barLabel}>{item.label}</span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: item.color ?? '#2E75B6',
                  }}
                />
              </div>
              <span className={styles.barValue}>{item.hours} h</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
