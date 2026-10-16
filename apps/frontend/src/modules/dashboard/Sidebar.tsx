import { ArbolEquipos } from './ArbolEquipos';
import type { CeroCheck } from './ArbolEquipos';
import type { NodoArbol } from './jerarquiaDemo';
import { LogoutIcon } from './LogoutIcon';
import styles from './dashboard.module.css';

interface SidebarProps {
  ruta: string[];
  onRutaChange: (ruta: string[], elegido?: NodoArbol) => void;
  verificacion: CeroCheck;
  onLogout: () => void;
}

/** Left panel (desktop and phone landscape): logo, equipment tree and logout */
export function Sidebar({ ruta, onRutaChange, verificacion, onLogout }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarLogo}>
        <div className={styles.logoMark}>VX</div>
        <span className={styles.logoText}>VERTEX</span>
      </div>
      <nav className={styles.sidebarArbol} aria-label="Equipos">
        <ArbolEquipos ruta={ruta} onRutaChange={onRutaChange} verificacion={verificacion} />
      </nav>
      <button type="button" className={`${styles.sidebarItem} ${styles.sidebarLogout}`} onClick={onLogout}>
        <LogoutIcon className={styles.sidebarIcon} />
        Cerrar sesión
      </button>
    </aside>
  );
}
