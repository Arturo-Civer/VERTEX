import { API_URL, ErrorTemporal, errorDeRespuesta } from '../../shared/api';

export interface EquipoInfo {
  codigo: string;
  nombre: string;
  area: string;
}

const NETWORK_ERROR = 'Sin conexión con el servidor';
const GENERIC_ERROR = 'No se pudo consultar el equipo';

/**
 * GET /api/equipos/:codigo. Resolves with the equipment when the backend
 * finds it; rejects with the backend's `mensaje` (404 / 503 / 500) or a
 * network error message. An aborted request rejects with an AbortError.
 */
export async function fetchEquipo(codigo: string, signal?: AbortSignal): Promise<EquipoInfo> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/equipos/${encodeURIComponent(codigo)}`, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ErrorTemporal(NETWORK_ERROR);
  }

  const body = (await res.json().catch(() => null)) as
    | ({ encontrado?: boolean; mensaje?: string } & Partial<EquipoInfo>)
    | null;

  if (res.ok && body?.encontrado && body.codigo && body.nombre) {
    return { codigo: body.codigo, nombre: body.nombre, area: body.area ?? '' };
  }
  throw errorDeRespuesta(res.status, body?.mensaje || GENERIC_ERROR);
}
