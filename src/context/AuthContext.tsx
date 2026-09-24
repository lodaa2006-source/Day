import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (!isSupabaseConfigured || !supabase) {
      if (isMounted) {
        setLoading(false);
        setError('Supabase is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
      }
      return;
    }

    async function initializeAnonymousAuth() {
      if (!supabase) return;

      try {
        // 1. Check for an existing Supabase session
        const { data: { session: existingSession }, error: getSessionError } = await supabase.auth.getSession();

        if (getSessionError) {
          console.error('Error checking existing Supabase session:', getSessionError);
        }

        // 2. If a valid session exists, reuse it; do NOT create another anonymous user
        if (existingSession?.user) {
          if (isMounted) {
            setSession(existingSession);
            setUser(existingSession.user);
            setError(null);
            setLoading(false);
          }
          return;
        }

        // 3. If no session exists, call Supabase Anonymous Sign-In silently
        const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously();

        if (signInError) {
          console.error('Silent anonymous authentication failed:', signInError);
          if (isMounted) {
            setError(signInError.message);
            setSession(null);
            setUser(null);
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setSession(signInData.session);
          setUser(signInData.user);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unexpected error during silent authentication';
        console.error('Silent anonymous authentication exception:', message);
        if (isMounted) {
          setError(message);
          setSession(null);
          setUser(null);
          setLoading(false);
        }
      }
    }

    initializeAnonymousAuth();

    // Listen for auth state changes (e.g. token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (isMounted) {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    session,
    user,
    loading,
    isAuthenticated: Boolean(session?.user),
    error,
  }), [session, user, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
