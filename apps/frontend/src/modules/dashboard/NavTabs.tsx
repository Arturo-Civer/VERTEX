import type { NavTab, NavTabId } from '../../contracts/dashboard';
import styles from './dashboard.module.css';

interface NavTabsProps {
  tabs: NavTab[];
  active: NavTabId;
  onChange: (id: NavTabId) => void;
}

export function NavTabs({ tabs, active, onChange }: NavTabsProps) {
  return (
    <nav className={styles.navTabs} aria-label="Navegación principal">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`${styles.navTab} ${active === tab.id ? styles.navTabActive : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
