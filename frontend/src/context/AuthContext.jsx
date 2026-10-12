import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService.js';
import { getErrorMessage } from '../services/api.js';

const AuthContext = createContext(null);

function dashboardPath(role) {
  if (role === 'student') return '/student/dashboard';
  if (role === 'employee') return '/employee/dashboard';
  if (role === 'admin') return '/admin/dashboard';
  return '/login';
}

function isUnauthorized(error) {
  const status = error && error.response && error.response.status;
  return status === 401 || status === 403;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCurrentUser() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await authService.getCurrentUser();
      return res.data.user;
    } catch (error) {
      if (isUnauthorized(error)) {
        return null;
      }
      if (attempt === 5) {
        throw error;
      }
      await wait(400 * (attempt + 1));
    }
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      try {
        const nextUser = await fetchCurrentUser();
        if (active) {
          setUser(nextUser);
          setLoading(false);
        }
      } catch {
        if (!active) return;
        // Keep the previous session on a brief API outage (for example the
        // backend restarting). Retry instead of sending the user to login.
        await wait(1500);
        if (active) {
          loadSession();
        }
      }
    }

    loadSession();
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      dashboardPath,
      async register(payload) {
        try {
          const res = await authService.register(payload);
          return {
            email: res.data.email || payload.email,
            message: res.data.message
          };
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Unable to create your account. Please try again.'));
        }
      },
      async login(payload) {
        try {
          const res = await authService.login(payload);
          setUser(res.data.user);
          return { user: res.data.user };
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Unable to sign in. Please try again.'));
        }
      },
      async requestOtp(email) {
        try {
          const res = await authService.requestOtp({ email });
          return res.data.message || 'OTP sent successfully.';
        } catch (error) {
          throw new Error(getErrorMessage(error, 'OTP could not be sent. Please try again.'));
        }
      },
      async verifyOtp(payload) {
        try {
          const res = await authService.verifyOtp(payload);
          setUser(res.data.user);
          return { user: res.data.user };
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Invalid or expired OTP.'));
        }
      },
      async forgotPassword(email) {
        try {
          const res = await authService.forgotPassword({ email });
          return res.data.message || 'OTP sent successfully.';
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Unable to send OTP. Please try again.'));
        }
      },
      async verifyResetOtp(payload) {
        try {
          const res = await authService.verifyResetOtp(payload);
          return {
            message: res.data.message,
            resetToken: res.data.resetToken
          };
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Invalid or expired OTP.'));
        }
      },
      async resetPassword(payload) {
        try {
          const res = await authService.resetPassword(payload);
          return res.data.message || 'Password reset successfully. Please log in.';
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Unable to reset password. Please try again.'));
        }
      },
      async logout() {
        try {
          await authService.logout();
        } catch (error) {
          // Continue local logout even if the request fails.
        }
        setUser(null);
      },
      async requestVerificationOtp(email) {
        try {
          const res = await authService.requestVerificationOtp({ email });
          return res.data.message || 'OTP sent successfully.';
        } catch (error) {
          throw new Error(getErrorMessage(error, 'OTP could not be sent. Please try again.'));
        }
      },
      async verifyEmail(payload) {
        try {
          const res = await authService.verifyEmail(payload);
          setUser(res.data.user);
          return { user: res.data.user };
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Invalid or expired OTP.'));
        }
      },
      async changePassword(payload) {
        try {
          const res = await authService.changePassword(payload);
          return res.data.message || 'Password updated successfully.';
        } catch (error) {
          throw new Error(getErrorMessage(error, 'Unable to update password. Please try again.'));
        }
      }
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
