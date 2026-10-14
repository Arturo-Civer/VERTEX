/**
 * Seed de mediciones por minuto de CERO-010: del 2026-07-13 (lunes) hasta
 * el último lote de 5 minutos completo antes de ejecutar el script.
 *
 *   npm run seed:mediciones      (desde apps/backend, lee apps/backend/.env)
 *
 * Antes, una sola vez y con la cuenta administradora:
 *   1. database/scripts/03_preparar_seed_mediciones_cero010.sql
 *      (borra los datos simulados anteriores de CERO-010 y alinea el
 *      historial de motores con este período)
 *   2. database/scripts/04_crear_login_seed.sql
 *      (login SEED_DB_USER: SELECT + INSERT; app_demo_user no puede insertar)
 * Después: database/scripts/99_verificar_integridad_variables.sql
 *
 * Como el prototipo: una lectura por minuto de cada variable (corriente,
 * temperatura, vibración, voltaje y ESTADO_MOTOR), enviadas en lotes de
 * 5 minutos; received_time es el envío del lote. Valores deterministas
 * (generador con semilla fija): re-ejecutar genera los mismos datos.
 *
 * Estados:
 *   - Encendido: ESTADO_MOTOR = 1 y valores normales.
 *   - Apagado: ESTADO_MOTOR = 0 y valores cerca de cero; sin huecos.
 *   - Mantenimiento: sin registros entre fecha_inicio y fecha_fin.
 *   - Evento: lecturas anómalas dispersas 1–5 días antes de una parada,
 *     la parada (ESTADO_MOTOR = 0) y el reinicio 10–60 min después.
 *
 * Además inserta los intervalos de funcionamiento (los usa el dashboard),
 * las intervenciones de mantenimiento y los ciclos por motor. Todo va en
 * una sola transacción: si algo falla no queda nada a medias.
 * No inserta nada si CERO-010 ya tiene datos en el período.
 */
import { randomUUID } from 'node:crypto';
import sql from 'mssql';

const EQUIPO_CODIGO = 'CERO-010';
const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

/** Lunes 13/07/2026 00:00 UTC */
const INICIO = Date.UTC(2026, 6, 13);
/** Último lote de 5 minutos completo (el prototipo envía cada 5 minutos) */
const FIN = Math.floor(Date.now() / (5 * MINUTO)) * 5 * MINUTO;

const FILAS_POR_LOTE = 500;
const SEMILLA = 20260713;

const V = {
  corriente: 'CORRIENTE_MOTOR',
  temperatura: 'TEMPERATURA_MOT',
  vibracion: 'VIBRACION_MOT',
  voltaje: 'VOLTAJE_MOTOR',
  estado: 'ESTADO_MOTOR',
} as const;
type VariableCodigo = (typeof V)[keyof typeof V];
const VARIABLES: VariableCodigo[] = [V.corriente, V.temperatura, V.vibracion, V.voltaje, V.estado];

// Bit de cada variable en la máscara de anomalías de un minuto
const BIT: Record<VariableCodigo, number> = {
  CORRIENTE_MOTOR: 1,
  TEMPERATURA_MOT: 2,
  VIBRACION_MOT: 4,
  VOLTAJE_MOTOR: 8,
  ESTADO_MOTOR: 0,
};

interface Mantenimiento {
  /** Último registro antes del hueco (UTC) */
  inicio: string;
  /** Primer registro después del hueco (UTC) */
  fin: string;
  tipo: 'MECANICO' | 'ELECTRICO';
  subtipo: string;
  tecnico: string;
  motivo: string;
  hallazgos: string;
  acciones: string;
}

