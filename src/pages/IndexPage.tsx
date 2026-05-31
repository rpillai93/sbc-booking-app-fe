import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { getSlots, updatePlayer, updatePayment, getSelf } from '../api/api';
import type { Slot, Player, GroupedSlots, User } from '../types';
import type { AxiosError } from 'axios';

// ─── tiny modal hook ────────────────────────────────────────────────────────
interface ModalState {
  open: boolean;
  message: string;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | null;
  hideCancel: boolean;
  confirmLabel: string;
  confirmColor: string;
}
const CLOSED_MODAL: ModalState = {
  open: false,
  message: '',
  onConfirm: null,
  onCancel: null,
  hideCancel: false,
  confirmLabel: 'Confirm',
  confirmColor: '#dc2626',
};

// ─── helpers ────────────────────────────────────────────────────────────────
function emptyPlayer(): Player {
  return {
    _id: '',
    name: '',
    ownerIdentifier: '',
    ownerName: '',
    lastUpdatedIdentifier: '',
    timeStamp: '',
    payment: false,
    playerAmt: 0,
  };
}

function isBlank(p: Player) {
  return !p.name || p.name === '' || p.name === 'Available' || p.name === 'Waitlist';
}

// Converts stored timestamp to short format: "2:21pm · May 10"
function formatTimestamp(ts: string): string {
  if (!ts) return '';
  // stored format from backend: " 2:21:00 p.m., 2026-05-10"
  // or similar locale string — parse what we can
  try {
    const date = new Date(ts.trim());
    if (isNaN(date.getTime())) {
      // backend stores as a formatted string, not ISO — return trimmed as-is
      // but strip the year and seconds for brevity
      return ts
        .replace(/:\d{2}\s*(a\.m\.|p\.m\.)/, (m) =>
          m
            .replace(/:\d{2}/, '')
            .replace(/\./g, '')
            .trim(),
        )
        .replace(/,?\s*\d{4}/, '')
        .trim();
    }
    const time = date
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .toLowerCase();
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${time} · ${day}`;
  } catch {
    return ts;
  }
}

export default function IndexPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [groupedSlots, setGroupedSlots] = useState<GroupedSlots>({});
  const [loading, setLoading] = useState(true);
  const [loaderMsg, setLoaderMsg] = useState('Loading bookings...');
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const [editingKey, setEditingKey] = useState<string | null>(null); // "slotId_playerIndex"
  const [editValue, setEditValue] = useState('');
  const [selfUser, setSelfUser] = useState<User | null>(null);

  // ── fetch ─────────────────────────────────────────────────────────────────
  const fetchSelf = useCallback(async () => {
    try {
      const res = await getSelf();
      setSelfUser(res.data.user);
    } catch {
      // silently fail
    }
  }, []);

  const fetchSlots = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoaderMsg('Loading bookings...');
      setLoading(true);
    }

    try {
      const res = await getSlots();
      setGroupedSlots(res.data.groupedSlots);
    } catch {
      showOkayMsg('Failed to load bookings. Please refresh.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchSlots();
    fetchSelf();
  }, [fetchSlots, fetchSelf]);

  // ── okay helper (wrapped by confirm helper)──────────────────────────────
  function showOkayMsg(
    message: string,
    onConfirm?: () => void,
    onCancel?: () => void,
    hideCancel?: boolean,
    confirmLabel = 'Okay',
    confirmColor = '#dc2626',
  ) {
    setModal({
      open: true,
      message,
      onConfirm: onConfirm ?? null,
      onCancel: onCancel ?? null,
      hideCancel: hideCancel ?? true,
      confirmLabel,
      confirmColor,
    });
  }

  // ── confirm modal helpers ─────────────────────────────────────────────────
  function confirm(
    message: string,
    onConfirm?: () => void,
    onCancel?: () => void,
    hideCancel?: boolean,
    confirmLabel = 'Remove',
    confirmColor = '#dc2626',
  ) {
    setModal({
      open: true,
      message,
      onConfirm: onConfirm ?? null,
      onCancel: onCancel ?? null,
      hideCancel: hideCancel ?? false,
      confirmLabel,
      confirmColor,
    });
  }

  // ── update player ─────────────────────────────────────────────────────────
  async function doUpdatePlayer(slotId: string, idx: number, name: string, lastUpdatedAt: string) {
    setLoaderMsg('Updating booking...');
    setLoading(true);
    setEditingKey(null);

    try {
      await updatePlayer(slotId, { playerIndex: idx, name, lastUpdatedAt });
      await fetchSlots(true);
    } catch (err) {
      const msg =
        (err as AxiosError<{ message: string }>).response?.data?.message ?? 'Update failed';
      showOkayMsg(msg);
      await fetchSlots(true);
    } finally {
      setLoading(false);
    }
  }

  // ── update payment ────────────────────────────────────────────────────────
  async function doUpdatePayment(slotId: string, idx: number, lastUpdatedAt: string) {
    setLoaderMsg('Confirming payment...');
    setLoading(true);
    try {
      await updatePayment(slotId, { playerIndex: idx, lastUpdatedAt });
      await fetchSlots(true);
      fetchSelf();
    } catch (err) {
      const msg =
        (err as AxiosError<{ message: string }>).response?.data?.message ?? 'Payment update failed';
      showOkayMsg(msg);
      await fetchSlots(true);
    } finally {
      setLoading(false);
    }
  }

  // ── inline edit flow ──────────────────────────────────────────────────────
  function startEdit(slot: Slot, idx: number) {
    if (editingKey) return;
    const key = `${slot._id}_${idx}`;
    const isWl = idx >= slot.players.length;
    const p = isWl ? slot.waitList[idx - slot.players.length] : slot.players[idx];
    setEditValue(isBlank(p) ? '' : p.name);
    setEditingKey(key);
  }

  function commitEdit(slot: Slot, idx: number) {
    const trimmed = editValue.trim();
    const isWl = idx >= slot.players.length;
    const p = isWl ? slot.waitList[idx - slot.players.length] : slot.players[idx];
    const original = isBlank(p) ? '' : p.name;

    if (trimmed === original) {
      setEditingKey(null);
      return;
    }

    const isDelete = !trimmed;
    const isMainPlayer = idx < slot.players.length;

    const suffix =
      isDelete && isMainPlayer
        ? '<br/><small><b>NOTE:</b> Waitlist players will be promoted automatically.</small>'
        : '';

    confirm(
      `${
        isDelete ? 'Remove player from' : `Confirm slot for <b>${trimmed}</b> —`
      } ${isDelete ? `slot?${suffix}` : 'confirm?'}`,
      () => doUpdatePlayer(slot._id, idx, trimmed, slot.updatedAt),
      undefined,
      false,
      isDelete ? 'Remove' : 'Confirm',
      isDelete ? '#dc2626' : '#16a34a',
    );

    setEditingKey(null);
  }

  // ── render player row ─────────────────────────────────────────────────────
  function renderPlayer(slot: Slot, globalIdx: number) {
    const isWl = globalIdx >= slot.players.length;
    const localIdx = isWl ? globalIdx - slot.players.length : globalIdx;
    const p: Player = isWl
      ? (slot.waitList[localIdx] ?? emptyPlayer())
      : (slot.players[localIdx] ?? emptyPlayer());

    const isAdmin = selfUser?.role === 'admin';
    const showTs = p.ownerIdentifier == selfUser?.email || p.ownerIdentifier == selfUser?.phone;
    const label = isWl ? `WL${localIdx + 1}` : `P${globalIdx + 1}`;
    const blank = isBlank(p);
    const key = `${slot._id}_${globalIdx}`;
    const isEditingThis = editingKey === key;
    const locked = slot.slotLocked;
    const paymentCheckDisabled =
      blank ||
      !locked ||
      p.playerAmt == null ||
      p.playerAmt < 0 ||
      (p.playerAmt == 0 && slot.slotAmountPublished) ||
      p.payment;

    let nameClass = 'ip-name';
    if (!isWl) nameClass += blank ? ' available' : ' filled';
    else nameClass += blank ? ' wl-empty' : ' wl-filled';
    const playerAmtToShow =
      !blank && slot.slotAmountPublished && slot.slotLocked
        ? p.playerAmt > 0
          ? `$${p.playerAmt}`
          : `-$${Math.abs(p.playerAmt)}`
        : '';
    return (
      <div key={key} className={`ip-player-row${locked ? ' ip-locked' : ''}`}>
        {/* label */}
        <div className="ip-col-label">{label}</div>

        {/* name / input */}
        <div className="ip-col-name">
          {isEditingThis && !locked ? (
            <input
              className="ip-inline-input"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit(slot, globalIdx);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingKey(null);
                }
              }}
              onBlur={() => {
                setTimeout(() => commitEdit(slot, globalIdx), 120);
              }}
            />
          ) : (
            <div
              className={nameClass}
              onClick={() => {
                if (!locked && !editingKey) startEdit(slot, globalIdx);
              }}
              style={{ cursor: locked ? 'default' : 'pointer' }}
            >
              {blank ? (isWl ? 'Waitlist' : 'Available') : p.name}
            </div>
          )}
        </div>

        {/* booked by + timestamp — combined column */}
        <div className="ip-col-ts">
          {blank ? (
            ''
          ) : (
            <>
              <span className="ip-col-ts-name">
                {showTs ? '✅' : isAdmin ? p.ownerName || '' : ''}
              </span>
              <span className="ip-col-ts-time">
                {showTs || isAdmin ? formatTimestamp(p.timeStamp) : ''}
              </span>
            </>
          )}
        </div>

        {/* amount + payment checkbox stacked */}
        <div className="ip-col-pay">
          <div className="ip-pay-stack">
            {/* amount — only show when a real amount exists */}
            <span
              className="ip-player-amt"
              style={{
                color: p.playerAmt > 0 && !p.payment ? '#f59e0b' : '#22c55e',
              }}
            >
              {p.payment || p.playerAmt < 0 || (p.playerAmt == 0 && slot.slotAmountPublished) ? (
                <s>{playerAmtToShow}</s>
              ) : (
                playerAmtToShow
              )}
            </span>
            <input
              type="checkbox"
              checked={
                p.payment || p.playerAmt < 0 || (p.playerAmt == 0 && slot.slotAmountPublished)
              }
              disabled={paymentCheckDisabled}
              style={{
                cursor: paymentCheckDisabled ? 'not-allowed' : 'pointer',
                opacity: paymentCheckDisabled ? 0.3 : 1,
              }}
              onChange={(e) => {
                const checked = e.target.checked;
                const prev = !checked;
                const amt = p.playerAmt > 0 ? `$${p.playerAmt}` : `-$${p.playerAmt}`;
                confirm(
                  checked
                    ? `Confirm payment of <b>${amt}</b> by <b>${p.name}</b>?`
                    : `Remove payment of <b>${amt}</b> by <b>${p.name}</b>?`,
                  () => doUpdatePayment(slot._id, globalIdx, slot.updatedAt),
                  () => {
                    e.target.checked = prev;
                  },
                  false,
                  checked ? 'Confirm' : 'Remove',
                  checked ? '#16a34a' : '#dc2626',
                );
              }}
            />
          </div>
        </div>

        {/* remove */}
        <div className="ip-col-remove">
          {!blank && (
            <button
              className="ip-remove-btn"
              disabled={locked}
              onClick={() => {
                const suffix =
                  globalIdx < slot.players.length
                    ? '<small><br><b>NOTE:</b> You cannot undo this action. If there are players in waitlist, they will be given preference. Speak to an admin for any changes.</small>'
                    : '';
                confirm(
                  `Remove <b>${p.name}</b> from <b>${slot.date}, ${slot.time}</b>?${suffix}`,
                  () => doUpdatePlayer(slot._id, globalIdx, '', slot.updatedAt),
                );
              }}
            >
              ❌
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #0d0d0d; }
        
        html, body {
          overflow-x: hidden;
          max-width: 100%;
        }

        .ip-root {
        min-height: 100vh;
        background: #0d0d0d;
        font-family: 'DM Sans', sans-serif;
        color: #e0e0e0;
        }

        /* ── top bar ── */
        .ip-topbar {
          background: #111;
          border-bottom: 1px solid #222;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 100;
          flex-wrap: wrap;  
          gap: 8px;
        }

        .ip-topbar-brand {
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 17px;
          letter-spacing: -0.3px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ip-topbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .ip-topbar-label {
          font-size: 12px;
          color: #555;
        }

        .ip-topbar-email {
          font-size: 14px;
          color: #fff;
        }

        .ip-admin-btn {
          background: #22c55e;
          color: #000;
          border: none;
          border-radius: 7px;
          padding: 7px 13px;
          font-family: 'Syne', sans-serif;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .ip-admin-btn:hover { opacity: 0.85; }

        .ip-logout-btn {
          background: transparent;
          color: #666;
          border: 1px solid #333;
          border-radius: 7px;
          padding: 7px 13px;
          font-size: 12px;
          cursor: pointer;
          transition: color 0.2s, border-color 0.2s;
          width: auto;
          margin: 0;
        }
        .ip-logout-btn:hover { color: #fff; border-color: #666; }

        /* ── container ── */
        .ip-container {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px 16px 40px;
        }

        /* ── rules card ── */
        .ip-card {
          background: #161616;
          border: 1px solid #2a2a2a;
          border-radius: 16px;
          padding: 16px 18px;
          margin-bottom: 14px;
        }

        .ip-rules-summary {
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          list-style: none;
          user-select: none;
        }
        .ip-rules-summary::-webkit-details-marker { display: none; }

        .ip-rules-title {
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          font-size: 16px;
          color: #f0f0f0;
        }

        .ip-rules-arrow {
          transition: transform 0.25s;
          color: #666;
          font-size: 12px;
        }
        details[open] .ip-rules-arrow { transform: rotate(180deg); }

        .ip-rules-body { margin-top: 14px; }
        .ip-rules-body h4 {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #e0e0e0;
          margin: 12px 0 6px;
        }
        .ip-rules-body ul { padding-left: 16px; }
        .ip-rules-body li { font-size: 13px; color: #888; margin-bottom: 4px; line-height: 1.5; }

        /* ── bookings card ── */
        .ip-bookings-title {
          font-family: 'Syne', sans-serif;
          font-size: 18px;
          font-weight: 700;
          color: #f0f0f0;
          margin-bottom: 16px;
        }

        /* ── booking group ── */
        .ip-group { margin-bottom: 22px; }

        .ip-group-label {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #22c55e;
          padding: 8px 0;
          border-bottom: 1px solid #1e1e1e;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ip-group-label-disabled {
        color: #888;
        }

        /* ── court ── */
        .ip-court {
          background: #161616;
          border: 1px solid #232323;
          border-radius: 14px;
          padding: 14px;
          margin-bottom: 10px;
          transition: border-color 0.2s;
        }
        .ip-court:hover { border-color: #333; }

        .ip-court-title {
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          font-size: 14px;
          color: #f0f0f0;
          margin-bottom: 6px;
        }

        .ip-locked-msg {
          font-size: 12px;
          color: #dc2626;
          margin-bottom: 6px;
        }

        .ip-payment-info {
          font-size: 12px;
          font-weight: 500;
          color: #3730a3;
          background: #eef2ff;
          padding: 8px 12px;
          border-radius: 8px;
          margin-bottom: 10px;
          line-height: 1.6;
        }

        /* ── grid ── */
        .ip-grid-header, .ip-player-row {
          display: grid;
          grid-template-columns: 48px 1fr 100px 80px 56px;
          align-items: center;
          column-gap: 8px;
        }

        .ip-grid-header {
          font-size: 11px;
          font-weight: 600;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 8px 6px;
          border-bottom: 1px solid #222;
          margin-bottom: 6px;
          text-align: center;
        }
        .ip-grid-header > div { display: flex; justify-content: center; align-items: center; }

        .ip-player-row {
          padding: 10px 6px;
          border-radius: 10px;
          background: #1a1a1a;
          margin-bottom: 6px;
        }

        .ip-player-row.ip-locked .ip-col-label,
        .ip-player-row.ip-locked .ip-col-name,
        .ip-player-row.ip-locked .ip-col-ts,
        .ip-player-row.ip-locked .ip-col-remove {
          opacity: 0.35;
        }

        /* checkbox column stays at full opacity always */
        .ip-player-row.ip-locked .ip-col-pay {
          opacity: 1;
        }

        .ip-col-label { font-size: 12px; color: #9ca3af; text-align: center; }
        .ip-col-name {min-width: 0;}
        .ip-col-ownerName { font-size: 10px; color: #9ca3af; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ip-col-ts { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
        .ip-col-ts-name { font-size: 11px; font-weight: 600; color: #d0d0d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .ip-col-ts-time { font-size: 10px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .ip-col-pay { display: flex; justify-content: center; }
        .ip-col-remove { display: flex; justify-content: center; }

        /* stacks amount label above the checkbox */
        .ip-pay-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
        }

        .ip-player-amt {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.2px;
          min-height: 14px; /* keeps row height stable when no amount */
          line-height: 1;
        }

        .ip-name {
          font-size: 13px;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 999px;
          text-align: center;
          transition: opacity 0.15s;
          display: block;
          width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ip-name:hover { opacity: 0.8; }
        .ip-name.available { background: #dcfce7; color: #166534; }
        .ip-name.filled    { background: #ffedd5; color: #9a3412; }
        .ip-name.wl-empty  { background: #f3f4f6; color: #9ca3af; }
        .ip-name.wl-filled { background: #dbeafe; color: #1e3a8a; }

        .ip-inline-input {
          width: 100%;
          padding: 5px 10px;
          border: 2px solid #22c55e;
          border-radius: 999px;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          outline: none;
          background: #111;
          color: #f0f0f0;
        }

        .ip-remove-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 14px;
          width: auto;
          margin: 0;
          padding: 4px;
          opacity: 0.7;
          transition: opacity 0.15s;
        }
        .ip-remove-btn:hover { opacity: 1; }
        .ip-remove-btn:disabled { opacity: 0.2; cursor: not-allowed; }

        /* ── empty state ── */
        .ip-empty { font-size: 14px; color: #444; padding: 20px 0; text-align: center; }

        /* ── loader overlay ── */
        .ip-loader {
          position: fixed;
          inset: 0;
          background: rgba(13,13,13,0.85);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          gap: 12px;
        }
        .ip-spinner {
          width: 28px; height: 28px;
          border: 3px solid #ddd;
          border-top-color: #22c55e;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ip-loader-msg { font-size: 14px; color: #555; }

        /* ── modals ── */
        .ip-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9998;
          padding: 16px;
        }
        .ip-modal {
          background: #161616;
          border: 1px solid #2a2a2a;
          border-radius: 14px;
          padding: 20px;
          max-width: 360px;
          width: 100%;
          box-shadow: 0 30px 80px rgba(0,0,0,0.6);
          text-align: center;
        }
        .ip-modal-msg { font-size: 14px; color: #ccc; margin-bottom: 18px; line-height: 1.6; }
        .ip-modal-btns { display: flex; gap: 10px; }
        .ip-modal-btn {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 8px;
          font-family: 'Syne', sans-serif;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.15s;
          width: auto;
          margin: 0;
        }
        .ip-modal-btn:hover { opacity: 0.85; }
        .ip-modal-cancel { background: #2a2a2a; color: #aaa; }

        @media (max-width: 600px) {
            .ip-grid-header, .ip-player-row {
                grid-template-columns: 36px 1fr 80px 52px 40px;
                column-gap: 5px;
            }
            .ip-name {
              padding: 5px 7px;
              font-size: 12px;
            }
            .ip-col-ts-name { font-size: 10px; }
            .ip-col-ts-time { font-size: 9px; }
            .ip-topbar { padding: 10px 14px; }
            .ip-topbar-brand { font-size: 15px; }
        }
      `}</style>

      {/* Loader */}
      {loading && (
        <div className="ip-loader">
          <div className="ip-spinner" />
          <span className="ip-loader-msg">{loaderMsg}</span>
        </div>
      )}

      {/* Confirm modal */}
      {modal.open && (
        <div className="ip-modal-backdrop">
          <div className="ip-modal">
            <div className="ip-modal-msg" dangerouslySetInnerHTML={{ __html: modal.message }} />
            <div className="ip-modal-btns">
              <button
                className="ip-modal-btn"
                style={{ background: modal.confirmColor, color: '#fff' }}
                onClick={() => {
                  setModal(CLOSED_MODAL);
                  modal.onConfirm?.();
                }}
              >
                {modal.confirmLabel}
              </button>
              {!modal.hideCancel && (
                <button
                  className="ip-modal-btn ip-modal-cancel"
                  onClick={() => {
                    setModal(CLOSED_MODAL);
                    modal.onCancel?.();
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="ip-root">
        {/* Top bar */}
        <div className="ip-topbar">
          <div className="ip-topbar-brand">🏸 SBC Badminton</div>
          <div className="ip-topbar-right">
            {selfUser?.balancePayments !== undefined && (
              <>
                <span className="ip-topbar-label">Outstanding Payments:</span>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: selfUser && selfUser.balancePayments > 0 ? '#f59e0b' : '#22c55e',
                  }}
                >
                  {selfUser && selfUser.balancePayments
                    ? selfUser.balancePayments > 0
                      ? `$${Math.round(selfUser.balancePayments * 100) / 100}`
                      : `-$${Math.round(Math.abs(selfUser.balancePayments) * 100) / 100}`
                    : `$0`}
                </span>
              </>
            )}
            <span className="ip-topbar-label">Logged in as:</span>
            <span className="ip-topbar-email">{user?.name}</span>
            {user?.role === 'admin' && (
              <button className="ip-admin-btn" onClick={() => navigate('/admin')}>
                📅 Admin
              </button>
            )}
            <button className="ip-logout-btn" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>

        <div className="ip-container">
          {/* Rules */}
          <div className="ip-card">
            <details>
              <summary className="ip-rules-summary">
                <span className="ip-rules-title">📜 Badminton Group Rules</span>
                <span className="ip-rules-arrow">▼</span>
              </summary>
              <div className="ip-rules-body">
                <h4>1. Cancellation Policy</h4>
                <ul>
                  <li>
                    Slots will lock 24 hours before play → Contact admins on WhatsApp group for any
                    changes.
                  </li>
                  <li>Cancellation or replacement more than 24 hours before → permitted</li>
                  <li>Cancellation under 24 hours → must find replacement or pay</li>
                  <li>Replacement must be confirmed with admins, not just informed</li>
                  <li>No frequent last-minute cancellations</li>
                </ul>
                <h4>2. No-Show Policy</h4>
                <ul>
                  <li>No-show without notice = full payment required</li>
                </ul>
                <h4>3. Payment Rule</h4>
                <ul>
                  <li>Payment must be completed within 24 hours after play</li>
                  <li>Please tick "Payment" checkbox after sending payment</li>
                  <li>
                    If one account is used to add family or friends, this account is responsible for
                    tracking payment on this site
                  </li>
                </ul>
                <h4>4. Player Limit</h4>
                <ul>
                  <li>1 or 2 courts booked → Max 6 players per court</li>
                  <li>More than 2 courts → Max 7 players per court</li>
                </ul>
                <h4>5. Gameplay & Rotation</h4>
                <ul>
                  <li>All skill levels welcome · Rotate after 2 games</li>
                  <li>No fixed groups · Be fair and inclusive</li>
                </ul>
                <h4>6. Waitlist System</h4>
                <ul>
                  <li>Waitlist applies when full · First come first serve</li>
                  <li>Cancelling player automatically replaces a player in waitlist</li>
                </ul>
                <h4>7. Schedule & Location</h4>
                <ul>
                  <li>
                    Tuesdays: 6–8 PM (1 court) · Sundays: 6–8 PM (3 courts) - Subject to change
                    based on availability.
                  </li>
                  <li>Location: Surrey Badminton Club, 19025 52 Ave, Surrey, BC</li>
                </ul>
                <h4>8. Equipment</h4>
                <ul>
                  <li>Yonex Mavis 350 birdies · Track usage responsibly</li>
                </ul>
                <h4>9. Conduct</h4>
                <ul>
                  <li>Self-managed group · Be respectful · Keep games fun</li>
                </ul>
              </div>
            </details>
          </div>

          {/* Bookings */}
          <div className="ip-card">
            <h2 className="ip-bookings-title">📅 This Week's Bookings</h2>

            {Object.keys(groupedSlots).length === 0 && !loading ? (
              <p className="ip-empty">No bookings available this week.</p>
            ) : (
              Object.entries(groupedSlots)
                .sort(([, aSlots], [, bSlots]) => {
                  const a = new Date(`${aSlots[0].date} ${aSlots[0].time.split('–')[0].trim()}`);
                  const b = new Date(`${bSlots[0].date} ${bSlots[0].time.split('–')[0].trim()}`);
                  return a.getTime() - b.getTime();
                })
                .map(([key, slots]) => {
                  const visibleSlots = slots.filter((s) => !s.slotHidden);
                  if (visibleSlots.length === 0) return null;
                  const isAllSlotsLocked = slots.findIndex((s) => !s.slotLocked) == -1;
                  const first = slots[0];
                  return (
                    <div key={key} className="ip-group">
                      {isAllSlotsLocked ? (
                        <div className="ip-group-label ip-group-label-disabled">
                          {first.date} <br /> {first.time} <br /> {first.numberOfCourts} Court(s)
                        </div>
                      ) : (
                        <div className="ip-group-label">
                          {first.date} <br /> {first.time} <br /> {first.numberOfCourts} Court(s) -
                          Max {first.players.length} per court
                        </div>
                      )}
                      {visibleSlots.map((slot, courtIdx) => (
                        <div key={slot._id} className="ip-court">
                          <div className="ip-court-title">
                            Court {slot.courtNo > 0 ? slot.courtNo : courtIdx + 1}: Max.{' '}
                            {slot.players.length} Players
                          </div>

                          {slot.slotLocked && slot.slotAmountPublished && (
                            <>
                              <div className="ip-locked-msg">
                                ⚠ Bookings are locked. Speak to an admin to make changes.
                              </div>
                              <div className="ip-payment-info">
                                {
                                  <>
                                    Please send the payment via Interac to{' '}
                                    <strong>
                                      <u>grow@raghavv.ca</u>
                                    </strong>
                                    . Tick ✅ the PAYMENT box after.
                                  </>
                                }
                              </div>
                            </>
                          )}

                          {/* Grid header */}
                          <div className="ip-grid-header">
                            <div>PLAYER</div>
                            <div>NAME</div>
                            <div>OWNER / LAST UPDATE</div>
                            <div>PAYMENT</div>
                            <div>REMOVE</div>
                          </div>

                          {/* Player rows */}
                          {Array.from(
                            { length: slot.players.length + slot.waitList.length },
                            (_, i) => renderPlayer(slot, i),
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
