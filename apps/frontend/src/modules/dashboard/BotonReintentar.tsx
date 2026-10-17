import styles from './dashboard.module.css';

/** "Reintentar" next to an error message: runs the failed request again */
export function BotonReintentar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.botonReintentar} onClick={onClick}>
      Reintentar
    </button>
  );
}