// 4 mantenimientos repartidos en el período; el 2.º es el cambio de motor
// (su fin debe coincidir con el inicio de MOT-CERO010-002 en EquipoMotorHistorial)
const MANTENIMIENTOS: Mantenimiento[] = [
  {
    inicio: '2026-07-30T09:30:00Z',
    fin: '2026-07-30T15:30:00Z',
    tipo: 'MECANICO',
    subtipo: 'PREVENTIVO',
    tecnico: 'tec.mecanico',
    motivo: 'Lubricación preventiva programada',
    hallazgos: 'SEED: Rodamientos en buen estado tras la parada por temperatura del 23/07.',
    acciones: 'Lubricación de rodamientos delantero y trasero; limpieza de ventilación.',
  },
  {
    inicio: '2026-09-10T14:30:00Z',
    fin: '2026-09-11T08:00:00Z',
    tipo: 'ELECTRICO',
    subtipo: 'CORRECTIVO',
    tecnico: 'tec.electrico',
    motivo: 'Falla eléctrica de MOT-CERO010-001: aislamiento del devanado degradado',
    hallazgos: 'SEED: Resistencia de aislamiento baja; sobrecorriente recurrente desde agosto.',
    acciones: 'Reemplazo de MOT-CERO010-001 por MOT-CERO010-002 y prueba en vacío.',
  },
  {
    inicio: '2026-09-28T07:00:00Z',
    fin: '2026-09-29T09:00:00Z',
    tipo: 'MECANICO',
    subtipo: 'CORRECTIVO',
    tecnico: 'tec.mecanico',
    motivo: 'Vibración alta: alineación y cambio de rodamiento',
    hallazgos: 'SEED: Desalineación del acople y rodamiento trasero con desgaste.',
    acciones: 'Cambio de rodamiento trasero, alineación láser del acople.',
  },
  {
    inicio: '2026-10-07T13:00:00Z',
    fin: '2026-10-07T18:00:00Z',
    tipo: 'ELECTRICO',
    subtipo: 'PREVENTIVO',
    tecnico: 'tec.electrico',
    motivo: 'Revisión de protecciones eléctricas y tablero',
    hallazgos: 'SEED: Relé térmico calibrado; conexiones reapretadas.',
    acciones: 'Verificación de protecciones, termografía del tablero y reapriete.',
  },
];

interface Evento {
  /** Primer minuto de la parada (UTC) */
  parada: string;
  minutosParada: number;
  diasAnomalias: number;
  /** La primera variable siempre es anómala; las demás, a veces */
  variables: VariableCodigo[];
}

// 3 eventos, cada uno después del último mantenimiento previo
const EVENTOS: Evento[] = [
  { parada: '2026-07-23T15:20:00Z', minutosParada: 35, diasAnomalias: 3, variables: [V.temperatura, V.corriente] },
  { parada: '2026-08-27T11:05:00Z', minutosParada: 50, diasAnomalias: 4, variables: [V.corriente, V.temperatura] },
  { parada: '2026-09-21T10:40:00Z', minutosParada: 20, diasAnomalias: 2, variables: [V.vibracion] },
];

// ── Generador determinista ──────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEMILLA);
const entre = (min: number, max: number) => min + rand() * (max - min);

