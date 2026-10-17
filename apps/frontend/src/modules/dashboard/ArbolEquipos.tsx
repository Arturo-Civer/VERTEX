import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { JERARQUIA_DEMO, textoRuta } from './jerarquiaDemo';
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
 * Equipment tree (Área → Sección → Grupo → Equipo → Componente). In each
 * level at most one option is open (it is in the route, with "−"):
 * - the options above it stay visible, closed with "+";
 * - the options below it are hidden, and its children show under it.
 * Opening another option (name or "+") closes the open one; the name of an
 * open option drops the levels under it; its "−" closes it and shows the
 * whole level again, closed. Lower selections are never kept: they must be
 * chosen again.
 */
export function ArbolEquipos({ ruta, onRutaChange, verificacion }: ArbolEquiposProps) {
  const lista = useRef<HTMLUListElement>(null);

  // The clicked button may disappear: keep the keyboard focus in the tree,
  // on the node chosen by the last change
  const enfocar = useRef<string | null>(null);
  useEffect(() => {
    const id = enfocar.current;
    if (!id) return;
    enfocar.current = null;
    lista.current?.querySelector<HTMLElement>(`[data-nodo="${CSS.escape(id)}"]`)?.focus();
  }, [ruta]);

  const cambiar = (siguiente: string[], foco: string, elegido?: NodoArbol) => {
    enfocar.current = foco;
    onRutaChange(siguiente, elegido);
  };

  /** Rows of one level (`nivel` = its depth) and, under its open option, the next levels */
  const filas = (opciones: NodoArbol[], nivel: number): ReactNode[] => {
    const abierta = opciones.findIndex((o) => o.id === ruta[nivel]);
    const visibles = abierta < 0 ? opciones : opciones.slice(0, abierta + 1);
    return visibles.flatMap((o, k) => {
      if (k !== abierta) {
        // Closed: opening it replaces the route from this level down
        const abrir = () => cambiar([...ruta.slice(0, nivel), o.id], o.hijos?.[0]?.id ?? o.id, o);
        return [
          <li key={o.id} className={styles.arbolItem}>
            <div className={styles.arbolFila} style={sangria(nivel)}>
              <button
                type="button"
                className={styles.arbolBoton}
                aria-label={`Abrir ${o.nombre}`}
                aria-expanded={o.hijos?.length ? false : undefined}
                title={`Abrir ${o.nombre}`}
                onClick={abrir}
              >
                <span className={styles.arbolSigno} data-signo="+" aria-hidden="true" />
              </button>
              <button type="button" className={styles.arbolNombre} title={o.nombre} data-nodo={o.id} onClick={abrir}>
                {o.nombre}
              </button>
            </div>
          </li>,
        ];
      }

      const hijos = o.hijos ?? [];
      const esUltimo = nivel === ruta.length - 1;
      // An open leaf (a chosen component): highlighted
      const hoja = !hijos.length;
      const error = o.cero && verificacion.status === 'error' ? verificacion.message : null;
      return [
        <li key={o.id} className={styles.arbolItem}>
          <div className={`${styles.arbolFila} ${styles.arbolRuta} ${hoja ? styles.arbolElegido : ''}`} style={sangria(nivel)}>
            <button
              type="button"
              className={styles.arbolBoton}
              aria-label={`Cerrar ${o.nombre}`}
              aria-expanded={hoja ? undefined : true}
              title={`Cerrar ${o.nombre}`}
              onClick={() => cambiar(ruta.slice(0, nivel), o.id)}
            >
              <span className={styles.arbolSigno} data-signo="−" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.arbolNombre}
              title={o.nombre}
              aria-current={esUltimo ? 'location' : undefined}
              data-nodo={o.id}
              onClick={() => cambiar(ruta.slice(0, nivel + 1), hijos[0]?.id ?? o.id)}
            >
              {o.nombre}
            </button>
            {o.cero && <Verificacion estado={verificacion} />}
          </div>
          {error && (
            <p className={styles.arbolError} style={sangria(nivel + 2)} role="alert">
              {error}
            </p>
          )}
        </li>,
        ...filas(hijos, nivel + 1),
      ];
    });
  };

  return (
    <ul ref={lista} className={styles.arbol} aria-label="Equipos de la planta">
      {filas(JERARQUIA_DEMO, 0)}
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
