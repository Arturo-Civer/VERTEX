/**
 * create_demo_users.ts
 * =====================================================================
 * Crea los usuarios de demostración en VERTEX_DEMO con contraseñas
 * hasheadas (bcrypt). Lee las contraseñas de variables de entorno.
 * NO almacena contraseñas en texto plano ni en el código.
 *
 * Prerrequisitos:
 *   npm install mssql bcrypt dotenv
 *   npm install -D @types/mssql @types/bcrypt ts-node typescript
 *
 * Variables de entorno requeridas (.env):
 *   VERTEX_DEMO_SERVER      ej. localhost,1433
 *   VERTEX_DEMO_DB          VERTEX_DEMO
 *   VERTEX_DEMO_SA_USER     usuario con permiso de escritura (ej. sa)
 *   VERTEX_DEMO_SA_PWD      contraseña del usuario anterior
 *   DEMO_PWD_ADMIN          contraseña para admin.demo
 *   DEMO_PWD_ING_MANT       contraseña para ing.mantenimiento
 *   DEMO_PWD_TEC_MEC        contraseña para tec.mecanico
 *   DEMO_PWD_TEC_ELEC       contraseña para tec.electrico
 *   DEMO_PWD_DIR_PROD       contraseña para dir.produccion
 *   DEMO_PWD_CONSULTA       contraseña para consulta
 *   DEMO_PWD_AUDITOR        contraseña para auditor
 *
 * Uso:
 *   npx ts-node scripts/create_demo_users.ts
 * =====================================================================
 */

import * as sql from 'mssql';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const BCRYPT_ROUNDS = 12;

// IDs fijos que coinciden con los del seed 02_demo_pilot_data.sql
const DEMO_USERS = [
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E001',
    username:   'admin.demo',
    nombre:     'Administrador Demo',
    email:      'admin.demo@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111101',  // ADMINISTRADOR
    pwd_env:    'DEMO_PWD_ADMIN',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E002',
    username:   'ing.mantenimiento',
    nombre:     'Ingeniero de Mantenimiento Demo',
    email:      'ing.mant@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111102',  // ING_MANTENIMIENTO
    pwd_env:    'DEMO_PWD_ING_MANT',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E003',
    username:   'tec.mecanico',
    nombre:     'Técnico Mecánico Demo',
    email:      'tec.mec@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111103',  // TECNICO_MECANICO
    pwd_env:    'DEMO_PWD_TEC_MEC',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E004',
    username:   'tec.electrico',
    nombre:     'Técnico Eléctrico Demo',
    email:      'tec.elec@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111104',  // TECNICO_ELECTRICO
    pwd_env:    'DEMO_PWD_TEC_ELEC',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E005',
    username:   'dir.produccion',
    nombre:     'Director de Producción Demo',
    email:      'dir.prod@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111105',  // DIRECTOR_PRODUCCION
    pwd_env:    'DEMO_PWD_DIR_PROD',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E006',
    username:   'consulta',
    nombre:     'Usuario Consulta Demo',
    email:      'consulta@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111106',  // CONSULTA
    pwd_env:    'DEMO_PWD_CONSULTA',
  },
  {
    usuario_id: 'E0E0E0E0-E0E0-E0E0-E0E0-E0E0E0E0E007',
    username:   'auditor',
    nombre:     'Auditor Demo',
    email:      'auditor@vertex.demo',
    rol_id:     '11111111-1111-1111-1111-111111111107',  // AUDITOR
    pwd_env:    'DEMO_PWD_AUDITOR',
  },
];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Variable de entorno requerida no definida: ${name}`);
  return val;
}

async function main(): Promise<void> {
  console.log('=== create_demo_users.ts ===');
  console.log('Conectando a VERTEX_DEMO...');

  const config: sql.config = {
    server:   requireEnv('VERTEX_DEMO_SERVER').split(',')[0],
    port:     parseInt(requireEnv('VERTEX_DEMO_SERVER').split(',')[1] ?? '1433', 10),
    database: requireEnv('VERTEX_DEMO_DB'),
    user:     requireEnv('VERTEX_DEMO_SA_USER'),
    password: requireEnv('VERTEX_DEMO_SA_PWD'),
    options: {
      trustServerCertificate: true,
      enableArithAbort:       true,
    },
  };

  const pool = await sql.connect(config);
  console.log('Conectado a', config.database);

  try {
    for (const u of DEMO_USERS) {
      const pwd = requireEnv(u.pwd_env);

      // Generar hash bcrypt
      const hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
      console.log(`  Procesando ${u.username}...`);

      // Upsert: si ya existe, solo actualiza el hash
      await pool.request()
        .input('usuario_id',    sql.UniqueIdentifier, u.usuario_id)
        .input('username',      sql.VarChar(50),      u.username)
        .input('nombre',        sql.NVarChar(100),    u.nombre)
        .input('email',         sql.NVarChar(150),    u.email)
        .input('password_hash', sql.NVarChar(255),    hash)
        .query(`
          MERGE dbo.Usuarios AS tgt
          USING (VALUES (
            @usuario_id, @username, @nombre, @email, @password_hash
          )) AS src (usuario_id, username, nombre, email, password_hash)
          ON tgt.usuario_id = src.usuario_id
          WHEN NOT MATCHED THEN
            INSERT (usuario_id, username, nombre, email, password_hash, activo)
            VALUES (src.usuario_id, src.username, src.nombre, src.email, src.password_hash, 1)
          WHEN MATCHED THEN
            UPDATE SET
              tgt.nombre        = src.nombre,
              tgt.email         = src.email,
              tgt.password_hash = src.password_hash;
        `);

      // Asignar rol si no existe
      await pool.request()
        .input('usuario_id', sql.UniqueIdentifier, u.usuario_id)
        .input('rol_id',     sql.UniqueIdentifier, u.rol_id)
        .query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.UsuarioRoles
            WHERE usuario_id = @usuario_id AND rol_id = @rol_id
          )
          INSERT INTO dbo.UsuarioRoles (usuario_id, rol_id)
          VALUES (@usuario_id, @rol_id);
        `);

      console.log(`  ✓ ${u.username} -> hash actualizado, rol asignado`);
    }

    console.log('\n=== Usuarios demo creados/actualizados correctamente ===');
    console.log('Los hashes placeholder han sido reemplazados por hashes bcrypt reales.');
    console.log('NUNCA guarde las contraseñas en texto plano en ningun archivo.');

  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