/** Ruido gaussiano N(0, 1) (Box-Muller) */
function gauss() {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ── Línea de tiempo por minuto ──────────────────────────────

const APAGADO = 0;
const ENCENDIDO = 1;
const SIN_DATOS = 2; // mantenimiento: no se insertan registros

const minutoDe = (iso: string) => (Date.parse(iso) - INICIO) / MINUTO;
const tiempoDe = (minuto: number) => new Date(INICIO + minuto * MINUTO);

function construirLineaDeTiempo(totalMinutos: number) {
  const estado = new Uint8Array(totalMinutos);
  const paradaEvento = new Uint8Array(totalMinutos);
  const anomalias = new Uint8Array(totalMinutos);

  // Turnos: lunes a viernes ~06:00–22:00, sábado ~06:00–14:00, domingo apagado
  const dias = Math.ceil(totalMinutos / 1440);
  for (let d = 0; d < dias; d++) {
    const diaSemana = d % 7; // INICIO es lunes → 0 = lunes, 6 = domingo
    if (diaSemana === 6) continue;
    const arranque = Math.round(6 * 60 + entre(-20, 20));
    const parada = Math.round((diaSemana === 5 ? 14 : 22) * 60 + entre(-20, 20));
    for (let m = arranque; m < parada; m++) {
      const i = d * 1440 + m;
      if (i < totalMinutos) estado[i] = ENCENDIDO;
    }
  }

  const exigirEncendido = (minuto: number, que: string) => {
    if (minuto >= 0 && minuto < totalMinutos && estado[minuto] !== ENCENDIDO) {
      throw new Error(`${que} (${tiempoDe(minuto).toISOString()}) no cae con el motor encendido`);
    }
  };

  for (const ev of EVENTOS) {
    const p = minutoDe(ev.parada);
    exigirEncendido(p - 1, `El evento del ${ev.parada}`);
    exigirEncendido(p + ev.minutosParada, `El reinicio del evento del ${ev.parada}`);
    for (let i = p; i < p + ev.minutosParada && i < totalMinutos; i++) {
      estado[i] = APAGADO;
      paradaEvento[i] = 1;
    }

    // Ráfagas de 1–4 minutos anómalos, más frecuentes cerca de la parada
    const desde = Math.max(0, p - ev.diasAnomalias * 1440);
    const rafagas = Math.round(ev.diasAnomalias * entre(9, 14));
    for (let r = 0; r < rafagas; r++) {
      let i = Math.floor(desde + Math.sqrt(rand()) * (p - desde));
      const largo = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < largo && i < p; k++, i++) {
        if (estado[i] !== ENCENDIDO) continue;
        anomalias[i] |= BIT[ev.variables[0]];
        for (const extra of ev.variables.slice(1)) {
          if (rand() < 0.4) anomalias[i] |= BIT[extra];
        }
      }
    }
  }

  for (const mt of MANTENIMIENTOS) {
    const a = minutoDe(mt.inicio);
    const b = minutoDe(mt.fin);
    exigirEncendido(a, `El inicio del mantenimiento del ${mt.inicio}`);
    exigirEncendido(b, `El fin del mantenimiento del ${mt.inicio}`);
    for (let i = a + 1; i < b && i < totalMinutos; i++) estado[i] = SIN_DATOS;
  }

  return { estado, paradaEvento, anomalias };
}

// ── Valores de cada minuto ──────────────────────────────────

