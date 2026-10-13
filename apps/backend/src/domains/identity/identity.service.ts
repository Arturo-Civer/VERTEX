import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sql from 'mssql';

/** Unknown user, wrong password, inactive user or no usable hash */
export class AuthError extends Error {
  readonly status = 401;

  constructor() {
    super('Credenciales inválidas');
    this.name = 'AuthError';
  }
}

export interface TokenPayload {
  userId: string;
  email: string | null;
  username: string;
  /** Role codes from dbo.Roles (e.g. ADMINISTRADOR); a user may have several */
  rol: string[];
}

interface UserRow {
  usuario_id: string;
  email: string | null;
  username: string;
  password_hash: string;
  roles: string | null;
}

// Compared against when the user does not exist, so a missing user takes
// as long as a wrong password (no user enumeration by response time)
const DUMMY_HASH = bcrypt.hashSync('vertex-dummy-password', 10);

/**
 * Checks a credential (email or username) + password against dbo.Usuarios
 * (active users only) and returns a signed JWT with
 * { userId, email, username, rol }. Throws AuthError (401) when the
 * credentials are not valid.
 */
export async function loginUser(credential: string, password: string): Promise<string> {
  // Both columns are unique; email is NVARCHAR(150) and username VARCHAR(50)
  const result = await new sql.Request()
    .input('credential', sql.NVarChar(150), credential)
    .query<UserRow>(`
      SELECT u.usuario_id,
             u.email,
             u.username,
             u.password_hash,
             STRING_AGG(r.codigo, ',') AS roles
      FROM dbo.Usuarios u
      LEFT JOIN dbo.UsuarioRoles ur ON ur.usuario_id = u.usuario_id
      LEFT JOIN dbo.Roles r         ON r.rol_id = ur.rol_id AND r.activo = 1
      WHERE (u.email = @credential OR u.username = @credential)
        AND u.activo = 1
      GROUP BY u.usuario_id, u.email, u.username, u.password_hash
    `);

  // An email could in theory equal another user's username: refuse rather
  // than pick one of them
  const user = result.recordset.length === 1 ? result.recordset[0] : undefined;
  // bcrypt only: argon2 hashes (also allowed by the table) never match here
  const hash = user?.password_hash.startsWith('$2') ? user.password_hash : DUMMY_HASH;
  const valid = await bcrypt.compare(password, hash);

  if (!user || hash === DUMMY_HASH || !valid) {
    throw new AuthError();
  }

  const payload: TokenPayload = {
    userId: user.usuario_id,
    email: user.email,
    username: user.username,
    rol: user.roles ? user.roles.split(',') : [],
  };

  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as jwt.SignOptions['expiresIn'],
  });
}
