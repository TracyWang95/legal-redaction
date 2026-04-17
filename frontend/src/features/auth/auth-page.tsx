// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n';
import { useAuth } from './auth-context';

export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

function resolveNext(search: string): string {
  return sanitizeNextPath(new URLSearchParams(search).get('next'));
}

export function AuthPage() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const { status, login, setup } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSetup = status?.password_set === false;
  const next = useMemo(() => resolveNext(location.search), [location.search]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (needsSetup && password !== confirmPassword) {
      setError(t('auth.error.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      if (needsSetup) {
        await setup(password);
      } else {
        await login(password);
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_42%),linear-gradient(160deg,#f4f7f4_0%,#eef2ef_45%,#dde6df_100%)] px-6 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.04)_0%,transparent_38%,rgba(15,23,42,0.03)_100%)]" />
      <Card className="relative z-10 w-full max-w-md border-border/70 bg-background/92">
        <CardHeader className="space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-[var(--shadow-md)]">
            {needsSetup ? <ShieldCheck className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl tracking-[-0.04em]">
              {needsSetup ? t('auth.setup.title') : t('auth.login.title')}
            </CardTitle>
            <CardDescription>
              {needsSetup ? t('auth.setup.description') : t('auth.login.description')}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{t('auth.error.title')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="auth-password">{t('auth.password')}</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('auth.password.placeholder')}
                required
              />
            </div>

            {needsSetup && (
              <div className="space-y-2">
                <Label htmlFor="auth-confirm-password">{t('auth.confirmPassword')}</Label>
                <Input
                  id="auth-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t('auth.confirmPassword.placeholder')}
                  required
                />
              </div>
            )}

            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting
                ? t('auth.submitting')
                : needsSetup
                  ? t('auth.setup.submit')
                  : t('auth.login.submit')}
            </Button>

            <p className="text-sm leading-6 text-muted-foreground">
              {needsSetup ? t('auth.setup.hint') : t('auth.login.hint')}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default AuthPage;