interface Lectura {
  minuto: number;
  valores: Record<VariableCodigo, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Recorre los minutos en orden y produce las lecturas (sin los huecos) */
function* generarLecturas(estado: Uint8Array, anomalias: Uint8Array): Generator<Lectura> {
  let temperatura = 28;
  for (let i = 0; i < estado.length; i++) {
    const minutoDelDia = i % 1440;
    const ambiente = 28 + 1.5 * Math.sin((2 * Math.PI * (minutoDelDia - 9 * 60)) / 1440);

    if (estado[i] === SIN_DATOS) {
      // Motor detenido en mantenimiento: se enfría aunque no haya lecturas
      temperatura += (ambiente - temperatura) * (1 - Math.exp(-1 / 60));
      continue;
    }

    if (estado[i] === ENCENDIDO) {
      // Temperatura operativa media 55–65 °C con deriva lenta
      const objetivo = 60 + 3 * Math.sin((2 * Math.PI * i) / (23 * 1440));
      temperatura += (objetivo - temperatura) * (1 - Math.exp(-1 / 45));
      const a = anomalias[i];
      yield {
        minuto: i,
        valores: {
          CORRIENTE_MOTOR: r3(a & BIT.CORRIENTE_MOTOR ? entre(9.2, 10.8)
            : clamp(5.2 + 0.3 * Math.sin((4 * Math.PI * minutoDelDia) / 1440) + 0.18 * gauss(), 3.6, 6.9)),
          TEMPERATURA_MOT: r3(a & BIT.TEMPERATURA_MOT ? entre(86, 92) : temperatura + 0.25 * gauss()),
          VIBRACION_MOT: r3(a & BIT.VIBRACION_MOT ? entre(7.2, 9.7) : clamp(2.4 + 0.22 * gauss(), 1.1, 4.4)),
          VOLTAJE_MOTOR: r3(a & BIT.VOLTAJE_MOTOR ? (rand() < 0.5 ? entre(194, 199) : entre(231, 236))
            : clamp(220 + 1.1 * gauss(), 215.5, 224.5)),
          ESTADO_MOTOR: 1,
        },
      };
      continue;
    }

    // Apagado: se enfría hacia 25–35 °C; el resto, cerca de cero
    temperatura += (ambiente + 2 - temperatura) * (1 - Math.exp(-1 / 120));
    yield {
      minuto: i,
      valores: {
        CORRIENTE_MOTOR: r3(Math.abs(0.02 * gauss())),
        TEMPERATURA_MOT: r3(temperatura + 0.25 * gauss()),
        VIBRACION_MOT: r3(Math.abs(0.01 * gauss())),
        VOLTAJE_MOTOR: r3(Math.abs(0.15 * gauss())),
        ESTADO_MOTOR: 0,
      },
    };
  }
}

// ── Intervalos, intervenciones y ciclos ─────────────────────

interface Intervalo {
  inicio: number;
  fin: number | null;
  tipo: 'PARADA_NORMAL' | 'FALLA' | 'MANTENIMIENTO' | null;
}

/**
 * Tramos encendidos. Cierre: MANTENIMIENTO si sigue un hueco (fin = último
 * registro), FALLA si sigue la parada de un evento, PARADA_NORMAL si no
 * (fin = primer registro apagado). El último queda abierto si sigue encendido.
 */
function calcularIntervalos(estado: Uint8Array, paradaEvento: Uint8Array): Intervalo[] {
  const intervalos: Intervalo[] = [];
  let inicio: number | null = null;
  for (let i = 0; i < estado.length; i++) {
    if (estado[i] === ENCENDIDO) {
      if (inicio === null) inicio = i;
      continue;
    }
    if (inicio === null) continue;
    if (estado[i] === SIN_DATOS) intervalos.push({ inicio, fin: i - 1, tipo: 'MANTENIMIENTO' });
    else intervalos.push({ inicio, fin: i, tipo: paradaEvento[i] ? 'FALLA' : 'PARADA_NORMAL' });
    inicio = null;
  }
  if (inicio !== null) intervalos.push({ inicio, fin: null, tipo: null });
  return intervalos;
}

// ── Base de datos ───────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (ver apps/backend/.env.example)`);
  return value;
}

const iso = (minuto: number) => tiempoDe(minuto).toISOString().slice(0, 23);

let pool: sql.ConnectionPool | undefined;

/** --simular: genera todo en memoria y muestra el resumen, sin conectarse a la base */
function simular(totalMinutos: number) {
  const { estado, paradaEvento, anomalias } = construirLineaDeTiempo(totalMinutos);
  const intervalos = calcularIntervalos(estado, paradaEvento);
  const minutos = { encendido: 0, apagado: 0, sinDatos: 0, anomalos: 0 };
  let filas = 0;
  for (const l of generarLecturas(estado, anomalias)) {
    filas += VARIABLES.length;
    if (l.valores.ESTADO_MOTOR === 1) minutos.encendido++;
    else minutos.apagado++;
    if (anomalias[l.minuto]) minutos.anomalos++;
  }
  minutos.sinDatos = totalMinutos - minutos.encendido - minutos.apagado;
  const porTipo: Record<string, number> = {};
  for (const it of intervalos) porTipo[String(it.tipo ?? 'ABIERTO')] = (porTipo[String(it.tipo ?? 'ABIERTO')] ?? 0) + 1;
  console.log(`Simulación ${EQUIPO_CODIGO}: ${iso(0)} → ${iso(totalMinutos)} UTC`);
  console.log(`  Filas de Mediciones: ${filas.toLocaleString('es-CO')}`);
  console.log(`  Minutos: ${JSON.stringify(minutos)}`);
  console.log(`  Intervalos: ${intervalos.length} ${JSON.stringify(porTipo)}`);
  console.log(`  Mantenimientos: ${MANTENIMIENTOS.length} · Eventos: ${EVENTOS.length}`);
}

