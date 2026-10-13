import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { login } from './auth.service';
import styles from './auth.module.css';

interface LoginFormProps {
  onSuccess: (token: string) => void;
}

type Status = 'idle' | 'loading' | 'error';

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Email-or-username + password form, checked against the backend */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Ignore a response that arrives after the form has unmounted
  const mounted = useRef(true);
  const credentialId = useId();
  const passwordId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loading = status === 'loading';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setStatus('loading');
    try {
      const { token } = await login(credential.trim(), password);
      if (mounted.current) onSuccess(token);
    } catch (err) {
      if (!mounted.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
      setStatus('error');
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.formHeader}>
        <h1 className={styles.title}>Iniciar sesión</h1>
        <p className={styles.subtitle}>Ingresa tus credenciales para continuar</p>
      </div>

      {status === 'error' && (
        <div className={styles.errorBanner} role="alert">
          <AlertIcon />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={credentialId} className={styles.label}>
          Usuario o correo
        </label>
        <input
          id={credentialId}
          className={styles.input}
          type="text"
          name="credential"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="tu.usuario o correo@empresa.com"
          autoFocus
          required
          disabled={loading}
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={passwordId} className={styles.label}>
          Contraseña
        </label>
        <div className={styles.passwordWrap}>
          <input
            id={passwordId}
            className={`${styles.input} ${styles.passwordInput}`}
            type={showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            required
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className={styles.eyeButton}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={showPassword}
            aria-controls={passwordId}
            disabled={loading}
            onClick={() => setShowPassword((v) => !v)}
          >
            <EyeIcon crossed={showPassword} />
          </button>
        </div>
      </div>

      <button type="submit" className={styles.submit} disabled={loading} aria-busy={loading}>
        {loading ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            Verificando…
          </>
        ) : (
          'Iniciar sesión'
        )}
      </button>
    </form>
  );
}
