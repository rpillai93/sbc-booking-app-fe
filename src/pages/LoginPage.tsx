import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { login, register, resetByKey } from '../api/api';
import type { AxiosError } from 'axios';

type Mode = 'login' | 'register' | 'reset';

// ── inline SVG eye icons ──────────────────────────────────────────────────────
function EyeOpen() {
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
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeClosed() {
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
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ── Key display modal shown after register or successful reset ────────────────
function ResetKeyModal({
  resetKey,
  isNew,
  onDismiss,
}: {
  resetKey: string;
  isNew: boolean;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyKey() {
    navigator.clipboard.writeText(resetKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="lp-modal-backdrop">
      <div className="lp-modal">
        <div className="lp-modal-icon">🔑</div>
        <h2 className="lp-modal-title">
          {isNew ? 'Save your new reset key' : 'Save your reset key'}
        </h2>

        {/* Registration-specific message */}
        {!isNew && (
          <div className="lp-modal-approval-notice">
            ✅ Sign up is complete. Please contact an admin to approve your account and then proceed
            to login.
          </div>
        )}

        <p className="lp-modal-body">
          {isNew
            ? 'Your password was updated. Here is your new reset key — the old one no longer works.'
            : 'Your account has been created. Save this key somewhere safe. You will need it if you ever forget your password.'}
        </p>

        <div className="lp-key-display">
          <span className="lp-key-value">{resetKey}</span>
          <button className="lp-key-copy" onClick={copyKey}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <p className="lp-modal-warn">
          ⚠ This key will not be shown again. Write it down or copy it now.
        </p>

        <button className="lp-btn lp-modal-confirm" onClick={onDismiss}>
          I've saved my key →
        </button>
      </div>
    </div>
  );
}

// ── Pending approval modal (shown when login is blocked) ──────────────────────
function PendingApprovalModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="lp-modal-backdrop">
      <div className="lp-modal">
        <div className="lp-modal-icon">⏳</div>
        <h2 className="lp-modal-title">Awaiting admin approval</h2>
        <div className="lp-modal-approval-notice">
          Sign up is complete. Please contact an admin to approve your account and then proceed to
          login.
        </div>
        <p className="lp-modal-body">
          Your account exists but hasn't been approved yet. Once an admin activates it you'll be
          able to sign in.
        </p>
        <button className="lp-btn lp-modal-confirm" onClick={onDismiss}>
          OK, got it →
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { loginUser } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('login');

  // shared
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // register only
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactMode, setContactMode] = useState<'email' | 'phone'>('email');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // reset mode
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetKeyInput, setResetKeyInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNew, setShowConfirmNew] = useState(false);

  // modal
  const [modalKey, setModalKey] = useState<string | null>(null);
  const [modalIsNew, setModalIsNew] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const newPasswordsMatch = confirmNewPassword.length > 0 && newPassword === confirmNewPassword;
  const newPasswordsMismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login({ identifier: loginId, password });
      loginUser(res.data.token, res.data.user);
      navigate('/');
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string; code?: string }>;
      // ← detect pending-approval 403
      if (
        axiosErr.response?.status === 403 &&
        axiosErr.response?.data?.code === 'PENDING_APPROVAL'
      ) {
        setShowPendingModal(true);
      } else {
        setError(axiosErr.response?.data?.message ?? 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (contactMode === 'email' && !email) {
      setError('Please enter an email.');
      return;
    }
    if (contactMode === 'phone' && !phone) {
      setError('Please enter a phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await register({
        firstName,
        lastName,
        password,
        ...(contactMode === 'email' ? { email } : { phone }),
      });
      // Show the key modal before logging in
      setModalKey(res.data.resetKey);
      setModalIsNew(false);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await resetByKey({
        identifier: resetIdentifier,
        resetKey: resetKeyInput,
        newPassword,
      });
      setModalKey(res.data.newResetKey);
      setModalIsNew(true);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function dismissModal() {
    setModalKey(null);
    switchMode('login');
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setLoginId('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirm(false);
    setContactMode('email');
    setResetIdentifier('');
    setResetKeyInput('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowNewPassword(false);
    setShowConfirmNew(false);
  }

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          overflow-x: hidden;
          max-width: 100%;
        }

        .lp-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0d0d0d;
          font-family: 'DM Sans', sans-serif;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .lp-bg {
          position: absolute;
          inset: 0;
          opacity: 0.04;
          background-image:
            linear-gradient(#e8f5e9 1px, transparent 1px),
            linear-gradient(90deg, #e8f5e9 1px, transparent 1px);
          background-size: 48px 48px;
        }

        .lp-glow {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%);
          top: -100px;
          right: -100px;
          pointer-events: none;
        }

        .lp-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          background: #161616;
          border: 1px solid #2a2a2a;
          border-radius: 20px;
          padding: 32px 20px;
          box-shadow: 0 40px 80px rgba(0,0,0,0.6);
          animation: cardIn 0.5s cubic-bezier(0.16,1,0.3,1) both;
        }

        @keyframes cardIn {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .lp-shuttle { font-size: 32px; margin-bottom: 12px; }

        .lp-title {
          font-family: 'Syne', sans-serif;
          font-size: 26px;
          font-weight: 800;
          color: #f0f0f0;
          margin-bottom: 4px;
          letter-spacing: -0.5px;
        }

        .lp-subtitle { font-size: 13px; color: #666; margin-bottom: 32px; }

        .lp-tabs {
          display: flex;
          background: #1e1e1e;
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 28px;
          gap: 4px;
        }

        .lp-tab {
          flex: 1;
          padding: 9px;
          border: none;
          background: transparent;
          color: #555;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lp-tab.active { background: #22c55e; color: #000; font-weight: 600; }

        .lp-name-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 16px;
        }

        .lp-field { margin-bottom: 16px; }

        .lp-label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          color: #888;
          margin-bottom: 6px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }

        .lp-pw-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .lp-input {
          width: 100%;
          padding: 12px 14px;
          background: #1e1e1e;
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          color: #f0f0f0;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .lp-input:focus { border-color: #22c55e; }
        .lp-input::placeholder { color: #444; }
        .lp-pw-wrap .lp-input { padding-right: 44px; }
        .lp-input.match    { border-color: #22c55e; }
        .lp-input.mismatch { border-color: #ef4444; }

        /* Reset key input — monospace, larger, spaced */
        .lp-input.key-input {
          font-family: 'Courier New', monospace;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 6px;
          text-transform: uppercase;
          text-align: center;
          color: #22c55e;
        }
        .lp-input.key-input::placeholder {
          font-size: 13px;
          letter-spacing: 1px;
          color: #444;
          font-weight: 400;
          text-transform: none;
        }

        .lp-eye-btn {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          color: #555;
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s;
          width: auto;
          margin: 0;
          line-height: 1;
          flex-shrink: 0;
        }
        .lp-eye-btn:hover { color: #bbb; }

        .lp-pw-hint {
          font-size: 11px;
          margin-top: 5px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .lp-pw-hint.match    { color: #22c55e; }
        .lp-pw-hint.mismatch { color: #ef4444; }

        .lp-error {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.3);
          color: #f87171;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .lp-btn {
          width: 100%;
          padding: 13px;
          background: #22c55e;
          color: #000;
          border: none;
          border-radius: 10px;
          font-family: 'Syne', sans-serif;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          margin-top: 8px;
          transition: opacity 0.2s, transform 0.1s;
          letter-spacing: 0.2px;
        }
        .lp-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        .lp-btn:active:not(:disabled) { transform: translateY(0); }
        .lp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* "Forgot password?" link */
        .lp-forgot {
          display: block;
          text-align: right;
          font-size: 12px;
          color: #22c55e;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          margin-top: -8px;
          margin-bottom: 16px;
          font-family: 'DM Sans', sans-serif;
          text-decoration: underline;
          text-underline-offset: 2px;
          opacity: 0.8;
          transition: opacity 0.15s;
        }
        .lp-forgot:hover { opacity: 1; }

        /* Reset mode back link */
        .lp-back-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #555;
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          margin-bottom: 20px;
          font-family: 'DM Sans', sans-serif;
          transition: color 0.15s;
        }
        .lp-back-link:hover { color: #aaa; }

        .lp-reset-info {
          background: rgba(34,197,94,0.07);
          border: 1px solid rgba(34,197,94,0.2);
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 12px;
          color: #888;
          line-height: 1.6;
          margin-bottom: 20px;
        }
        .lp-reset-info strong { color: #22c55e; }

        .lp-footer { text-align: center; margin-top: 20px; font-size: 12px; color: #444; }

        /* ── Modal ── */
        .lp-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .lp-modal {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 20px;
          padding: 36px 32px;
          max-width: 380px;
          width: 100%;
          box-shadow: 0 40px 80px rgba(0,0,0,0.8);
          animation: slideUp 0.3s cubic-bezier(0.16,1,0.3,1);
          text-align: center;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .lp-modal-icon { font-size: 40px; margin-bottom: 16px; }

        .lp-modal-title {
          font-family: 'Syne', sans-serif;
          font-size: 20px;
          font-weight: 800;
          color: #f0f0f0;
          margin-bottom: 10px;
          letter-spacing: -0.3px;
        }

        .lp-modal-body {
          font-size: 13px;
          color: #777;
          line-height: 1.6;
          margin-bottom: 24px;
        }

        .lp-key-display {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #0d0d0d;
          border: 1px solid #22c55e44;
          border-radius: 12px;
          padding: 16px 20px;
          margin-bottom: 16px;
        }

        .lp-key-value {
          font-family: 'Courier New', monospace;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: 5px;
          color: #22c55e;
          user-select: all;
          word-break: break-all;
        }

        .lp-key-copy {
          background: #22c55e22;
          border: 1px solid #22c55e44;
          border-radius: 6px;
          color: #22c55e;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 6px 10px;
          font-family: 'DM Sans', sans-serif;
          transition: background 0.15s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .lp-key-copy:hover { background: #22c55e44; }

        .lp-modal-warn {
          font-size: 12px;
          color: #e4a43a;
          margin-bottom: 24px;
          line-height: 1.5;
        }

        .lp-modal-approval-notice {
          background: rgba(34,197,94,0.1);
          border: 1px solid rgba(34,197,94,0.3);
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 13px;
          color: #4ade80;
          line-height: 1.6;
          margin-bottom: 16px;
          font-weight: 500;
      }

        .lp-modal-confirm { margin-top: 0; }
      `}</style>

      <div className="lp-root">
        <div className="lp-bg" />
        <div className="lp-glow" />

        {/* Reset key modal */}
        {modalKey && (
          <ResetKeyModal resetKey={modalKey} isNew={modalIsNew} onDismiss={dismissModal} />
        )}
        {/* ← new: pending approval modal */}
        {showPendingModal && <PendingApprovalModal onDismiss={() => setShowPendingModal(false)} />}

        <div className="lp-card">
          <div className="lp-shuttle">🏸</div>
          <h1 className="lp-title">SBC Badminton</h1>
          <p className="lp-subtitle">Surrey Badminton Club · Booking Portal</p>

          {/* ── mode tabs (only login / register) ── */}
          {mode !== 'reset' && (
            <div className="lp-tabs">
              <button
                className={`lp-tab ${mode === 'login' ? 'active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Sign In
              </button>
              <button
                className={`lp-tab ${mode === 'register' ? 'active' : ''}`}
                onClick={() => switchMode('register')}
              >
                Register
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════ LOGIN ══════════════════ */}
          {mode === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="lp-field">
                <label className="lp-label">Email or Phone</label>
                <input
                  className="lp-input"
                  type="text"
                  placeholder="you@email.com or +1 888 888 8888"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="lp-field">
                <label className="lp-label">Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className="lp-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOpen /> : <EyeClosed />}
                  </button>
                </div>
              </div>

              {/* Forgot password link */}
              <button type="button" className="lp-forgot" onClick={() => switchMode('reset')}>
                Forgot password?
              </button>

              {error && <div className="lp-error">⚠ {error}</div>}

              <button className="lp-btn" type="submit" disabled={loading}>
                {loading ? 'Please wait...' : 'Sign In →'}
              </button>
            </form>
          )}

          {/* ══════════════════════════════════════════ REGISTER ═══════════════ */}
          {mode === 'register' && (
            <form onSubmit={handleRegister}>
              <div className="lp-name-row">
                <div>
                  <label className="lp-label">First Name</label>
                  <input
                    className="lp-input"
                    type="text"
                    placeholder="Jane"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="lp-label">Last Name</label>
                  <input
                    className="lp-input"
                    type="text"
                    placeholder="Smith"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Contact method toggle */}
              <div className="lp-tabs" style={{ marginBottom: '12px' }}>
                <button
                  type="button"
                  className={`lp-tab ${contactMode === 'email' ? 'active' : ''}`}
                  onClick={() => setContactMode('email')}
                >
                  Use Email
                </button>
                <button
                  type="button"
                  className={`lp-tab ${contactMode === 'phone' ? 'active' : ''}`}
                  onClick={() => setContactMode('phone')}
                >
                  Use Phone
                </button>
              </div>

              {contactMode === 'email' ? (
                <div className="lp-field">
                  <label className="lp-label">Email</label>
                  <input
                    className="lp-input"
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              ) : (
                <div className="lp-field">
                  <label className="lp-label">Phone Number</label>
                  <input
                    className="lp-input"
                    type="tel"
                    placeholder="+1-888-888-8888"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="lp-field">
                <label className="lp-label">Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className="lp-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOpen /> : <EyeClosed />}
                  </button>
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-label">Confirm Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className={`lp-input${passwordsMatch ? ' match' : passwordsMismatch ? ' mismatch' : ''}`}
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    tabIndex={-1}
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOpen /> : <EyeClosed />}
                  </button>
                </div>
                {passwordsMatch && <p className="lp-pw-hint match">✓ Passwords match</p>}
                {passwordsMismatch && (
                  <p className="lp-pw-hint mismatch">✗ Passwords do not match</p>
                )}
              </div>

              {error && <div className="lp-error">⚠ {error}</div>}

              <button className="lp-btn" type="submit" disabled={loading || passwordsMismatch}>
                {loading ? 'Please wait...' : 'Create Account →'}
              </button>
            </form>
          )}

          {/* ══════════════════════════════════════════ RESET ══════════════════ */}
          {mode === 'reset' && (
            <form onSubmit={handleReset}>
              <button type="button" className="lp-back-link" onClick={() => switchMode('login')}>
                ← Back to Sign In
              </button>

              <div className="lp-reset-info">
                Enter your <strong>email or phone</strong> and the{' '}
                <strong>6-character reset key</strong> you received when you registered.
                <br />
                Lost your key? Contact an admin to retrieve it.
              </div>

              <div className="lp-field">
                <label className="lp-label">Email or Phone</label>
                <input
                  className="lp-input"
                  type="text"
                  placeholder="you@email.com or +1 888 888 8888"
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="lp-field">
                <label className="lp-label">Reset Key</label>
                <input
                  className="lp-input key-input"
                  type="text"
                  placeholder="e.g. X78A30"
                  maxLength={6}
                  value={resetKeyInput}
                  onChange={(e) => setResetKeyInput(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="lp-field">
                <label className="lp-label">New Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className="lp-input"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    tabIndex={-1}
                    onClick={() => setShowNewPassword((v) => !v)}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOpen /> : <EyeClosed />}
                  </button>
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-label">Confirm New Password</label>
                <div className="lp-pw-wrap">
                  <input
                    className={`lp-input${newPasswordsMatch ? ' match' : newPasswordsMismatch ? ' mismatch' : ''}`}
                    type={showConfirmNew ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-eye-btn"
                    tabIndex={-1}
                    onClick={() => setShowConfirmNew((v) => !v)}
                    aria-label={showConfirmNew ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmNew ? <EyeOpen /> : <EyeClosed />}
                  </button>
                </div>
                {newPasswordsMatch && <p className="lp-pw-hint match">✓ Passwords match</p>}
                {newPasswordsMismatch && (
                  <p className="lp-pw-hint mismatch">✗ Passwords do not match</p>
                )}
              </div>

              {error && <div className="lp-error">⚠ {error}</div>}

              <button
                className="lp-btn"
                type="submit"
                disabled={loading || newPasswordsMismatch || resetKeyInput.length < 6}
              >
                {loading ? 'Please wait...' : 'Reset Password →'}
              </button>
            </form>
          )}

          <p className="lp-footer">SBC Surrey | Tuesday 6–8PM | Friday 8–10PM | Sunday 6–8PM</p>
        </div>
      </div>
    </>
  );
}