async function main() {
  if (FIN <= INICIO) throw new Error('La fecha actual es anterior al inicio del período');
  const totalMinutos = (FIN - INICIO) / MINUTO;
  if (process.argv.includes('--simular')) {
    simular(totalMinutos);
    return;
  }

  pool = await sql.connect({
    server: requireEnv('DB_SERVER'),
    port: Number(process.env.DB_PORT ?? 1433),
    user: requireEnv('SEED_DB_USER'),
    password: requireEnv('SEED_DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
    requestTimeout: 120_000,
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  });

  // ── Referencias de la base ──
  const equipo = (
    await new sql.Request()
      .input('codigo', sql.VarChar(30), EQUIPO_CODIGO)
      .query<{ equipo_id: string }>('SELECT equipo_id FROM dbo.EquiposCero WHERE codigo = @codigo AND activo = 1')
  ).recordset[0];
  if (!equipo) throw new Error(`No existe el equipo ${EQUIPO_CODIGO}`);

  const variables = (
    await new sql.Request().query<{ variable_id: string; codigo: VariableCodigo; unidad: string }>(
      `SELECT variable_id, codigo, unidad FROM dbo.Variables WHERE codigo IN (${VARIABLES.map((c) => `'${c}'`).join(',')})`,
    )
  ).recordset;
  const variable = (codigo: VariableCodigo) => {
    const v = variables.find((x) => x.codigo === codigo);
    if (!v) throw new Error(`Falta la variable ${codigo}. Ejecute primero 01_reference_data.sql.`);
    return v;
  };

  const historial = (
    await new sql.Request()
      .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
      .query<{ motor_id: string; codigo: string; fecha_inicio: Date; fecha_fin: Date | null }>(`
        SELECT h.motor_id, m.codigo, h.fecha_inicio, h.fecha_fin
        FROM dbo.EquipoMotorHistorial h JOIN dbo.Motores m ON m.motor_id = h.motor_id
        WHERE h.equipo_id = @equipo_id ORDER BY h.fecha_inicio`)
  ).recordset;
  const cambioMotor = Date.parse(MANTENIMIENTOS[1].fin);
  if (
    historial.length !== 2 ||
    historial[0].fecha_inicio.getTime() !== INICIO ||
    historial[0].fecha_fin?.getTime() !== cambioMotor ||
    historial[1].fecha_inicio.getTime() !== cambioMotor ||
    historial[1].fecha_fin !== null
  ) {
    throw new Error(
      'El historial de motores de CERO-010 no coincide con el período. ' +
        'Ejecute primero database/scripts/03_preparar_seed_mediciones_cero010.sql.',
    );
  }
  const motorEn = (minuto: number) => (INICIO + minuto * MINUTO < cambioMotor ? historial[0] : historial[1]);

  const sensores = (
    await new sql.Request()
      .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
      .query<{ sensor_id: string; variable_id: string; motor_id: string | null }>(
        'SELECT sensor_id, variable_id, motor_id FROM dbo.Sensores WHERE equipo_id = @equipo_id AND activo = 1',
      )
  ).recordset;
  const sensorDe = (variableId: string, motorId: string) =>
    sensores.find((s) => s.variable_id.toUpperCase() === variableId.toUpperCase()
      && s.motor_id?.toUpperCase() === motorId.toUpperCase())?.sensor_id ?? null;

  const tecnicos = (
    await new sql.Request().query<{ usuario_id: string; username: string }>(
      "SELECT usuario_id, username FROM dbo.Usuarios WHERE username IN ('tec.mecanico', 'tec.electrico')",
    )
  ).recordset;
  const tecnico = (username: string) => {
    const t = tecnicos.find((x) => x.username === username);
    if (!t) throw new Error(`Falta el usuario ${username}. Ejecute scripts/create_demo_users.ts.`);
    return t.usuario_id;
  };

  // ── No insertar si ya hay datos de CERO-010 en el período ──
  const existentes = (
    await new sql.Request()
      .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
      .input('inicio', sql.DateTime2(3), new Date(INICIO))
      .input('fin', sql.DateTime2(3), new Date(FIN))
      .query<{ mediciones: number; intervalos: number; mantenimientos: number; ciclos: number }>(`
        SELECT
          (SELECT COUNT(*) FROM dbo.Mediciones WHERE equipo_id = @equipo_id AND event_time >= @inicio AND event_time < @fin) AS mediciones,
          (SELECT COUNT(*) FROM dbo.IntervalosFuncionamiento WHERE equipo_id = @equipo_id) AS intervalos,
          (SELECT COUNT(*) FROM dbo.IntervencionesMantenimiento WHERE equipo_id = @equipo_id) AS mantenimientos,
          (SELECT COUNT(*) FROM dbo.ContadoresCicloMotor WHERE equipo_id = @equipo_id) AS ciclos`)
  ).recordset[0];
  if (existentes.mediciones + existentes.intervalos + existentes.mantenimientos + existentes.ciclos > 0) {
    throw new Error(
      `${EQUIPO_CODIGO} ya tiene datos (${JSON.stringify(existentes)}). No se insertó nada. ` +
        'Para reemplazarlos: database/scripts/03_preparar_seed_mediciones_cero010.sql.',
    );
  }

  console.log(`${EQUIPO_CODIGO}: ${iso(0)} → ${iso(totalMinutos)} (UTC), ${totalMinutos.toLocaleString('es-CO')} minutos`);
  const { estado, paradaEvento, anomalias } = construirLineaDeTiempo(totalMinutos);
  const intervalos = calcularIntervalos(estado, paradaEvento);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // ── Mediciones en lotes de 500 filas ──
    const ids = VARIABLES.map((c) => variable(c));
    let filasLote: string[] = [];
    let total = 0;
    let mes = '';
    let filasMes = 0;

    const enviarLote = async () => {
      if (filasLote.length === 0) return;
      const req = new sql.Request(tx).input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id);
      ids.forEach((v, k) => {
        req.input(`v${k}`, sql.UniqueIdentifier, v.variable_id);
        req.input(`u${k}`, sql.VarChar(20), v.unidad);
      });
      historial.forEach((h, k) => req.input(`m${k}`, sql.UniqueIdentifier, h.motor_id));
      sensores.forEach((s, k) => req.input(`s${k}`, sql.UniqueIdentifier, s.sensor_id));
      await req.query(`
        INSERT INTO dbo.Mediciones
          (medicion_id, variable_id, equipo_id, motor_id, sensor_id, valor, unidad,
           event_time, received_time, provenance, calidad, modificada)
        VALUES ${filasLote.join(',\n')}`);
      total += filasLote.length;
      filasMes += filasLote.length;
      filasLote = [];
    };

    for (const lectura of generarLecturas(estado, anomalias)) {
      const mesLectura = iso(lectura.minuto).slice(0, 7);
      if (mesLectura !== mes) {
        await enviarLote();
        if (mes) console.log(`  ${EQUIPO_CODIGO} · ${mes} · ${filasMes.toLocaleString('es-CO')} filas (total ${total.toLocaleString('es-CO')})`);
        mes = mesLectura;
        filasMes = 0;
      }

      const motor = motorEn(lectura.minuto);
      const motorParam = `@m${historial.indexOf(motor)}`;
      // El lote de 5 minutos llega unos segundos después de su último minuto
      const loteFin = (Math.floor(lectura.minuto / 5) + 1) * 5;
      const recibido = new Date(INICIO + loteFin * MINUTO + (2 + (lectura.minuto % 17)) * 1000).toISOString().slice(0, 23);
      const evento = iso(lectura.minuto);

      ids.forEach((v, k) => {
        const sensorId = sensorDe(v.variable_id, motor.motor_id);
        const sensorParam = sensorId ? `@s${sensores.findIndex((s) => s.sensor_id === sensorId)}` : 'NULL';
        filasLote.push(
          `(NEWID(),@v${k},@equipo_id,${motorParam},${sensorParam},${lectura.valores[v.codigo]},@u${k},` +
            `'${evento}','${recibido}','SIMULADA','BUENA',0)`,
        );
      });
      if (filasLote.length >= FILAS_POR_LOTE) await enviarLote();
    }
    await enviarLote();
    console.log(`  ${EQUIPO_CODIGO} · ${mes} · ${filasMes.toLocaleString('es-CO')} filas (total ${total.toLocaleString('es-CO')})`);

    // ── Intervalos de funcionamiento ──
    for (const it of intervalos) {
      await new sql.Request(tx)
        .input('motor_id', sql.UniqueIdentifier, motorEn(it.inicio).motor_id)
        .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
        .input('inicio', sql.DateTime2(3), tiempoDe(it.inicio))
        .input('fin', sql.DateTime2(3), it.fin === null ? null : tiempoDe(it.fin))
        .input('duracion', sql.Decimal(12, 4), it.fin === null ? null : it.fin - it.inicio)
        .input('tipo', sql.VarChar(30), it.tipo)
        .query(`
          INSERT INTO dbo.IntervalosFuncionamiento (motor_id, equipo_id, inicio, fin, duracion_min, tipo_cierre, provenance)
          VALUES (@motor_id, @equipo_id, @inicio, @fin, @duracion, @tipo, 'SIMULADA')`);
    }
    console.log(`  Intervalos de funcionamiento: ${intervalos.length}`);

    // ── Intervenciones de mantenimiento ──
    const intervenciones = MANTENIMIENTOS.map((mt) => ({ ...mt, id: randomUUID(), motor: motorEn(minutoDe(mt.inicio)) }));
    for (const mt of intervenciones) {
      await new sql.Request(tx)
        .input('id', sql.UniqueIdentifier, mt.id)
        .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
        .input('motor_id', sql.UniqueIdentifier, mt.motor.motor_id)
        .input('tipo', sql.VarChar(20), mt.tipo)
        .input('subtipo', sql.VarChar(50), mt.subtipo)
        .input('inicio', sql.DateTime2(3), new Date(mt.inicio))
        .input('fin', sql.DateTime2(3), new Date(mt.fin))
        .input('registrado_por', sql.UniqueIdentifier, tecnico(mt.tecnico))
        .input('motivo', sql.NVarChar(500), mt.motivo)
        .input('hallazgos', sql.NVarChar(2000), mt.hallazgos)
        .input('acciones', sql.NVarChar(2000), mt.acciones)
        .query(`
          INSERT INTO dbo.IntervencionesMantenimiento
            (intervencion_id, equipo_id, motor_id, tipo_mantenimiento, subtipo, fecha_inicio, fecha_fin,
             registrado_por, motivo, hallazgos, acciones, reinicia_ciclo, fecha_corte_ciclo, es_retroactivo)
          VALUES (@id, @equipo_id, @motor_id, @tipo, @subtipo, @inicio, @fin,
                  @registrado_por, @motivo, @hallazgos, @acciones, 1, @fin, 0)`);
    }
    console.log(`  Intervenciones de mantenimiento: ${intervenciones.length}`);

    // ── Ciclos por motor: cada mantenimiento cierra uno y abre otro ──
    const ciclos: { motor: (typeof historial)[number]; inicio: number; fin: number | null; reiniciadoPor: string | null; motivo: string }[] = [];
    let inicioCiclo = 0;
    let reiniciadoPor: string | null = null;
    let motivo = 'SEED: Inicio del período de mediciones por minuto';
    for (const mt of intervenciones) {
      ciclos.push({ motor: motorEn(inicioCiclo), inicio: inicioCiclo, fin: minutoDe(mt.inicio), reiniciadoPor, motivo });
      inicioCiclo = minutoDe(mt.fin);
      reiniciadoPor = mt.id;
      motivo = `SEED: Reinicio tras mantenimiento ${mt.tipo.toLowerCase()} ${mt.subtipo.toLowerCase()} del ${mt.inicio.slice(0, 10)}`;
    }
    ciclos.push({ motor: motorEn(inicioCiclo), inicio: inicioCiclo, fin: null, reiniciadoPor, motivo });

    const numeroPorMotor = new Map<string, number>();
    for (const c of ciclos) {
      const numero = (numeroPorMotor.get(c.motor.motor_id) ?? 0) + 1;
      numeroPorMotor.set(c.motor.motor_id, numero);
      let minutosEncendido = 0;
      for (let i = c.inicio; i < (c.fin ?? totalMinutos); i++) if (estado[i] === ENCENDIDO) minutosEncendido++;

      await new sql.Request(tx)
        .input('motor_id', sql.UniqueIdentifier, c.motor.motor_id)
        .input('equipo_id', sql.UniqueIdentifier, equipo.equipo_id)
        .input('numero', sql.Int, numero)
        .input('inicio', sql.DateTime2(3), tiempoDe(c.inicio))
        .input('fin', sql.DateTime2(3), c.fin === null ? null : tiempoDe(c.fin))
        .input('horas', sql.Decimal(12, 4), Math.round((minutosEncendido / 60) * 10_000) / 10_000)
        .input('motivo', sql.NVarChar(200), c.motivo)
        .input('reiniciado_por', sql.UniqueIdentifier, c.reiniciadoPor)
        .input('activo', sql.Bit, c.fin === null)
        .query(`
          INSERT INTO dbo.ContadoresCicloMotor
            (motor_id, equipo_id, ciclo_numero, inicio_ciclo, fin_ciclo, horas_acumuladas, motivo_inicio, reiniciado_por, activo)
          VALUES (@motor_id, @equipo_id, @numero, @inicio, @fin, @horas, @motivo, @reiniciado_por, @activo)`);
      console.log(`  Ciclo ${numero} de ${c.motor.codigo}: ${iso(c.inicio)} → ${c.fin === null ? 'vigente' : iso(c.fin)} · ${(minutosEncendido / 60).toFixed(1)} h encendido`);
    }

    // ── Auditoría ──
    const detalle =
      `seed-mediciones.ts: ${EQUIPO_CODIGO} ${iso(0)} → ${iso(totalMinutos)} UTC. ` +
      `${total} mediciones, ${intervalos.length} intervalos, ${intervenciones.length} mantenimientos, ` +
      `${ciclos.length} ciclos, ${EVENTOS.length} eventos.`;
    await new sql.Request(tx)
      .input('detalle', sql.NVarChar(1000), detalle)
      .query(`
        INSERT INTO dbo.Auditoria (usuario_id, username, accion, entidad, resultado, contexto_bd, detalle)
        VALUES (NULL, LEFT(ORIGINAL_LOGIN(), 50), 'SEED_MEDICIONES', 'Mediciones', 'EXITO', 'DEMO', @detalle)`);

    await tx.commit();
    console.log(`\nCOMMIT: ${total.toLocaleString('es-CO')} mediciones insertadas.`);
    console.log('Siguiente paso: database/scripts/99_verificar_integridad_variables.sql');
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    console.error('ROLLBACK: no se insertó nada.');
    throw err;
  }
}

main()
  .catch((err: unknown) => {
    console.error('No se pudo cargar el seed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool?.close());
