import type { NavTab, NavTabId } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface SidebarProps {
  tabs: NavTab[];
  active: NavTabId;
  onChange: (id: NavTabId) => void;
}

export function Sidebar({ tabs, active, onChange }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarLogo}>
        <div className={styles.logoMark}>VX</div>
        <span className={styles.logoText}>VERTEX</span>
      </div>
      <nav className={styles.sidebarNav} aria-label="Navegación principal">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.sidebarItem} ${active === tab.id ? styles.sidebarItemActive : ''}`}
            onClick={() => onChange(tab.id)}
          >
            <span className={styles.sidebarIcon}>{tab.icon ?? '•'}</span>
            {tab.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
