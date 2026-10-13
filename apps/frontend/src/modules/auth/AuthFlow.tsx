import { LoginForm } from './LoginForm';
import styles from './auth.module.css';

interface AuthFlowProps {
  onSuccess: (token: string) => void;
}

const FEATURES = [
  'Horas de operación por motor en tiempo real',
  'Estados, eventos y tendencias de cada equipo',
  'Registro de mantenimientos e intervenciones',
];

function Logo({ variant }: { variant: 'light' | 'dark' }) {
  return (
    <div className={`${styles.logo} ${variant === 'dark' ? styles.logoDark : ''}`}>
      <span className={styles.logoMark}>VX</span>
      <span className={styles.logoText}>VERTEX</span>
    </div>
  );
}

/**
 * Sign-in screen: brand panel (desktop only) + login card. Phones show the
 * logo inside the card instead.
 */
export function AuthFlow({ onSuccess }: AuthFlowProps) {
  return (
    <div className={styles.page}>
      <aside className={styles.brandPanel}>
        <Logo variant="light" />
        <div className={styles.brandBody}>
          <p className={styles.brandSubtitle}>Sistema de Monitoreo Industrial</p>
          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f} className={styles.feature}>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.brandFooter}>© 2025 VERTEX · v1.0</p>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.card}>
          <div className={styles.cardLogo}>
            <Logo variant="dark" />
          </div>
          <LoginForm onSuccess={onSuccess} />
        </div>
      </main>
    </div>
  );
}
