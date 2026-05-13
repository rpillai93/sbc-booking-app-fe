import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import {
  getSlots,
  createSlot,
  deleteSlot,
  lockSlot,
  hideSlot,
  archiveSlot,
  updateAmount,
  updateCourtNo,
} from '../api/api';
import type { Slot, Player, GroupedSlots } from '../types';
import type { AxiosError } from 'axios';

// ─── modal state ──────────────────────────────────────────────────────────────
interface ModalState {
  open: boolean;
  message: string;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | null;
  confirmLabel: string;
  confirmColor: string;
}
const CLOSED: ModalState = {
  open: false,
  message: '',
  onConfirm: null,
  onCancel: null,
  confirmLabel: 'Confirm',
  confirmColor: '#dc2626',
};

// ─── apply-amounts modal ──────────────────────────────────────────────────────
interface PlayerAmtRow {
  slotId: string;
  playerId: string;
  name: string;
  isWaitList: boolean;
  amount: string;
}
interface ApplyModalState {
  open: boolean;
  groupKey: string;
  rows: PlayerAmtRow[];
  includeWaitlist: boolean;
}
const APPLY_CLOSED: ApplyModalState = {
  open: false,
  groupKey: '',
  rows: [],
  includeWaitlist: false,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

// Sum all playerAmts across all active slots in a group
function computeGroupTotal(slots: Slot[]): number {
  return slots
    .filter((s) => !s.slotArchived)
    .flatMap((s) => [...s.players, ...s.waitList])
    .reduce((sum, p) => sum + (p.playerAmt ?? 0), 0);
}

// Format a number cleanly: no decimals if whole, 2dp otherwise
function fmt(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

// Parse a 12-hour time string like "6:00 PM" into total minutes
function parseTime(t: string): number {
  const [timePart, period] = t.split(' ');
  // eslint-disable-next-line prefer-const
  let [hours, minutes] = timePart.split(':').map(Number);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [groupedSlots, setGroupedSlots] = useState<GroupedSlots>({});
  const [loading, setLoading] = useState(true);
  const [loaderMsg, setLoaderMsg] = useState('Loading...');
  const [modal, setModal] = useState<ModalState>(CLOSED);
  const [okayMsg, setOkayMsg] = useState('');

  // create form
  const [createDate, setCreateDate] = useState('');
  const [createFrom, setCreateFrom] = useState('6:00 PM');
  const [createTo, setCreateTo] = useState('8:00 PM');
  const [createCourts, setCreateCourts] = useState(1);
  const [creating, setCreating] = useState(false);

  // group-level amount input: key = groupKey, value = raw string input
  const [editAmtKey, setEditAmtKey] = useState<string | null>(null);
  const [editAmtValue, setEditAmtValue] = useState('');

  // apply-amounts modal
  const [applyModal, setApplyModal] = useState<ApplyModalState>(APPLY_CLOSED);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInputValue, setTotalInputValue] = useState('');

  // archive expand
  const [expandedArchiveIds, setExpandedArchiveIds] = useState<Set<string>>(new Set());

  // court number inline editing
  const [editingCourtId, setEditingCourtId] = useState<string | null>(null);
  const [editingCourtValue, setEditingCourtValue] = useState('');

  // ── fetch ───────────────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getSlots();
      setGroupedSlots(res.data.groupedSlots);
    } catch {
      setOkayMsg('Failed to load slots. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchSlots();
  }, [fetchSlots]);

  // ── helpers ─────────────────────────────────────────────────────────────────
  function confirm(
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmLabel = 'Confirm',
    confirmColor = '#dc2626',
  ) {
    setModal({
      open: true,
      message,
      onConfirm,
      onCancel: onCancel ?? null,
      confirmLabel,
      confirmColor,
    });
  }

  async function withLoader(msg: string, fn: () => Promise<void>) {
    setLoaderMsg(msg);
    setLoading(true);
    try {
      await fn();
      await fetchSlots(true);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setOkayMsg(e.response?.data?.message ?? 'An error occurred');
      await fetchSlots(true);
    } finally {
      setLoading(false);
    }
  }

  function toggleArchiveExpand(id: string) {
    setExpandedArchiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── create ──────────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createDate) {
      setOkayMsg('Please select a date.');
      return;
    }
    if (parseTime(createFrom) >= parseTime(createTo)) {
      setOkayMsg('The <b>From</b> time must be before the <b>To</b> time.');
      return;
    }
    setCreating(true);
    try {
      await createSlot({
        date: createDate,
        time: `${createFrom}–${createTo}`,
        courts: createCourts,
      });
      await fetchSlots(true);
      setCreateDate('');
      setCreateCourts(1);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setOkayMsg(e.response?.data?.message ?? 'Failed to create slot');
    } finally {
      setCreating(false);
    }
  }

  // ── delete / lock / hide / archive ─────────────────────────────────────────
  function handleDelete(slot: Slot) {
    confirm(
      `Delete court on <b>${slot.date}, ${slot.time}</b>? This cannot be undone.`,
      () => withLoader('Deleting...', () => deleteSlot(slot._id).then()),
      undefined,
      'Delete',
      '#dc2626',
    );
  }

  function handleLock(slot: Slot) {
    const next = !slot.slotLocked;
    confirm(
      `${next ? 'Lock' : 'Unlock'} Court ${slot.courtNo || '?'} on <b>${slot.date}</b>?`,
      () =>
        withLoader(next ? 'Locking...' : 'Unlocking...', () =>
          lockSlot(slot._id, { isLocked: next }).then(),
        ),
      undefined,
      next ? 'Lock' : 'Unlock',
      next ? '#f59e0b' : '#22c55e',
    );
  }

  function handleHide(slot: Slot) {
    const next = !slot.slotHidden;
    confirm(
      `${next ? 'Hide' : 'Show'} Court ${slot.courtNo || '?'} on <b>${slot.date}</b>?`,
      () =>
        withLoader(next ? 'Hiding...' : 'Showing...', () =>
          hideSlot(slot._id, { isHidden: next }).then(),
        ),
      undefined,
      next ? 'Hide' : 'Show',
      next ? '#6b7280' : '#22c55e',
    );
  }

  function handleArchive(slot: Slot) {
    const next = !slot.slotArchived;
    confirm(
      next
        ? `Archive Court ${slot.courtNo || '?'} on <b>${slot.date}</b>? It will be locked and hidden from players.`
        : `Unarchive Court ${slot.courtNo || '?'} on <b>${slot.date}</b>? It will be restored to Manage Bookings.`,
      () =>
        withLoader(next ? 'Archiving...' : 'Unarchiving...', () =>
          archiveSlot(slot._id, { isArchived: next }).then(),
        ),
      undefined,
      next ? 'Archive' : 'Unarchive',
      next ? '#6b7280' : '#22c55e',
    );
  }

  // ── open apply-amounts modal ────────────────────────────────────────────────
  // Called after user types a total and clicks Save on the amount bar.
  // Distributes the total equally across main players; waitlist starts at $0.
  function openApplyModal(groupKey: string, slots: Slot[], totalInput: number) {
    const activeSlots = slots.filter((s) => !s.slotArchived);

    const mainPlayers: PlayerAmtRow[] = [];
    const wlPlayers: PlayerAmtRow[] = [];

    for (const slot of activeSlots) {
      for (const p of slot.players) {
        if (p.name?.trim()) {
          mainPlayers.push({
            slotId: slot._id,
            playerId: String(p._id),
            name: p.name,
            isWaitList: false,
            amount: '',
          });
        }
      }
      for (const p of slot.waitList) {
        if (p.name?.trim()) {
          wlPlayers.push({
            slotId: slot._id,
            playerId: String(p._id),
            name: p.name,
            isWaitList: true,
            amount: '0',
          });
        }
      }
    }

    // distribute total equally across main players only (waitlist starts $0)
    const split = mainPlayers.length > 0 ? (totalInput / mainPlayers.length).toFixed(2) : '0.00';

    const rows: PlayerAmtRow[] = [
      ...mainPlayers.map((r) => ({ ...r, amount: split })),
      ...wlPlayers,
    ];

    setApplyModal({ open: true, groupKey, rows, includeWaitlist: false });
    setEditAmtKey(null);
  }

  function updateApplyRow(idx: number, value: string) {
    setApplyModal((prev) => {
      const rows = [...prev.rows];
      rows[idx] = { ...rows[idx], amount: value };
      return { ...prev, rows };
    });
  }

  function toggleIncludeWaitlist(checked: boolean) {
    setApplyModal((prev) => {
      // when unchecking, reset waitlist amounts back to 0
      const rows = prev.rows.map((r) =>
        r.isWaitList ? { ...r, amount: checked ? r.amount : '0' } : r,
      );
      return { ...prev, includeWaitlist: checked, rows };
    });
  }

  function redistributeFromTotal(newTotal: number) {
    setApplyModal((prev) => {
      const activRows = prev.rows.filter((r) => !r.isWaitList || prev.includeWaitlist);
      const count = activRows.length;
      if (count === 0) return prev;

      const split = (newTotal / count).toFixed(2);

      const rows = prev.rows.map((r) => {
        // only redistribute rows that are currently editable
        if (r.isWaitList && !prev.includeWaitlist) return r;
        return { ...r, amount: split };
      });

      return { ...prev, rows };
    });
  }

  // ── save apply modal ────────────────────────────────────────────────────────
  async function saveApplyModal() {
    const { rows, groupKey } = applyModal;

    // group rows by slot
    const bySlot = new Map<
      string,
      {
        players: { _id: string; playerAmt: number }[];
        waitList: { _id: string; playerAmt: number }[];
      }
    >();

    for (const row of rows) {
      if (!bySlot.has(row.slotId)) bySlot.set(row.slotId, { players: [], waitList: [] });
      const entry = bySlot.get(row.slotId)!;
      const amt = parseFloat(row.amount) || 0;
      if (row.isWaitList) entry.waitList.push({ _id: row.playerId, playerAmt: amt });
      else entry.players.push({ _id: row.playerId, playerAmt: amt });
    }

    // also include active slots that had no named players (so their amounts get zeroed properly)
    const activeSlots = Object.values(groupedSlots)
      .flat()
      .filter((s) => !s.slotArchived && `${s.date}__${s.time}` === groupKey);

    for (const slot of activeSlots) {
      if (!bySlot.has(slot._id)) bySlot.set(slot._id, { players: [], waitList: [] });
    }

    setApplyModal(APPLY_CLOSED);
    setEditingTotal(false);
    setTotalInputValue('');

    await withLoader('Saving amounts...', async () => {
      await Promise.all(
        Array.from(bySlot.entries()).map(([slotId, data]) =>
          updateAmount(slotId, { players: data.players, waitList: data.waitList }),
        ),
      );
    });
  }

  // ── computed total shown in the amount bar ──────────────────────────────────
  // Simply sums all playerAmt values for all active slots in the group.
  function getDisplayTotal(slots: Slot[]): number {
    return computeGroupTotal(slots);
  }

  // ── court number save ───────────────────────────────────────────────────────
  function handleCourtNoSave(slot: Slot, newValue: string) {
    const num = parseInt(newValue, 10);
    if (isNaN(num) || num < 1 || num > 9) {
      setOkayMsg('Court number must be between <b>1</b> and <b>9</b>.');
      setEditingCourtId(null);
      return;
    }
    setEditingCourtId(null);
    confirm(
      `Save Court no. to <b>${num}</b>?`,
      () => withLoader('Saving...', () => updateCourtNo(slot._id, { courtNo: num }).then()),
      undefined,
      'Save',
      '#22c55e',
    );
  }

  // ── derived: is the current From/To selection invalid? ─────────────────────
  const timeRangeInvalid = parseTime(createFrom) >= parseTime(createTo);

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0d; }

        .ap-root { min-height: 100vh; background: #0d0d0d; font-family: 'DM Sans', sans-serif; color: #e0e0e0; }

        .ap-topbar {
          background: #111; border-bottom: 1px solid #222; padding: 14px 20px;
          display: flex; align-items: center; justify-content: space-between;
          position: sticky; top: 0; z-index: 100;
        }
        .ap-brand { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 17px; color: #f0f0f0; display: flex; align-items: center; gap: 8px; }
        .ap-badge { background: #22c55e; color: #000; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.5px; }
        .ap-topbar-right { display: flex; align-items: center; gap: 10px; }
        .ap-email-label { font-size: 12px; color: #555; }
        .ap-email { font-size: 14px; color: #fff; }
        .ap-player-btn {
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
          width: auto;
          margin: 0;
        }

        .ap-player-btn:hover { opacity: 0.85; }
        
        .ap-btn-ghost {
          background: transparent; border: 1px solid #333; color: #888;
          border-radius: 7px; padding: 7px 13px; font-size: 12px; cursor: pointer;
          transition: all 0.2s; width: auto; margin: 0;
        }
        .ap-btn-ghost:hover { color: #fff; border-color: #666; }

        .ap-container { max-width: 960px; margin: 0 auto; padding: 24px 16px 60px; }

        .ap-section-title {
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #555; text-transform: uppercase; letter-spacing: 1px;
          margin-bottom: 12px; margin-top: 28px;
        }

        .ap-create-card { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 20px; }
        .ap-form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr auto auto; gap: 10px; align-items: end; }
        @media (max-width: 680px) { .ap-form-grid { grid-template-columns: 1fr 1fr; } }
        .ap-form-field label { display: block; font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .ap-input { width: 100%; padding: 10px 12px; background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 8px; color: #f0f0f0; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; transition: border-color 0.2s; margin-top: 0; }
        .ap-input:focus { border-color: #22c55e; }
        .ap-input.invalid { border-color: #ef444466; }
        .ap-input option { background: #1e1e1e; }
        .ap-time-error { font-size: 11px; color: #f87171; margin-top: 10px; display: flex; align-items: center; gap: 4px; }
        .ap-create-btn { padding: 10px 20px; background: #22c55e; color: #000; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: opacity 0.2s; width: auto; margin: 0; height: fit-content; }
        .ap-create-btn:hover:not(:disabled) { opacity: 0.85; }
        .ap-create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .ap-group { margin-bottom: 24px; }
        .ap-group-label { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700; color: #888; padding: 8px 0; border-bottom: 1px solid #1e1e1e; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }

        .ap-slot-card { background: #161616; border: 1px solid #232323; border-radius: 14px; padding: 16px; margin-bottom: 10px; transition: border-color 0.2s; }
        .ap-slot-card:hover { border-color: #333; }
        .ap-slot-card.locked { border-color: #f59e0b44; }
        .ap-slot-card.hidden { opacity: 0.5; }

        .ap-slot-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
        .ap-slot-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #f0f0f0; display: flex; align-items: center; gap: 8px; }
        .ap-court-no { cursor: pointer; border-bottom: 1px dashed #444; transition: border-color 0.2s; }
        .ap-court-no:hover { border-color: #22c55e; color: #22c55e; }
        .ap-court-no-input { width: 36px; padding: 1px 4px; background: #1e1e1e; border: 1px solid #22c55e; border-radius: 4px; color: #22c55e; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; outline: none; text-align: center; margin: 0; }
        .ap-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.3px; }
        .ap-tag.locked { background: #f59e0b22; color: #f59e0b; border: 1px solid #f59e0b44; }
        .ap-tag.hidden { background: #6b728022; color: #9ca3af; border: 1px solid #6b728044; }

        .ap-slot-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .ap-action-btn { padding: 7px 14px; border-radius: 7px; border: 1px solid #2a2a2a; background: #1e1e1e; color: #aaa; font-size: 12px; font-weight: 500; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; width: auto; margin: 0; }
        .ap-action-btn:hover { color: #fff; border-color: #444; background: #252525; }
        .ap-action-btn.danger:hover { color: #f87171; border-color: #dc262644; }
        .ap-action-btn.warn:hover { color: #fbbf24; border-color: #f59e0b44; }
        .ap-action-btn.success:hover { color: #4ade80; border-color: #22c55e44; }
        .ap-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .ap-action-btn:disabled:hover { color: #aaa; border-color: #2a2a2a; background: #1e1e1e; }

        /* ── group amount bar ── */
        .ap-group-amount-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #131313; border: 1px solid #1e1e1e; border-radius: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .ap-amount-label { font-size: 12px; color: #666; white-space: nowrap; }
        .ap-amount-value { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; color: #22c55e; }
        .ap-amount-input { width: 100px; padding: 6px 10px; background: #111; border: 1px solid #22c55e; border-radius: 6px; color: #22c55e; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; outline: none; margin-top: 0; }
        .ap-amount-save { padding: 6px 14px; background: #22c55e; color: #000; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'Syne', sans-serif; width: auto; margin: 0; transition: opacity 0.15s; }
        .ap-amount-save:disabled { opacity: 0.35; cursor: not-allowed; }
        .ap-amount-edit-btn { background: transparent; border: 1px solid #2a2a2a; color: #666; border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; transition: all 0.2s; width: auto; margin: 0; }
        .ap-amount-edit-btn:hover { color: #fff; border-color: #444; }

        /* ── players summary ── */
        .ap-players-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .ap-player-chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
        .ap-player-chip.filled { background: #ffedd5; color: #9a3412; }
        .ap-player-chip.empty  { background: #1e1e1e; color: #555; border: 1px dashed #333; }
        .ap-player-chip.wl     { background: #1e3a8a22; color: #93c5fd; border: 1px solid #1e3a8a44; }
        .ap-paid-coin { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; border-radius: 999px; font-size: 10px; font-weight: 800; font-family: 'DM Sans', sans-serif; flex-shrink: 0; padding: 0 4px; }
        .ap-paid-coin.paid   { color: #22c55e; background: #22c55e18; border: 1.5px solid #22c55e; }
        .ap-paid-coin.unpaid { color: #ef4444; background: #ef444418; border: 1.5px solid #ef4444; }

        /* ── apply amounts modal ── */
        .ap-apply-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 9997; padding: 16px; }
        .ap-apply-modal { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 20px; width: 100%; max-width: 480px; box-shadow: 0 30px 80px rgba(0,0,0,0.7); display: flex; flex-direction: column; gap: 16px; max-height: 90vh; }
        .ap-apply-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; color: #f0f0f0; }
        .ap-apply-subtitle { font-size: 12px; color: #555; margin-top: 2px; }

        .ap-apply-list { overflow-y: auto; max-height: 340px; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
        .ap-apply-list::-webkit-scrollbar { width: 4px; }
        .ap-apply-list::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        .ap-apply-list::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }

        .ap-apply-row { display: grid; grid-template-columns: 1fr 120px; align-items: center; gap: 10px; padding: 8px 10px; background: #1a1a1a; border: 1px solid #222; border-radius: 8px; }
        .ap-apply-row.wl-disabled { opacity: 0.45; }
        .ap-apply-name { font-size: 13px; color: #d0d0d0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ap-apply-sublabel { font-size: 10px; color: #555; margin-top: 1px; }
        .ap-apply-amt-wrap { display: flex; align-items: center; gap: 4px; }
        .ap-apply-amt-symbol { font-size: 12px; color: #555; }
        .ap-apply-amt-input { flex: 1; min-width: 0; width: 0; padding: 6px 8px; background: #111; border: 1px solid #2e2e2e; border-radius: 6px; color: #f0f0f0; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; transition: border-color 0.2s; margin: 0; }
        .ap-apply-amt-input:focus { border-color: #22c55e; }
        .ap-apply-amt-input:disabled { opacity: 0.4; cursor: not-allowed; }

        /* waitlist toggle */
        .ap-wl-toggle { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #1a1a1a; border: 1px solid #222; border-radius: 8px; cursor: pointer; user-select: none; }
        .ap-wl-toggle input[type="checkbox"] { width: 15px; height: 15px; accent-color: #22c55e; cursor: pointer; margin: 0; }
        .ap-wl-toggle-label { font-size: 13px; color: #aaa; }

        /* total preview */
        .ap-apply-total { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #111; border-radius: 8px; border: 1px solid #1e1e1e; }
        .ap-apply-total-label { font-size: 12px; color: #555; }
        .ap-apply-total-value { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #22c55e; }

        .ap-apply-footer { display: flex; gap: 10px; }
        .ap-apply-save { flex: 1; padding: 10px; background: #22c55e; color: #000; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; transition: opacity 0.15s; }
        .ap-apply-save:hover { opacity: 0.85; }
        .ap-apply-cancel { flex: 1; padding: 10px; background: #2a2a2a; color: #aaa; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; }

        /* ── archive ── */
        .ap-archive-card { background: #111; border: 1px solid #1e1e1e; border-radius: 12px; margin-bottom: 8px; overflow: hidden; transition: border-color 0.2s; }
        .ap-archive-card:hover { border-color: #2a2a2a; }
        .ap-archive-summary { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; user-select: none; gap: 12px; }
        .ap-archive-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .ap-archive-date { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700; color: #888; }
        .ap-archive-time { font-size: 12px; color: #555; }
        .ap-archive-court { font-size: 11px; font-weight: 600; color: #444; background: #1a1a1a; padding: 2px 8px; border-radius: 999px; border: 1px solid #2a2a2a; }
        .ap-archive-chevron { color: #444; font-size: 11px; transition: transform 0.2s; }
        .ap-archive-chevron.open { transform: rotate(180deg); }
        .ap-archive-body { padding: 0 16px 14px; border-top: 1px solid #1a1a1a; }
        .ap-archive-players { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .ap-archive-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

        /* ── empty / loader / modals ── */
        .ap-empty { text-align: center; color: #444; font-size: 14px; padding: 40px 0; }
        .ap-loader { position: fixed; inset: 0; background: rgba(13,13,13,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; gap: 12px; }
        .ap-spinner { width: 28px; height: 28px; border: 3px solid #222; border-top-color: #22c55e; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .ap-loader-msg { font-size: 14px; color: #666; }
        .ap-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 9998; padding: 16px; }
        .ap-modal { background: #161616; border: 1px solid #2a2a2a; border-radius: 14px; padding: 20px; max-width: 360px; width: 100%; box-shadow: 0 30px 80px rgba(0,0,0,0.6); text-align: center; }
        .ap-modal-msg { font-size: 14px; color: #ccc; margin-bottom: 18px; line-height: 1.6; }
        .ap-modal-btns { display: flex; gap: 10px; }
        .ap-modal-btn { flex: 1; padding: 10px; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity 0.15s; width: auto; margin: 0; }
        .ap-modal-btn:hover { opacity: 0.85; }
        .ap-modal-cancel { background: #2a2a2a; color: #aaa; }
      `}</style>

      {/* Loader */}
      {loading && (
        <div className="ap-loader">
          <div className="ap-spinner" />
          <span className="ap-loader-msg">{loaderMsg}</span>
        </div>
      )}

      {/* Okay modal */}
      {okayMsg && (
        <div className="ap-modal-backdrop">
          <div className="ap-modal">
            <div className="ap-modal-msg" dangerouslySetInnerHTML={{ __html: okayMsg }} />
            <div className="ap-modal-btns">
              <button
                className="ap-modal-btn"
                style={{ background: '#dc2626', color: '#fff' }}
                onClick={() => setOkayMsg('')}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {modal.open && (
        <div className="ap-modal-backdrop">
          <div className="ap-modal">
            <div className="ap-modal-msg" dangerouslySetInnerHTML={{ __html: modal.message }} />
            <div className="ap-modal-btns">
              <button
                className="ap-modal-btn"
                style={{ background: modal.confirmColor, color: '#fff' }}
                onClick={() => {
                  setModal(CLOSED);
                  modal.onConfirm?.();
                }}
              >
                {modal.confirmLabel}
              </button>
              <button
                className="ap-modal-btn ap-modal-cancel"
                onClick={() => {
                  setModal(CLOSED);
                  modal.onCancel?.();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply amounts modal */}
      {applyModal.open &&
        (() => {
          const runningTotal = applyModal.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
          return (
            <div className="ap-apply-backdrop">
              <div className="ap-apply-modal">
                <div>
                  <div className="ap-apply-title">Apply Player Amounts</div>
                  <div className="ap-apply-subtitle">
                    Amounts split equally across main players. Adjust individually if needed.
                  </div>
                </div>

                <div className="ap-apply-list">
                  {applyModal.rows.map((row, idx) => {
                    const isWlDisabled = row.isWaitList && !applyModal.includeWaitlist;
                    return (
                      <div
                        key={`${row.slotId}-${row.playerId}`}
                        className={`ap-apply-row${isWlDisabled ? ' wl-disabled' : ''}`}
                      >
                        <div>
                          <div className="ap-apply-name">{row.name}</div>
                          {row.isWaitList && <div className="ap-apply-sublabel">Waitlist</div>}
                        </div>
                        <div className="ap-apply-amt-wrap">
                          <span className="ap-apply-amt-symbol">$</span>
                          <input
                            className="ap-apply-amt-input"
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.amount}
                            disabled={isWlDisabled}
                            onChange={(e) => updateApplyRow(idx, e.target.value)}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {applyModal.rows.length === 0 && (
                    <div
                      style={{
                        color: '#444',
                        fontSize: '13px',
                        textAlign: 'center',
                        padding: '20px 0',
                      }}
                    >
                      No players in this session yet.
                    </div>
                  )}
                </div>

                {/* Waitlist toggle */}
                <label className="ap-wl-toggle">
                  <input
                    type="checkbox"
                    checked={applyModal.includeWaitlist}
                    onChange={(e) => toggleIncludeWaitlist(e.target.checked)}
                  />
                  <span className="ap-wl-toggle-label">
                    Include waitlisted players in this payment
                  </span>
                </label>

                {/* Running total — click to re-enter and redistribute */}
                <div className="ap-apply-total">
                  <span className="ap-apply-total-label">Total across all players</span>
                  {editingTotal ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: '#555', fontSize: '13px' }}>$</span>
                      <input
                        autoFocus
                        className="ap-amount-input"
                        type="number"
                        min={0}
                        step={0.01}
                        value={totalInputValue}
                        onChange={(e) => setTotalInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = parseFloat(totalInputValue);
                            if (!isNaN(val) && val > 0) redistributeFromTotal(val);
                            setEditingTotal(false);
                          }
                          if (e.key === 'Escape') setEditingTotal(false);
                        }}
                        onBlur={() => {
                          const val = parseFloat(totalInputValue);
                          if (!isNaN(val) && val > 0) redistributeFromTotal(val);
                          setEditingTotal(false);
                        }}
                        style={{ width: '90px' }}
                      />
                    </div>
                  ) : (
                    <span
                      className="ap-apply-total-value"
                      title="Click to redistribute"
                      style={{
                        cursor: 'pointer',
                        textDecoration: 'underline dotted',
                        textUnderlineOffset: '3px',
                      }}
                      onClick={() => {
                        setTotalInputValue(fmt(runningTotal));
                        setEditingTotal(true);
                      }}
                    >
                      ${fmt(runningTotal)}
                    </span>
                  )}
                </div>

                <div className="ap-apply-footer">
                  <button className="ap-apply-save" onClick={saveApplyModal}>
                    Save
                  </button>
                  <button
                    className="ap-apply-cancel"
                    onClick={() => {
                      setApplyModal(APPLY_CLOSED);
                      setEditingTotal(false);
                      setTotalInputValue('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      <div className="ap-root">
        {/* Top bar */}
        <div className="ap-topbar">
          <div className="ap-brand">
            🏸 SBC Admin <span className="ap-badge">ADMIN</span>
          </div>
          <div className="ap-topbar-right">
            <span className="ap-email-label">Logged in as:</span>
            <span className="ap-email">{user?.name}</span>
            <button className="ap-player-btn" onClick={() => navigate('/')}>
              🏃 Player View
            </button>
            <button className="ap-btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>

        <div className="ap-container">
          {/* ── Create booking ── */}
          <p className="ap-section-title">Create Court Booking</p>
          <div className="ap-create-card">
            <form onSubmit={handleCreate}>
              <div className="ap-form-grid">
                <div className="ap-form-field">
                  <label>Date</label>
                  <input
                    type="date"
                    className="ap-input"
                    value={createDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setCreateDate(e.target.value)}
                    required
                  />
                </div>
                <div className="ap-form-field">
                  <label>From</label>
                  <select
                    className={`ap-input${timeRangeInvalid ? ' invalid' : ''}`}
                    value={createFrom}
                    onChange={(e) => setCreateFrom(e.target.value)}
                  >
                    {[
                      '6:00 AM',
                      '7:00 AM',
                      '8:00 AM',
                      '9:00 AM',
                      '10:00 AM',
                      '11:00 AM',
                      '12:00 PM',
                      '1:00 PM',
                      '2:00 PM',
                      '3:00 PM',
                      '4:00 PM',
                      '5:00 PM',
                      '6:00 PM',
                      '7:00 PM',
                      '8:00 PM',
                      '9:00 PM',
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ap-form-field">
                  <label>To</label>
                  <select
                    className={`ap-input${timeRangeInvalid ? ' invalid' : ''}`}
                    value={createTo}
                    onChange={(e) => setCreateTo(e.target.value)}
                  >
                    {[
                      '7:00 AM',
                      '8:00 AM',
                      '9:00 AM',
                      '10:00 AM',
                      '11:00 AM',
                      '12:00 PM',
                      '1:00 PM',
                      '2:00 PM',
                      '3:00 PM',
                      '4:00 PM',
                      '5:00 PM',
                      '6:00 PM',
                      '7:00 PM',
                      '8:00 PM',
                      '9:00 PM',
                      '10:00 PM',
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ap-form-field">
                  <label>Courts</label>
                  <input
                    type="number"
                    className="ap-input"
                    min={1}
                    max={10}
                    value={createCourts}
                    onChange={(e) => setCreateCourts(Number(e.target.value))}
                  />
                </div>
                <div className="ap-form-field">
                  <label>&nbsp;</label>
                  <button
                    type="submit"
                    className="ap-create-btn"
                    disabled={creating || timeRangeInvalid}
                  >
                    {creating ? '...' : '＋ Create'}
                  </button>
                </div>
              </div>
              {timeRangeInvalid && (
                <div className="ap-time-error">
                  ⚠ &ldquo;To&rdquo; must be after &ldquo;From&rdquo;
                </div>
              )}
            </form>
          </div>

          {/* ── Manage bookings ── */}
          <p className="ap-section-title">Manage Bookings</p>

          {Object.keys(groupedSlots).length === 0 && !loading ? (
            <p className="ap-empty">No bookings yet. Create one above.</p>
          ) : (
            Object.entries(groupedSlots)
              .filter(([, slots]) => slots.some((s) => !s.slotArchived))
              .sort(([, a], [, b]) => {
                const da = new Date(`${a[0].date} ${a[0].time.split('–')[0].trim()}`);
                const db = new Date(`${b[0].date} ${b[0].time.split('–')[0].trim()}`);
                return da.getTime() - db.getTime();
              })
              .map(([key, slots]) => {
                const activeSlots = slots.filter((s) => !s.slotArchived);
                const first = activeSlots[0];
                const groupKey = `${first.date}__${first.time}`;
                const displayTotal = getDisplayTotal(activeSlots);
                const isEditingAmt = editAmtKey === groupKey;

                return (
                  <div key={key} className="ap-group">
                    <div className="ap-group-label">
                      📅 {first.date} · {first.time}
                      <span style={{ color: '#444', fontSize: '12px' }}>
                        ({activeSlots.length} court{activeSlots.length > 1 ? 's' : ''})
                      </span>
                    </div>

                    {/* Amount bar — one per group */}
                    <div className="ap-group-amount-bar">
                      <span className="ap-amount-label">Total Amount:</span>
                      {isEditingAmt ? (
                        <>
                          <span style={{ color: '#555', fontSize: '13px' }}>$</span>
                          <input
                            autoFocus
                            className="ap-amount-input"
                            type="number"
                            min={0}
                            step={0.01}
                            value={editAmtValue}
                            onChange={(e) => setEditAmtValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && parseFloat(editAmtValue) > 0)
                                openApplyModal(groupKey, slots, parseFloat(editAmtValue));
                              if (e.key === 'Escape') setEditAmtKey(null);
                            }}
                          />
                          <button
                            className="ap-amount-save"
                            disabled={!editAmtValue || parseFloat(editAmtValue) <= 0}
                            onClick={() =>
                              openApplyModal(groupKey, slots, parseFloat(editAmtValue))
                            }
                          >
                            Save
                          </button>
                          <button
                            className="ap-amount-edit-btn"
                            onClick={() => setEditAmtKey(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="ap-amount-value">
                            {displayTotal > 0 ? `$${fmt(displayTotal)}` : '—'}
                          </span>
                          <button
                            className="ap-amount-edit-btn"
                            onClick={() => {
                              setEditAmtKey(groupKey);
                              setEditAmtValue('');
                            }}
                          >
                            ✏️ Edit
                          </button>
                        </>
                      )}
                    </div>

                    {/* Court cards */}
                    {activeSlots.map((slot, ci) => (
                      <div
                        key={slot._id}
                        className={`ap-slot-card${slot.slotLocked ? ' locked' : ''}${slot.slotHidden ? ' hidden' : ''}`}
                      >
                        <div className="ap-slot-header">
                          <div className="ap-slot-title">
                            Court{' '}
                            {editingCourtId === slot._id ? (
                              <input
                                autoFocus
                                className="ap-court-no-input"
                                type="number"
                                min={1}
                                max={9}
                                value={editingCourtValue}
                                onChange={(e) => setEditingCourtValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleCourtNoSave(slot, editingCourtValue);
                                  if (e.key === 'Escape') setEditingCourtId(null);
                                }}
                                onBlur={() => {
                                  if (editingCourtValue !== '')
                                    handleCourtNoSave(slot, editingCourtValue);
                                  else setEditingCourtId(null);
                                }}
                              />
                            ) : (
                              <span
                                className="ap-court-no"
                                title="Click to edit court number"
                                onClick={() => {
                                  setEditingCourtId(slot._id);
                                  setEditingCourtValue(
                                    String(slot.courtNo > 0 ? slot.courtNo : ci + 1),
                                  );
                                }}
                              >
                                {slot.courtNo > 0 ? slot.courtNo : ci + 1}
                              </span>
                            )}
                            {slot.slotLocked && <span className="ap-tag locked">LOCKED</span>}
                            {slot.slotHidden && <span className="ap-tag hidden">HIDDEN</span>}
                          </div>
                          <div className="ap-slot-actions">
                            <button
                              className={`ap-action-btn ${slot.slotLocked ? 'success' : 'warn'}`}
                              onClick={() => handleLock(slot)}
                            >
                              {slot.slotLocked ? '🔓 Unlock' : '🔒 Lock'}
                            </button>
                            <button
                              className={`ap-action-btn ${slot.slotHidden ? 'success' : ''}`}
                              onClick={() => handleHide(slot)}
                            >
                              {slot.slotHidden ? '👁 Show' : '🙈 Hide'}
                            </button>
                            <button className="ap-action-btn" onClick={() => handleArchive(slot)}>
                              📦 Archive
                            </button>
                            <button
                              className="ap-action-btn danger"
                              onClick={() => handleDelete(slot)}
                            >
                              🗑 Delete
                            </button>
                          </div>
                        </div>

                        <div className="ap-players-summary">
                          {slot.players.map((p: Player, i: number) => (
                            <span
                              key={i}
                              className={`ap-player-chip ${p.name ? 'filled' : 'empty'}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                            >
                              {p.name || `P${i + 1} open`}
                              {p.name && (
                                <span className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}>
                                  {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                </span>
                              )}
                            </span>
                          ))}
                          {slot.waitList
                            .filter((p: Player) => p.name)
                            .map((p: Player, i: number) => (
                              <span
                                key={i}
                                className="ap-player-chip wl"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                              >
                                WL{i + 1}: {p.name}
                                <span className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}>
                                  {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                </span>
                              </span>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
          )}

          {/* ── Archived bookings ── */}
          {(() => {
            const archived = Object.values(groupedSlots)
              .flat()
              .filter((s) => s.slotArchived)
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            if (archived.length === 0) return null;
            return (
              <>
                <p className="ap-section-title">Archived Bookings</p>
                {archived.map((slot, ci) => {
                  const isExpanded = expandedArchiveIds.has(slot._id);
                  const slotTotal = [...slot.players, ...slot.waitList].reduce(
                    (s, p) => s + (p.playerAmt ?? 0),
                    0,
                  );
                  return (
                    <div key={slot._id} className="ap-archive-card">
                      <div
                        className="ap-archive-summary"
                        onClick={() => toggleArchiveExpand(slot._id)}
                      >
                        <div className="ap-archive-meta">
                          <span className="ap-archive-date">{slot.date}</span>
                          <span className="ap-archive-time">{slot.time}</span>
                          <span className="ap-archive-court">
                            Court {slot.courtNo > 0 ? slot.courtNo : ci + 1}
                          </span>
                        </div>
                        <span className={`ap-archive-chevron${isExpanded ? ' open' : ''}`}>▼</span>
                      </div>
                      {isExpanded && (
                        <div className="ap-archive-body">
                          <div className="ap-group-amount-bar" style={{ marginTop: '4px' }}>
                            <span className="ap-amount-label">Total Amount:</span>
                            <span className="ap-amount-value">
                              {slotTotal > 0 ? `$${fmt(slotTotal)}` : '—'}
                            </span>
                          </div>
                          <div className="ap-archive-players">
                            {slot.players.map((p: Player, i: number) => (
                              <span
                                key={i}
                                className={`ap-player-chip ${p.name ? 'filled' : 'empty'}`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                              >
                                {p.name || `P${i + 1} open`}
                                {p.name && (
                                  <span className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}>
                                    {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                  </span>
                                )}
                              </span>
                            ))}
                            {slot.waitList
                              .filter((p: Player) => p.name)
                              .map((p: Player, i: number) => (
                                <span
                                  key={i}
                                  className="ap-player-chip wl"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  WL{i + 1}: {p.name}
                                  <span className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}>
                                    {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                  </span>
                                </span>
                              ))}
                          </div>
                          <div className="ap-archive-actions">
                            <button
                              className="ap-action-btn success"
                              onClick={() => handleArchive(slot)}
                            >
                              📤 Unarchive
                            </button>
                            <button
                              className="ap-action-btn danger"
                              onClick={() => handleDelete(slot)}
                            >
                              🗑 Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
