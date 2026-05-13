import { createContext } from 'react';
import type { AuthUser } from '../types';

export interface AuthContextValue {
  user: AuthUser | null;
  loginUser: (token: string, userData: AuthUser) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

