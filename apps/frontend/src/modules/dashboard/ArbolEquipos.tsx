import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { JERARQUIA_DEMO, resolverRuta, textoRuta } from './jerarquiaDemo';
import type { NodoArbol } from './jerarquiaDemo';
import styles from './dashboard.module.css';

/** Result of checking the selected CERO against the backend (GET /api/equipos/:codigo) */
export type CeroCheck =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'error'; message: string };

interface ArbolEquiposProps {
  /** Ids from the root down: the chosen route */
  ruta: string[];
  /** `elegido`: the node just added to the route (only when going down) */
  onRutaChange: (ruta: string[], elegido?: NodoArbol) => void;
  /** Check of the CERO equipment in the route, shown next to it */
  verificacion: CeroCheck;
}

/** Indentation of a row: one character per level */
const sangria = (nivel: number) => ({ '--nivel': nivel }) as CSSProperties;

function Verificacion({ estado }: { estado: CeroCheck }) {
  if (estado.status === 'loading') {
    return <span className={styles.arbolSpinner} role="status" aria-label="Verificando equipo" />;
  }
  if (estado.status === 'ok') {
    return (
      <span className={`${styles.arbolCheck} ${styles.arbolCheckOk}`} role="status" aria-label="Equipo verificado" title="Equipo verificado">
        ✓
      </span>
    );
  }
  if (estado.status === 'error') {
    return (
      <span className={`${styles.arbolCheck} ${styles.arbolCheckError}`} aria-hidden="true" title={estado.message}>
        !
      </span>
    );
  }
  return null;
}

/**
 * Equipment tree (Área → Sección → Grupo → Equipo → Componente). Only the
 * route is shown, each level with "−", and under it the children of its last
 * level, each with "+"; the sisters of a chosen option are hidden.
 * - Choosing a child (name or "+") adds it to the route.
 * - The name of a route level makes it the last one (its children show).
 * - The "−" of a route level removes it (its sisters show again).
 * Going back always drops the lower levels: they must be chosen again.
 */
export function ArbolEquipos({ ruta, onRutaChange, verificacion }: ArbolEquiposProps) {
  const nodos = resolverRuta(ruta) ?? [];
  const ultimo = nodos[nodos.length - 1];
  const opciones = ultimo ? (ultimo.hijos ?? []) : JERARQUIA_DEMO;
  const lista = useRef<HTMLUListElement>(null);

  // The clicked button may disappear (its sisters hide): keep the keyboard
  // focus in the tree, on the last level of the route (or the first option)
  const enfocar = useRef(false);
  useEffect(() => {
    if (!enfocar.current) return;
    enfocar.current = false;
    lista.current?.querySelector<HTMLElement>('[data-foco]')?.focus();
  }, [ruta]);

  const cambiar = (siguiente: string[], elegido?: NodoArbol) => {
    enfocar.current = true;
    onRutaChange(siguiente, elegido);
  };

  return (
    <ul ref={lista} className={styles.arbol} aria-label="Equipos de la planta">
      {nodos.map((n, i) => {
        const esUltimo = i === nodos.length - 1;
        // A chosen leaf (a component): bullet instead of "−", highlighted
        const hoja = esUltimo && !n.hijos?.length;
        const error = n.cero && verificacion.status === 'error' ? verificacion.message : null;
        return (
          <li key={n.id} className={styles.arbolItem}>
            <div className={`${styles.arbolFila} ${styles.arbolRuta} ${hoja ? styles.arbolElegido : ''}`} style={sangria(i)}>
              {hoja ? (
                <span className={styles.arbolPunto} aria-hidden="true">
                  •
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.arbolBoton}
                  aria-label={`Contraer ${n.nombre}`}
                  aria-expanded="true"
                  title={`Contraer ${n.nombre}`}
                  onClick={() => cambiar(ruta.slice(0, i))}
                >
                  −
                </button>
              )}
              <button
                type="button"
                className={styles.arbolNombre}
                title={n.nombre}
                aria-current={esUltimo ? 'location' : undefined}
                data-foco={esUltimo && !opciones.length ? '' : undefined}
                onClick={() => cambiar(ruta.slice(0, i + 1))}
              >
                {n.nombre}
              </button>
              {n.cero && <Verificacion estado={verificacion} />}
            </div>
            {error && (
              <p className={styles.arbolError} style={sangria(i + 2)} role="alert">
                {error}
              </p>
            )}
          </li>
        );
      })}
      {opciones.map((o, k) => (
        <li key={o.id} className={styles.arbolItem}>
          <div className={styles.arbolFila} style={sangria(nodos.length)}>
            <button
              type="button"
              className={styles.arbolBoton}
              aria-label={`Elegir ${o.nombre}`}
              aria-expanded="false"
              title={`Elegir ${o.nombre}`}
              onClick={() => cambiar([...ruta, o.id], o)}
            >
              +
            </button>
            <button
              type="button"
              className={styles.arbolNombre}
              title={o.nombre}
              data-foco={k === 0 ? '' : undefined}
              onClick={() => cambiar([...ruta, o.id], o)}
            >
              {o.nombre}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Phone portrait: the route in one line under the header; tapping it opens
 * the tree. It closes by itself when an equipment or a component is chosen.
 */
export function ArbolMovil(props: ArbolEquiposProps) {
  const [abierto, setAbierto] = useState(false);
  const panelId = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const texto = textoRuta(props.ruta);

  return (
    <div className={styles.arbolMovil}>
      <button
        ref={boton}
        type="button"
        className={styles.arbolMovilBoton}
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((a) => !a)}
      >
        <span className={styles.arbolMovilRuta} title={texto || undefined}>
          {/* Long routes are cut at the start, so the equipment stays visible */}
          <bdi>{texto || 'Elige un equipo'}</bdi>
        </span>
        <svg className={styles.arbolMovilFlecha} width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
          <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {abierto && (
        <div id={panelId} className={styles.arbolMovilPanel}>
          <ArbolEquipos
            {...props}
            onRutaChange={(ruta, elegido) => {
              props.onRutaChange(ruta, elegido);
              if (elegido?.nivel === 'equipo' || elegido?.nivel === 'componente') {
                setAbierto(false);
                boton.current?.focus();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
