import type { CeroId } from './donutSimulation';

// ═══════════════════════════════════════════════════════════════════
//  ⚠ DEMO — plant hierarchy of the equipment tree
// ═══════════════════════════════════════════════════════════════════
// Área → Sección → Grupo → Equipo → Componente, defined here in the
// frontend for the demonstration. It will be replaced by tables in the
// database (served by the backend); until then, change names or add
// branches in DEFINICION. Only the CERO equipment has data (`cero`), and
// only their Motor has sensors (`sensores`).
// ═══════════════════════════════════════════════════════════════════

export type NivelArbol = 'area' | 'seccion' | 'grupo' | 'equipo' | 'componente';

export interface NodoArbol {
  /** Unique in the whole tree: the parent's id plus the name, e.g. "semielaborados/pasta" */
  id: string;
  nombre: string;
  nivel: NivelArbol;
  /** Equipment with data in the backend: its dbo.EquiposCero.codigo */
  cero?: CeroId;
  /** Component with sensors: shows its equipment's dashboard */
  sensores?: boolean;
  hijos?: NodoArbol[];
}

type Definicion = Omit<NodoArbol, 'id' | 'hijos'> & { hijos?: Definicion[] };

const area = (nombre: string, hijos: Definicion[]): Definicion => ({ nombre, nivel: 'area', hijos });
const seccion = (nombre: string, hijos: Definicion[]): Definicion => ({ nombre, nivel: 'seccion', hijos });
const grupo = (nombre: string, hijos: Definicion[]): Definicion => ({ nombre, nivel: 'grupo', hijos });
const equipo = (nombre: string, hijos: Definicion[], cero?: CeroId): Definicion => ({ nombre, nivel: 'equipo', hijos, cero });
const componente = (nombre: string, sensores?: boolean): Definicion => ({ nombre, nivel: 'componente', sensores });

/** Equipment with data: the CEROs, whose Motor has sensors */
const ceroEquipo = (codigo: CeroId, extra: Definicion[] = []) =>
  equipo(codigo, [componente('Motor', true), ...extra], codigo);

/** DEMO: the five areas, in this order */
const DEFINICION: Definicion[] = [
  area('Semielaborados', [
    seccion('Pasta', [
      grupo('Molinos', [
        equipo('Molino 1', [componente('Motor'), componente('Poleas'), componente('Correas')]),
        equipo('Molino 2', [componente('Motor')]),
      ]),
      grupo('Agitadores', [equipo('Agitador 1', [componente('Motor')])]),
    ]),
    seccion('Esmalte', [grupo('Molinos de esmalte', [equipo('Molino E1', [componente('Motor')])])]),
  ]),
  // Example branch with generic names: rename freely
  area('Prensas', [seccion('Prensado', [grupo('Prensas hidráulicas', [equipo('Prensa 1', [componente('Motor')])])])]),
  area('Línea de esmaltado', [
    seccion('Línea 1', [
      grupo('CEROS', [
        ceroEquipo('CERO-010', [componente('Poleas'), componente('Correas')]),
        ceroEquipo('CERO-011'),
        ceroEquipo('CERO-012'),
        ceroEquipo('CERO-013'),
      ]),
    ]),
  ]),
  // Example branches with generic names: rename freely
  area('Hornos de cocción', [seccion('Cocción', [grupo('Hornos de rodillos', [equipo('Horno 1', [componente('Motor')])])])]),
  area('Selección y empaque', [
    seccion('Clasificación', [grupo('Líneas de selección', [equipo('Clasificadora 1', [componente('Motor')])])]),
  ]),
];

/** "Línea de esmaltado" → "linea-de-esmaltado" */
const slug = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function construir(definiciones: Definicion[], padre: string): NodoArbol[] {
  return definiciones.map(({ hijos, ...d }) => {
    const id = padre ? `${padre}/${slug(d.nombre)}` : slug(d.nombre);
    return { ...d, id, hijos: hijos?.length ? construir(hijos, id) : undefined };
  });
}

/** DEMO: the tree with its ids */
export const JERARQUIA_DEMO: NodoArbol[] = construir(DEFINICION, '');

/**
 * Nodes of a route (ids from the root down). null when some id is not a
 * child of the previous node, e.g. a saved route whose branch no longer exists.
 */
export function resolverRuta(ruta: string[], arbol: NodoArbol[] = JERARQUIA_DEMO): NodoArbol[] | null {
  const nodos: NodoArbol[] = [];
  let opciones = arbol;
  for (const id of ruta) {
    const n = opciones.find((o) => o.id === id);
    if (!n) return null;
    nodos.push(n);
    opciones = n.hijos ?? [];
  }
  return nodos;
}

/** Route as text: "Semielaborados › Pasta › Molinos" ('' without a route) */
export function textoRuta(ruta: string[]) {
  return (resolverRuta(ruta) ?? []).map((n) => n.nombre).join(' › ');
}
