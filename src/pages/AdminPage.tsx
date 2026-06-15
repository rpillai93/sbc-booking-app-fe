import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import {
  getSlots,
  createSlot,
  deleteSlot,
  resizeSlot,
  lockSlot,
  hideSlot,
  archiveSlot,
  updateAmount,
  getUsers,
  approveUser,
  deleteUser,
  addUserComments,
  getSelf,
  settlePayment,
} from '../api/api';
import type { Slot, Player, GroupedSlots, User } from '../types';
import type { AxiosError } from 'axios';
import React from 'react';

type AdminTab = 'slots' | 'users';

// ─── modal state ──────────────────────────────────────────────────────────────
interface ModalState {
  open: boolean;
  message: string;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | null;
  hideCancel: boolean;
  confirmLabel: string;
  confirmColor: string;
}
const CLOSED: ModalState = {
  open: false,
  message: '',
  onConfirm: null,
  onCancel: null,
  hideCancel: false,
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
  split: 100 | 75 | 50 | 25 | 0;
}
interface ApplyModalState {
  open: boolean;
  groupKey: string;
  rows: PlayerAmtRow[];
  includeWaitlist: boolean;
  originalTotal: number;
}
const APPLY_CLOSED: ApplyModalState = {
  open: false,
  groupKey: '',
  rows: [],
  includeWaitlist: false,
  originalTotal: 0,
};

// ─── users sort ───────────────────────────────────────────────────────────────
type UserSortKey = 'name' | 'contact' | 'lastLogin' | 'netPayments' | 'profileApproved';
type SortDir = 'asc' | 'desc';

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n % 1 === 0) {
    return String(n);
  } else {
    const num = Math.round(n * 100) / 100;
    return num.toString();
  }
}

function parseTime(t: string): number {
  const [timePart, period] = t.split(' ');
  // eslint-disable-next-line prefer-const
  let [hours, minutes] = timePart.split(':').map(Number);
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatLastLogin(ts: string): string {
  if (!ts) return '—';
  try {
    const date = new Date(ts.trim());
    if (isNaN(date.getTime())) return ts;
    const time = date
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .toLowerCase()
      .replace(' ', '\u202f'); // narrow no-break space
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${time} · ${day}`;
  } catch {
    return ts;
  }
}

function SortArrow({
  col,
  activeKey,
  dir,
  onSort,
}: {
  col: UserSortKey;
  activeKey: UserSortKey;
  dir: SortDir;
  onSort: (col: UserSortKey) => void;
}) {
  const active = activeKey === col;
  return (
    <span
      className={`usr-sort-arrow${active ? ' active' : ''}`}
      onClick={() => onSort(col)}
      title={active ? (dir === 'asc' ? 'Sort descending' : 'Sort ascending') : 'Sort'}
    >
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<AdminTab>('slots');

  // ── slots state ──────────────────────────────────────────────────────────
  const [groupedSlots, setGroupedSlots] = useState<GroupedSlots>({});
  const [loading, setLoading] = useState(true);
  const [loaderMsg, setLoaderMsg] = useState('Loading...');
  const [modal, setModal] = useState<ModalState>(CLOSED);

  const [createDate, setCreateDate] = useState('');
  const [createFrom, setCreateFrom] = useState('6:00 PM');
  const [createTo, setCreateTo] = useState('8:00 PM');
  const [createCourts, setCreateCourts] = useState(1);
  const [createNumPlayers, setCreateNumPlayers] = useState(4);
  const [createNumWaitlistPlayers, setCreateNumWaitlistPlayers] = useState(1);
  const [creating, setCreating] = useState(false);

  const [editAmtKey, setEditAmtKey] = useState<string | null>(null);
  const [editAmtValue, setEditAmtValue] = useState('');

  const [applyModal, setApplyModal] = useState<ApplyModalState>(APPLY_CLOSED);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInputValue, setTotalInputValue] = useState('');

  const [expandedArchiveIds, setExpandedArchiveIds] = useState<Set<string>>(new Set());
  const [settleHovered, setSettleHovered] = useState<string | null>(null);

  // ── resize modal state ────────────────────────────────────────────────────
  const [resizeModal, setResizeModal] = useState<{
    open: boolean;
    slot: Slot | null;
    removeCourts: string;
    removePlayers: string;
    removeWaitlist: string;
  }>({ open: false, slot: null, removeCourts: '0', removePlayers: '0', removeWaitlist: '0' });

  function openResizeModal(slot: Slot) {
    setResizeModal({
      open: true,
      slot,
      removeCourts: '0',
      removePlayers: '0',
      removeWaitlist: '0',
    });
  }
  function closeResizeModal() {
    setResizeModal({
      open: false,
      slot: null,
      removeCourts: '0',
      removePlayers: '0',
      removeWaitlist: '0',
    });
  }

  async function handleResize() {
    if (!resizeModal.slot) return;
    const courts = parseInt(resizeModal.removeCourts) || 0;
    const players = parseInt(resizeModal.removePlayers) || 0;
    const waitlist = parseInt(resizeModal.removeWaitlist) || 0;
    if (courts === 0 && players === 0 && waitlist === 0) {
      showOkayMsg('No changes selected.');
      return;
    }
    // const slotId = resizeModal.slot._id;
    closeResizeModal(); // ← close FIRST, then open the confirm modal
    confirm(
      `Remove <b>${courts}</b> court(s), <b>${players}</b> player slot(s), and <b>${waitlist}</b> waitlist slot(s) from this booking?`,
      async () => {
        closeResizeModal();
        await withLoader('Updating...', () =>
          resizeSlot(resizeModal.slot!._id, {
            removeCourts: courts,
            removePlayers: players,
            removeWaitlist: waitlist,
          }).then(),
        );
      },
      undefined,
      false,
      'Confirm',
      '#f59e0b',
    );
  }

  // ── users state ──────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSortKey, setUserSortKey] = useState<UserSortKey>('name');
  const [userSortDir, setUserSortDir] = useState<SortDir>('asc');
  const [selfUser, setSelfUser] = useState<User | null>(null);

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

  // ── confirm helper ────────────────────────────────────────────────────────
  function confirm(
    message: string,
    onConfirm?: () => void,
    onCancel?: () => void,
    hideCancel?: boolean,
    confirmLabel = 'Confirm',
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

  // ── fetch slots ──────────────────────────────────────────────────────────
  const fetchSlots = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getSlots();
      setGroupedSlots(res.data.groupedSlots);
    } catch {
      showOkayMsg('Failed to load slots. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── fetch users ──────────────────────────────────────────────────────────
  const fetchSelf = useCallback(async () => {
    try {
      const res = await getSelf();
      setSelfUser(res.data.user);
    } catch {
      // silently fail — not critical
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await getUsers();
      setUsers(res.data.users);
    } catch {
      showOkayMsg('Failed to load users. Please refresh.');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const didInit = useRef(false);
  const usersFetched = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    fetchSlots();
    fetchSelf();
  }, [fetchSlots, fetchSelf]);

  // Fetch users when tab switches to users
  useEffect(() => {
    if (activeTab !== 'users') return;
    if (usersFetched.current) return;
    usersFetched.current = true;
    fetchUsers();
  }, [activeTab, fetchUsers]);

  useEffect(() => {
    function handleGlobalClick() {
      setSettleHovered(null);
    }
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, []);

  async function withLoader(msg: string, fn: () => Promise<void>) {
    setLoaderMsg(msg);
    setLoading(true);
    try {
      await fn();
      await fetchSlots(true);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      showOkayMsg(e.response?.data?.message ?? 'An error occurred');
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

  // ── create ────────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createDate) {
      showOkayMsg('Please select a date.');
      return;
    }
    if (parseTime(createFrom) >= parseTime(createTo)) {
      showOkayMsg('The <b>From</b> time must be before the <b>To</b> time.');
      return;
    }
    confirm(
      `Create booking for <b>${createCourts}</b> court(s) on <b>${createDate}</b> from <b>${createFrom}</b> to <b>${createTo}</b>?`,
      async () => {
        setCreating(true);
        try {
          await createSlot({
            date: createDate,
            time: `${createFrom}–${createTo}`,
            courts: createCourts,
            numPlayers: createNumPlayers,
            numWaitlist: createNumWaitlistPlayers,
          });
          await fetchSlots(true);
          setCreateDate('');
          setCreateCourts(1);
          setCreateNumPlayers(4);
          setCreateNumWaitlistPlayers(1);
          confirm(`Booking created successfully!`, undefined, undefined, true, 'Okay', '#22c55e');
        } catch (err) {
          const e = err as AxiosError<{ message: string }>;
          showOkayMsg(e.response?.data?.message ?? 'Failed to create slot');
        } finally {
          setCreating(false);
        }
      },
      undefined,
      false,
      'Create Booking',
      '#22c55e',
    );
  }

  // ── slot actions ──────────────────────────────────────────────────────────
  function handleDelete(slot: Slot) {
    confirm(
      `Delete court on <b>${slot.date}, ${slot.time}</b>? This cannot be undone.`,
      () => withLoader('Deleting...', () => deleteSlot(slot._id).then()),
      undefined,
      false,
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
      false,
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
      false,
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
      false,
      next ? 'Archive' : 'Unarchive',
      next ? '#6b7280' : '#22c55e',
    );
  }

  // ── apply amounts ─────────────────────────────────────────────────────────
  function openApplyModal(groupKey: string, slots: Slot[], totalInput: number) {
    const activeSlots = slots.filter((s) => !s.slotArchived);
    const mainPlayers: PlayerAmtRow[] = [];
    const wlPlayers: PlayerAmtRow[] = [];
    for (const slot of activeSlots) {
      for (const p of slot.players) {
        if (p.name?.trim())
          mainPlayers.push({
            slotId: slot._id,
            playerId: String(p._id),
            name: p.name,
            isWaitList: false,
            amount: '',
            split: 100,
          });
      }
      for (const p of slot.waitList) {
        if (p.name?.trim())
          wlPlayers.push({
            slotId: slot._id,
            playerId: String(p._id),
            name: p.name,
            isWaitList: true,
            amount: '0',
            split: 100,
          });
      }
    }
    const split =
      mainPlayers.length > 0
        ? (Math.round((totalInput / mainPlayers.length) * 100) / 100).toString()
        : '0';
    const rows: PlayerAmtRow[] = [
      ...mainPlayers.map((r) => ({ ...r, amount: split })),
      ...wlPlayers,
    ];
    setApplyModal({
      open: true,
      groupKey,
      rows,
      includeWaitlist: false,
      originalTotal: totalInput,
    });
    setEditAmtKey(null);
  }

  function handleSplitChange(idx: number, value: 100 | 75 | 50 | 25 | 0) {
    setApplyModal((prev) => {
      const rows = prev.rows.map((r, i) => (i === idx ? { ...r, split: value } : { ...r }));

      const totalWeight = rows.reduce((sum, r) => {
        if (r.isWaitList && !prev.includeWaitlist) return sum;
        return sum + r.split / 100;
      }, 0);

      return {
        ...prev,
        rows: rows.map((r) => {
          if (r.isWaitList && !prev.includeWaitlist) return { ...r, amount: '0' };
          if (totalWeight === 0) return { ...r, amount: '0' };
          const exact = (prev.originalTotal / totalWeight) * (r.split / 100);
          return { ...r, amount: (Math.round(exact * 100) / 100).toString() };
        }),
      };
    });
  }

  function toggleIncludeWaitlist(checked: boolean) {
    setApplyModal((prev) => {
      const eligibleCount = checked
        ? prev.rows.length
        : prev.rows.filter((r) => !r.isWaitList).length;

      const split =
        eligibleCount > 0
          ? (Math.round((prev.originalTotal / eligibleCount) * 100) / 100).toString()
          : '0';

      return {
        ...prev,
        includeWaitlist: checked,
        rows: prev.rows.map((r) => {
          if (r.isWaitList && !checked) return { ...r, amount: '0', split: 100 };
          return { ...r, amount: split, split: 100 };
        }),
      };
    });
  }

  function redistributeFromTotal(newTotal: number) {
    setApplyModal((prev) => {
      const eligible = prev.rows.filter((r) => !r.isWaitList || prev.includeWaitlist);
      if (eligible.length === 0) return prev;
      const split = (Math.round((newTotal / eligible.length) * 100) / 100).toString();
      return {
        ...prev,
        originalTotal: newTotal, // ← update the anchor when admin explicitly sets a new total
        rows: prev.rows.map((r) => {
          if (r.isWaitList && !prev.includeWaitlist) return r;
          return { ...r, amount: split, split: 100 };
        }),
      };
    });
  }

  function handleSaveApplyModal(applyPlayerCount: number, originalTotal: number) {
    confirm(
      `Confirm <b>$${fmt(originalTotal)}</b> (including birdies + tax) as the total for <b>${applyPlayerCount}</b> players for this session?`,
      async () => {
        try {
          await saveApplyModal(originalTotal);
        } catch {
          showOkayMsg('Failed to apply the amount. Please try again.');
        }
      },
      undefined,
      false,
      'Confirm Amount',
      '#22c55e',
    );
  }

  async function saveApplyModal(originalTotal: number) {
    const { rows, groupKey } = applyModal;
    const bySlot = new Map<
      string,
      {
        totalAmt: number;
        players: { _id: string; playerAmt: number }[];
        waitList: { _id: string; playerAmt: number }[];
      }
    >();
    for (const row of rows) {
      if (!bySlot.has(row.slotId))
        bySlot.set(row.slotId, { totalAmt: originalTotal, players: [], waitList: [] });
      const entry = bySlot.get(row.slotId)!;
      const amt = parseFloat(row.amount) || 0;
      if (row.isWaitList) entry.waitList.push({ _id: row.playerId, playerAmt: amt });
      else entry.players.push({ _id: row.playerId, playerAmt: amt });
    }
    const activeSlots = Object.values(groupedSlots)
      .flat()
      .filter((s) => !s.slotArchived && `${s.date}__${s.time}` === groupKey);
    for (const slot of activeSlots) {
      if (!bySlot.has(slot._id))
        bySlot.set(slot._id, { totalAmt: originalTotal, players: [], waitList: [] });
    }
    setApplyModal(APPLY_CLOSED);
    setEditingTotal(false);
    setTotalInputValue('');

    await withLoader('Saving amounts...', async () => {
      await Promise.all(
        Array.from(bySlot.entries()).map(([slotId, data]) =>
          updateAmount(slotId, {
            totalAmt: data.totalAmt,
            players: data.players,
            waitList: data.waitList,
          }),
        ),
      );
    });

    fetchSelf(); //Ensure the current user's balance payment is updated after the payment is posted to the server
  }

  // ── user actions ──────────────────────────────────────────────────────────
  function handleApproveUser(u: User) {
    confirm(
      `Approve registration for ${u.name} ?`,
      async () => {
        try {
          await approveUser(u._id);
          setUsers((prev) =>
            prev.map((user) => (user._id === u._id ? { ...user, profileApproved: true } : user)),
          );
        } catch {
          showOkayMsg('Failed to approve user. Please try again.');
        }
      },
      undefined,
      false,
      'Approve',
      '#22c55e',
    );
  }

  function handleDeleteUser(u: User) {
    confirm(
      `Warning! Are you sure you want to delete this user? This could have serious consequences and could affect current or recent bookings. Only delete if user is inactive for more than 60 days.`,
      async () => {
        try {
          await deleteUser(u._id);
          setUsers((prev) => prev.filter((x) => x._id !== u._id));
        } catch {
          showOkayMsg('Failed to delete user. Please try again.');
        }
      },
      undefined,
      false,
      'Remove',
      '#dc2626',
    );
  }

  // ── users sort ────────────────────────────────────────────────────────────
  function handleUserSort(key: UserSortKey) {
    if (userSortKey === key) {
      setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortKey(key);
      setUserSortDir('asc');
    }
  }

  function getContact(u: User): string {
    return u.email ?? u.phone ?? '';
  }

  function sortedUsers(): User[] {
    return [...users].sort((a, b) => {
      let cmp = 0;
      if (userSortKey === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (userSortKey === 'contact') {
        const ca = getContact(a);
        const cb = getContact(b);
        // emails before phones (emails contain @)
        const aIsEmail = ca.includes('@');
        const bIsEmail = cb.includes('@');
        if (aIsEmail && !bIsEmail) cmp = -1;
        else if (!aIsEmail && bIsEmail) cmp = 1;
        else cmp = ca.localeCompare(cb);
      } else if (userSortKey === 'lastLogin') {
        const ta = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
        const tb = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
        cmp = ta - tb;
      } else if (userSortKey === 'profileApproved') {
        cmp = a.profileApproved === b.profileApproved ? 0 : a.profileApproved ? -1 : 1;
      } else if (userSortKey === 'netPayments') {
        const pa = parseFloat((a.balancePayments ?? '0').toString().replace('$', ''));
        const pb = parseFloat((b.balancePayments ?? '0').toString().replace('$', ''));
        cmp = pa - pb;
      }
      return userSortDir === 'asc' ? cmp : -cmp;
    });
  }

  const timeRangeInvalid = parseTime(createFrom) >= parseTime(createTo);

  // ── comment modal state ───────────────────────────────────────────────────
  const COMMENT_LIMIT = 150;
  const [commentModal, setCommentModal] = useState<{
    open: boolean;
    userId: string;
    name: string;
    value: string;
  }>({
    open: false,
    userId: '',
    name: '',
    value: '',
  });
  const [commentSaving, setCommentSaving] = useState(false);

  function openCommentModal(u: User) {
    setCommentModal({ open: true, userId: u._id, name: u.name, value: u.comments ?? '' });
  }

  function closeCommentModal() {
    setCommentModal({ open: false, userId: '', name: '', value: '' });
  }

  async function saveComment() {
    setCommentSaving(true);
    try {
      await addUserComments(commentModal.userId, { comments: commentModal.value.trim() });
      setUsers((prev) =>
        prev.map((u) =>
          u._id === commentModal.userId ? { ...u, comments: commentModal.value.trim() } : u,
        ),
      );
      closeCommentModal();
    } catch {
      showOkayMsg('Failed to save comment. Please try again.');
    } finally {
      setCommentSaving(false);
    }
  }

  const commentIsEmpty = commentModal.value.trim().length === 0;
  const commentOverLimit = commentModal.value.length > COMMENT_LIMIT;
  const commentSaveDisabled = commentSaving || commentIsEmpty || commentOverLimit;

  // ── settle payments ────────────────────────────────────────────────────────────────
  const [settleModal, setSettleModal] = useState<{
    open: boolean;
    userId: string;
    name: string;
    balance: number;
    value: string;
  }>({ open: false, userId: '', name: '', balance: 0, value: '' });
  const [settleSaving, setSettleSaving] = useState(false);

  function openSettleModal(u: User) {
    setSettleModal({
      open: true,
      userId: u._id,
      name: u.name,
      balance: u.balancePayments,
      value: '',
    });
  }

  function closeSettleModal() {
    setSettleModal({ open: false, userId: '', name: '', balance: 0, value: '' });
  }

  async function handleSettle() {
    const amt = parseFloat(settleModal.value);
    setSettleSaving(true);
    try {
      await settlePayment(settleModal.userId, { amount: amt });
      fetchUsers();
      fetchSelf();
      setUsers((prev) =>
        prev.map((u) =>
          u._id === settleModal.userId
            ? { ...u, balancePayments: Math.round((u.balancePayments - amt) * 100) / 100 }
            : u,
        ),
      );
      closeSettleModal();
    } catch {
      showOkayMsg('Failed to settle payment. Please try again.');
    } finally {
      setSettleSaving(false);
    }
  }

  const settleAmt = parseFloat(settleModal.value);
  const settleInvalid = isNaN(settleAmt) || settleAmt <= 0 || settleAmt > settleModal.balance;
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
        .ap-balance-payments-label { font-size: 12px; color: #555; }
        .ap-player-btn {
          background: #22c55e; color: #000; border: none; border-radius: 7px;
          padding: 7px 13px; font-family: 'Syne', sans-serif; font-size: 12px;
          font-weight: 700; cursor: pointer; transition: opacity 0.2s; width: auto; margin: 0;
        }
        .ap-player-btn:hover { opacity: 0.85; }
        .ap-btn-ghost {
          background: transparent; border: 1px solid #333; color: #888;
          border-radius: 7px; padding: 7px 13px; font-size: 12px; cursor: pointer;
          transition: all 0.2s; width: auto; margin: 0;
        }
        .ap-btn-ghost:hover { color: #fff; border-color: #666; }

        /* ── page-level tabs ── */
        .ap-page-tabs {
          background: #111;
          border-bottom: 1px solid #1e1e1e;
          padding: 0 20px;
          display: flex;
          gap: 0;
        }
        .ap-page-tab {
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: #555;
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.3px;
          padding: 14px 20px 12px;
          cursor: pointer;
          transition: color 0.2s, border-color 0.2s;
          width: auto;
          margin: 0;
        }
        .ap-page-tab:hover { color: #bbb; }
        .ap-page-tab.active { color: #22c55e; border-bottom-color: #22c55e; }

        .ap-container { max-width: 960px; margin: 0 auto; padding: 24px 16px 60px; }
        .ap-container.users-tab {
          max-width: 1200px;
        }
        .ap-section-title {
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: #555; text-transform: uppercase; letter-spacing: 1px;
          margin-bottom: 12px; margin-top: 28px;
        }

        .ap-create-card { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 20px; }
        .ap-form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr auto auto; gap: 10px; align-items: end; }
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
        .ap-slot-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #f0f0f0; display: flex; align-items: center; gap: 8px; margin: 12px 1px }
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

        .ap-group-amount-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #131313; border: 1px solid #1e1e1e; border-radius: 10px; margin-bottom: 12px; flex-wrap: wrap; }
        .ap-amount-label { font-size: 12px; color: #666; white-space: nowrap; }
        .ap-amount-value { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; color: #22c55e; }
        .ap-amount-input { width: 100px; padding: 6px 10px; background: #111; border: 1px solid #22c55e; border-radius: 6px; color: #22c55e; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; outline: none; margin-top: 0; }
        .ap-amount-save { padding: 6px 14px; background: #22c55e; color: #000; border: none; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: 'Syne', sans-serif; width: auto; margin: 0; transition: opacity 0.15s; }
        .ap-amount-save:disabled { opacity: 0.35; cursor: not-allowed; }
        .ap-amount-edit-btn { background: transparent; border: 1px solid #2a2a2a; color: #666; border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; transition: all 0.2s; width: auto; margin: 0; }
        .ap-amount-edit-btn:hover { color: #fff; border-color: #444; }

        .ap-players-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .ap-player-chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; font-weight: 500; }
        .ap-player-chip.filled { background: #ffedd5; color: #9a3412; }
        .ap-player-chip.empty  { background: #1e1e1e; color: #555; border: 1px dashed #333; }
        .ap-player-chip.wl     { background: #1e3a8a22; color: #93c5fd; border: 1px solid #1e3a8a44; }
        .ap-paid-coin { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; border-radius: 999px; font-size: 10px; font-weight: 800; font-family: 'DM Sans', sans-serif; flex-shrink: 0; padding: 0 4px; }
        .ap-paid-coin.paid   { color: #22c55e; background: #22c55e18; border: 1.5px solid #22c55e; }
        .ap-paid-coin.unpaid { color: #ef4444; background: #ef444418; border: 1.5px solid #ef4444; }

        .ap-apply-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 9997; padding: 16px; }
        .ap-apply-modal { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 16px 12px; width: 100%; max-width: 480px; box-shadow: 0 30px 80px rgba(0,0,0,0.7); display: flex; flex-direction: column; gap: 12px; max-height: 90vh; overflow-y: auto; }
        .ap-apply-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; color: #f0f0f0; }
        .ap-apply-subtitle { font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 800; color: #22c55e; }
        .ap-apply-subtitle-info { font-size: 12px; color: #555; margin-top: 2px; }
        .ap-apply-list { overflow-y: auto; max-height: 380px; row-gap: 4px; column-gap: 4px; scrollbar-gutter: stable; padding 0 8px; }
        .ap-apply-list::-webkit-scrollbar { width: 4px; }
        .ap-apply-list::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        .ap-apply-list::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        .ap-apply-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) repeat(5, 28px) 72px; align-items: center; gap: 4px; padding: 8px 8px; background: #1a1a1a; border: 1px solid #222; border-radius: 8px; }
        .ap-apply-row.wl-disabled { opacity: 0.45; }
        .ap-apply-serial { font-size: 11px; font-weight: 700; color: #444; text-align: center; font-family: 'Syne', sans-serif; }
        .ap-apply-name-main { font-size: 13px; color: #d0d0d0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ap-apply-sublabel { font-size: 10px; color: #555; margin-top: 1px; }
        .ap-apply-list-header { display: grid; grid-template-columns: 22px minmax(0, 1fr) repeat(5, 28px) 72px; gap: 4px; padding: 0 8px 6px; border-bottom: 1px solid #222; margin-bottom: 2px; }
        .ap-apply-list-header-cell { font-family: 'Syne', sans-serif; font-size: 9px; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: 0.3px; text-align: center; }
        .ap-apply-list-header-cell.left { text-align: left; }

        /* split sub-header group label */
        .ap-apply-split-group { grid-column: span 5; text-align: center; font-family: 'Syne', sans-serif; font-size: 9px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 0.8px; padding-bottom: 4px; border-bottom: 1px solid #222; margin-bottom: 2px; }

        /* radio button styling */
        .ap-split-radio { display: flex; align-items: center; justify-content: center; }
        .ap-split-radio input[type="radio"] { width: 13px; height: 13px; accent-color: #22c55e; cursor: pointer; margin: 0; }
        .ap-split-radio input[type="radio"]:disabled { opacity: 0.25; cursor: not-allowed; }
        .ap-apply-amt-wrap { display: flex; align-items: center; gap: 4px; }
        .ap-apply-amt-symbol { font-size: 12px; color: #555; }
        .ap-apply-amt-input { flex: 1; min-width: 0; width: 0; padding: 6px 4px; background: #111; border: 1px solid #2e2e2e; border-radius: 6px; color: #f0f0f0; font-family: 'DM Sans', sans-serif; font-size: 12px; outline: none; transition: border-color 0.2s; margin: 0; }
        .ap-apply-amt-input:focus { border-color: #22c55e; }
        .ap-apply-amt-input:disabled { opacity: 0.4; cursor: not-allowed; }
        .ap-wl-toggle { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #1a1a1a; border: 1px solid #222; border-radius: 8px; cursor: pointer; user-select: none; }
        .ap-wl-toggle input[type="checkbox"] { width: 15px; height: 15px; accent-color: #22c55e; cursor: pointer; margin: 0; }
        .ap-wl-toggle-label { font-size: 13px; color: #aaa; }
        .ap-apply-total { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #111; border-radius: 8px; border: 1px solid #1e1e1e; }
        .ap-apply-total-label { font-size: 12px; color: #555; }
        .ap-apply-total-value { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #22c55e; }
        .ap-apply-footer { display: flex; gap: 10px; }
        .ap-apply-save { flex: 1; padding: 10px; background: #22c55e; color: #000; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; transition: opacity 0.15s; }
        .ap-apply-save:disabled {background: #555}
        .ap-apply-save:hover { opacity: 0.85; }
        .ap-apply-cancel { flex: 1; padding: 10px; background: #2a2a2a; color: #aaa; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; }

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
        @media (max-width: 680px) {
          .ap-form-grid { grid-template-columns: 1fr 1fr; }
          .ap-form-grid .ap-form-field:nth-child(4) { grid-column: 1; }
          .ap-form-grid .ap-form-field:nth-child(5) { grid-column: 2; align-self: end; }
          .ap-create-btn { width: 100%; }
          .ap-topbar { padding: 12px 14px; flex-wrap: wrap; gap: 8px; }
          .ap-topbar-right { gap: 8px; flex-wrap: wrap; }
          .ap-container { padding: 16px 12px 60px; }
        }
        @media (max-width: 520px) {
        .ap-apply-list { grid-template-columns: 18px minmax(0, 1fr) repeat(5, 24px) 62px !important; gap: 3px; padding: 0 6px; }
        .ap-apply-unified-header { grid-template-columns: 18px minmax(0, 1fr) repeat(5, 24px) 62px; gap: 3px; padding: 0 6px;}
        .ap-apply-row,
        .ap-apply-list-header { grid-template-columns: 18px minmax(0, 1fr) repeat(5, 24px) 62px; gap: 3px; padding: 7px 6px; }
        .ap-apply-list-header-cell { font-size: 8px; letter-spacing: 0; }
        .ap-apply-serial { font-size: 10px; }
        .ap-apply-name-main { font-size: 11px; }
        .ap-apply-sublabel { font-size: 9px; }
        .ap-apply-amt-symbol { display: none; }
        .ap-apply-amt-input { font-size: 11px; padding: 5px 3px; }
        .ap-split-radio input[type="radio"] { width: 12px; height: 12px; }
        }

        /* ── users table ── */
        .usr-table-wrap {
          overflow-x: auto;
          border-radius: 14px;
          border: 1px solid #1e1e1e;
        }
        .usr-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .usr-table thead tr {
          background: #111;
          border-bottom: 1px solid #222;
        }
        .usr-table th {
          padding: 12px 14px;
          text-align: left;
          font-family: 'Syne', sans-serif;
          font-size: 11px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          white-space: nowrap;
          user-select: none;
        }
        .usr-table th.center { text-align: center; }
        .usr-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #1a1a1a;
          color: #ccc;
          vertical-align: middle;
        }
        .usr-table td.center { text-align: center; }
        .usr-table tbody tr { background: #161616; transition: background 0.15s; }
        .usr-table tbody tr:last-child td { border-bottom: none; }
        .usr-table tbody tr:hover { background: #1c1c1c; }

        .usr-th-inner {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .usr-sort-arrow {
          font-size: 12px;
          color: #444;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 4px;
          transition: color 0.15s, background 0.15s;
          line-height: 1;
          display: inline-block;
        }
        .usr-sort-arrow:hover { color: #bbb; background: #222; }
        .usr-sort-arrow.active { color: #22c55e; }

        .usr-sl { font-size: 12px; color: #444; font-weight: 600; }
        .usr-name { font-weight: 600; color: #f0f0f0; }
        .usr-contact { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #888; }
        .usr-login { font-size: 12px; color: #666; white-space: nowrap; }
        .usr-login-never { font-size: 12px; color: #333; font-style: italic; }
        .usr-remove-txt { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #888; }

        /* ── net payments cell ── */
        .usr-net-pay {
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          cursor: default;
          transition: opacity 0.15s;
        }
        .usr-net-pay-cell {
          position: relative;
          min-width: 100px;
        }
        .usr-settle-btn {
          background: #f59e0b18;
          border: 1px solid #f59e0b55;
          color: #fbbf24;
          font-family: 'Syne', sans-serif;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          padding: 5px 10px;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          width: auto;
          margin: 0;
          white-space: nowrap;
        }
        .usr-settle-btn:hover { background: #f59e0b30; border-color: #f59e0b99; }

        /* ── settle modal ── */
        .usr-settle-input {
          width: 100%;
          padding: 10px 12px;
          background: #111;
          border: 1px solid #2e2e2e;
          border-radius: 10px;
          color: #f0f0f0;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
          margin: 8px 0 4px;
          text-align: center;
        }
        .usr-settle-input:focus { border-color: #22c55e; }
        .usr-settle-input.invalid { border-color: #ef4444; }

        .usr-status-approved {
          display: inline-block;
          background: #22c55e18;
          border: 1px solid #22c55e44;
          color: #4ade80;
          font-family: 'Syne', sans-serif;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          padding: 4px 10px;
          border-radius: 999px;
        }
        .usr-approve-btn {
          background: #f59e0b18;
          border: 1px solid #f59e0b55;
          color: #fbbf24;
          font-family: 'Syne', sans-serif;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          padding: 5px 12px;
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          width: auto;
          margin: 0;
        }
        .usr-approve-btn:hover {
          background: #f59e0b30;
          border-color: #f59e0b99;
          transform: translateY(-1px);
        }
        .usr-approve-btn:active { transform: translateY(0); }

        .usr-remove-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 15px;
          padding: 4px 6px;
          opacity: 0.6;
          transition: opacity 0.15s, transform 0.1s;
          width: auto;
          margin: 0;
          line-height: 1;
        }
        .usr-remove-btn:hover { opacity: 1; transform: scale(1.1); }

        .usr-loader { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 48px 0; color: #444; font-size: 14px; }
        .usr-spinner { width: 20px; height: 20px; border: 2px solid #222; border-top-color: #22c55e; border-radius: 50%; animation: spin 0.8s linear infinite; }
        .usr-empty { text-align: center; color: #444; font-size: 14px; padding: 40px 0; }

        /* ── comments cell ── */
        .usr-comment-cell {
          cursor: pointer;
          max-width: 220px;
        }
        .usr-comment-preview {
          font-size: 12px;
          color: #666;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
          display: block;
          transition: color 0.15s;
        }
        .usr-comment-empty {
          font-size: 12px;
          color: #2a2a2a;
          font-style: italic;
          transition: color 0.15s;
        }
        .usr-comment-cell:hover .usr-comment-preview,
        .usr-comment-cell:hover .usr-comment-empty {
          color: #888;
        }

        /* ── comment edit modal ── */
        .usr-comment-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
          animation: fadeIn 0.15s ease;
        }
        .usr-comment-modal {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 16px;
          padding: 24px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.8);
          display: flex;
          flex-direction: column;
          gap: 14px;
          animation: slideUp 0.2s cubic-bezier(0.16,1,0.3,1);
        }
        .usr-comment-modal-title {
          font-family: 'Syne', sans-serif;
          font-size: 14px;
          font-weight: 800;
          color: #f0f0f0;
          letter-spacing: -0.2px;
        }
        .usr-comment-modal-name {
          font-size: 12px;
          color: #555;
          margin-top: 2px;
        }
        .usr-comment-textarea {
          width: 100%;
          min-height: 100px;
          padding: 10px 12px;
          background: #111;
          border: 1px solid #2e2e2e;
          border-radius: 10px;
          color: #f0f0f0;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          line-height: 1.5;
          outline: none;
          resize: vertical;
          transition: border-color 0.2s;
          margin: 0;
        }
        .usr-comment-textarea:focus { border-color: #22c55e; }
        .usr-comment-textarea.over-limit { border-color: #ef4444; }
        .usr-comment-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .usr-comment-char-count {
          font-size: 11px;
          color: #555;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .usr-comment-char-count.at-limit { color: #ef4444; font-weight: 700; }
        .usr-comment-actions {
          display: flex;
          gap: 8px;
        }
        .usr-comment-save {
          padding: 8px 18px;
          background: #22c55e;
          color: #000;
          border: none;
          border-radius: 8px;
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.15s;
          width: auto;
          margin: 0;
        }
        .usr-comment-save:hover:not(:disabled) { opacity: 0.85; }
        .usr-comment-save:disabled { opacity: 0.3; cursor: not-allowed; }
        .usr-comment-cancel {
          padding: 8px 16px;
          background: #252525;
          color: #888;
          border: none;
          border-radius: 8px;
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          width: auto;
          margin: 0;
        }
        .usr-comment-cancel:hover { background: #2e2e2e; color: #ccc; }

        /* ── resize modal ── */
        .ap-resize-modal { background: #161616; border: 1px solid #2a2a2a; border-radius: 16px; padding: 20px; width: 100%; max-width: 380px; box-shadow: 0 30px 80px rgba(0,0,0,0.7); display: flex; flex-direction: column; gap: 14px; }
        .ap-resize-modal-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; color: #f0f0f0; }
        .ap-resize-modal-subtitle { font-size: 12px; color: #555; margin-top: 2px; }
        .ap-resize-field { display: flex; flex-direction: column; gap: 6px; }
        .ap-resize-field label { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
        .ap-resize-field input { padding: 10px 12px; background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 8px; color: #f0f0f0; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; transition: border-color 0.2s; width: 100%; margin: 0; }
        .ap-resize-field input:focus { border-color: #f59e0b; }
        .ap-resize-field .ap-resize-hint { font-size: 10px; color: #f59e0b; }
        .ap-resize-footer { display: flex; gap: 10px; margin-top: 4px; }
        .ap-resize-confirm { flex: 1; padding: 10px; background: #f59e0b; color: #000; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; transition: opacity 0.15s; }
        .ap-resize-confirm:hover { opacity: 0.85; }
        .ap-resize-confirm:disabled { opacity: 0.35; cursor: not-allowed; }
        .ap-resize-cancel { flex: 1; padding: 10px; background: #2a2a2a; color: #aaa; border: none; border-radius: 8px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; margin: 0; }
        .ap-resize-btn { padding: 7px 12px; border-radius: 7px; border: 1px solid #f59e0b44; background: #f59e0b11; color: #f59e0b; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; width: auto; margin: 0; white-space: nowrap; }
        .ap-resize-btn:hover { background: #f59e0b22; border-color: #f59e0b88; }
      `}</style>

      {/* Loader */}
      {loading && (
        <div className="ap-loader">
          <div className="ap-spinner" />
          <span className="ap-loader-msg">{loaderMsg}</span>
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
              {!modal.hideCancel && (
                <button
                  className="ap-modal-btn ap-modal-cancel"
                  onClick={() => {
                    setModal(CLOSED);
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

      {/* Apply amounts modal */}
      {applyModal.open &&
        (() => {
          const applyPlayerCount = applyModal.includeWaitlist
            ? applyModal.rows.length
            : applyModal.rows.filter((p) => !p.isWaitList).length;

          const anyRowExceedsTotal = applyModal.rows.some(
            (r) => parseFloat(r.amount) > applyModal.originalTotal,
          );
          const applySaveDisabled = anyRowExceedsTotal;

          return (
            <div className="ap-apply-backdrop">
              <div className="ap-apply-modal">
                <div>
                  <div className="ap-apply-title">Apply Player Amounts:</div>
                  <div className="ap-apply-subtitle">{`(${applyPlayerCount} Players total)`}</div>
                  <div className="ap-apply-subtitle-info">
                    Amounts split equally across main players. Adjust individually if needed.
                  </div>
                </div>
                <div className="ap-apply-total">
                  <span className="ap-apply-total-label">Total amount for all players</span>
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
                        setTotalInputValue(fmt(applyModal.originalTotal));
                        setEditingTotal(true);
                      }}
                    >
                      ${fmt(applyModal.originalTotal)}
                    </span>
                  )}
                </div>
                {/* Single grid wrapper — header + rows share identical column tracks */}
                <div
                  className="ap-apply-list"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px minmax(0,1fr) repeat(5, 28px) 72px',
                    gap: '4px',
                    alignItems: 'center',
                  }}
                >
                  {/* Header row 1 — sticky */}
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: 0, background: '#161616', zIndex: 2 }}
                  >
                    NO.
                  </div>
                  <div
                    className="ap-apply-list-header-cell left"
                    style={{ position: 'sticky', top: 0, background: '#161616', zIndex: 2 }}
                  >
                    NAME
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{
                      gridColumn: 'span 5',
                      borderBottom: '1px solid #333',
                      paddingBottom: '2px',
                      position: 'sticky',
                      top: 0,
                      background: '#161616',
                      zIndex: 2,
                    }}
                  >
                    SPLIT
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: 0, background: '#161616', zIndex: 2 }}
                  >
                    AMOUNT
                  </div>

                  {/* Header row 2 — percentage labels */}
                  <div
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  />
                  <div
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  />
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  >
                    100%
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  >
                    75%
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  >
                    50%
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  >
                    25%
                  </div>
                  <div
                    className="ap-apply-list-header-cell"
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  >
                    0%
                  </div>
                  <div
                    style={{ position: 'sticky', top: '18px', background: '#161616', zIndex: 2 }}
                  />

                  {/* Divider spanning all 8 columns */}
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      borderBottom: '1px solid #222',
                      margin: '2px 0 4px',
                    }}
                  />

                  {/* Data rows — each cell is a direct grid child, not a sub-grid */}
                  {applyModal.rows.map((row, idx) => {
                    const isWlDisabled = row.isWaitList && !applyModal.includeWaitlist;
                    const splitOptions = [100, 75, 50, 25, 0] as const;
                    const rowOpacity = isWlDisabled ? 0.45 : 1;
                    return (
                      <React.Fragment key={`${row.slotId}-${row.playerId}`}>
                        {/* NO. */}
                        <span
                          className="ap-apply-serial"
                          style={{
                            opacity: rowOpacity,
                            background: '#1a1a1a',
                            padding: '8px 0 8px 8px',
                            borderRadius: idx === 0 ? '8px 0 0 8px' : '0',
                            alignSelf: 'stretch',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {idx + 1}
                        </span>

                        {/* NAME */}
                        <div
                          style={{
                            opacity: rowOpacity,
                            background: '#1a1a1a',
                            padding: '8px 4px',
                            alignSelf: 'stretch',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                          }}
                        >
                          <div className="ap-apply-name-main">{row.name}</div>
                          {row.isWaitList && <div className="ap-apply-sublabel">Waitlist</div>}
                        </div>

                        {/* SPLIT radios */}
                        {splitOptions.map((pct) => (
                          <div
                            key={pct}
                            className="ap-split-radio"
                            style={{
                              opacity: rowOpacity,
                              background: '#1a1a1a',
                              alignSelf: 'stretch',
                            }}
                          >
                            <input
                              type="radio"
                              name={`split-${row.slotId}-${row.playerId}`}
                              checked={row.split === pct}
                              disabled={isWlDisabled}
                              onChange={() => handleSplitChange(idx, pct)}
                            />
                          </div>
                        ))}

                        {/* AMOUNT */}
                        <div
                          className="ap-apply-amt-wrap"
                          style={{
                            opacity: rowOpacity,
                            background: '#1a1a1a',
                            padding: '8px 8px 8px 4px',
                            alignSelf: 'stretch',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <div className="ap-apply-name-main">$ {row.amount}</div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
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
                {anyRowExceedsTotal && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#ef4444',
                      textAlign: 'center',
                      padding: '4px 0',
                      fontWeight: 500,
                    }}
                  >
                    Individual player amount cannot be greater than total amount.
                  </div>
                )}
                <div className="ap-apply-footer">
                  <button
                    className="ap-apply-save"
                    onClick={() => handleSaveApplyModal(applyPlayerCount, applyModal.originalTotal)}
                    disabled={applySaveDisabled}
                  >
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
      {/* Resize modal */}
      {resizeModal.open &&
        resizeModal.slot &&
        (() => {
          const slot = resizeModal.slot;
          const maxCourts = slot.numberOfCourts;
          const availablePlayers = slot.players.filter(
            (p) => p.name == '' && p.ownerIdentifier == '',
          ).length;
          const maxPlayers = slot.players.length;
          const availableWaitlist = slot.waitList.filter(
            (p) => p.name == '' && p.ownerIdentifier == '',
          ).length;
          const maxWaitlist = slot.waitList.length;
          const nothingChanged =
            (parseInt(resizeModal.removeCourts) || 0) === 0 &&
            (parseInt(resizeModal.removePlayers) || 0) === 0 &&
            (parseInt(resizeModal.removeWaitlist) || 0) === 0;
          return (
            <div className="ap-modal-backdrop">
              <div className="ap-resize-modal">
                <div>
                  <div className="ap-resize-modal-title">Remove Courts / Players</div>
                  <div className="ap-resize-modal-subtitle">
                    {slot.date} · {slot.time}
                  </div>
                </div>
                <div className="ap-resize-field">
                  <label>Remove No. of Courts</label>
                  <span className="ap-resize-hint">
                    Currently booked: {maxCourts} Court(s), minimum 1 court should remain.
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={maxCourts}
                    value={resizeModal.removeCourts}
                    onChange={(e) =>
                      setResizeModal((p) => ({ ...p, removeCourts: e.target.value }))
                    }
                  />
                </div>
                <div className="ap-resize-field">
                  <label>Remove No. of Available Players</label>
                  <span className="ap-resize-hint">
                    Max. {availablePlayers} available players can be removed currently.
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={maxPlayers}
                    value={resizeModal.removePlayers}
                    onChange={(e) =>
                      setResizeModal((p) => ({ ...p, removePlayers: e.target.value }))
                    }
                  />
                </div>
                <div className="ap-resize-field">
                  <label>Remove No. of Available Waitlist Players</label>
                  <span className="ap-resize-hint">
                    Max. {availableWaitlist} available waitlist players can be removed currently.
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={maxWaitlist}
                    value={resizeModal.removeWaitlist}
                    onChange={(e) =>
                      setResizeModal((p) => ({ ...p, removeWaitlist: e.target.value }))
                    }
                  />
                </div>
                <div className="ap-resize-footer">
                  <button
                    className="ap-resize-confirm"
                    disabled={nothingChanged}
                    onClick={handleResize}
                  >
                    Apply
                  </button>
                  <button className="ap-resize-cancel" onClick={closeResizeModal}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      {/* Comment edit modal */}
      {commentModal.open && (
        <div className="usr-comment-backdrop" onClick={closeCommentModal}>
          <div className="usr-comment-modal" onClick={(e) => e.stopPropagation()}>
            <div>
              <div className="usr-comment-modal-title">Edit Comment</div>
              <div className="usr-comment-modal-name">{commentModal.name}</div>
            </div>
            <textarea
              className={`usr-comment-textarea${commentOverLimit ? ' over-limit' : ''}`}
              autoFocus
              value={commentModal.value}
              onChange={(e) => setCommentModal((prev) => ({ ...prev, value: e.target.value }))}
              placeholder="Add a note about this user..."
            />
            <div className="usr-comment-footer">
              <span className={`usr-comment-char-count${commentOverLimit ? ' at-limit' : ''}`}>
                {commentModal.value.length}/{COMMENT_LIMIT}
              </span>
              <div className="usr-comment-actions">
                <button className="usr-comment-cancel" onClick={closeCommentModal}>
                  Cancel
                </button>
                <button
                  className="usr-comment-save"
                  disabled={commentSaveDisabled}
                  onClick={saveComment}
                >
                  {commentSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Settle payment modal */}
      {settleModal.open && (
        <div className="ap-modal-backdrop">
          <div className="ap-modal">
            <div className="ap-modal-msg">
              <strong>Settle up this balance:</strong>
              <br />
              <small style={{ color: '#555' }}>
                {settleModal.name} · owes ${Math.round(settleModal.balance * 100) / 100}
              </small>
              <input
                className={`usr-settle-input${settleInvalid && settleModal.value !== '' ? ' invalid' : ''}`}
                type="number"
                min={0.01}
                max={settleModal.balance}
                step={0.01}
                placeholder={`0 – $${Math.round(settleModal.balance * 100) / 100}`}
                value={settleModal.value}
                autoFocus
                onChange={(e) => setSettleModal((prev) => ({ ...prev, value: e.target.value }))}
              />
              {settleInvalid && settleModal.value !== '' && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                  Amount cannot be greater than ${Math.round(settleModal.balance * 100) / 100}
                </div>
              )}
            </div>
            <div className="ap-modal-btns">
              <button
                className="ap-modal-btn"
                style={{
                  background: '#22c55e',
                  color: '#000',
                  opacity: settleInvalid || settleSaving ? 0.4 : 1,
                  cursor: settleInvalid || settleSaving ? 'not-allowed' : 'pointer',
                }}
                disabled={settleInvalid || settleSaving}
                onClick={handleSettle}
              >
                {settleSaving ? 'Saving...' : 'Confirm'}
              </button>
              <button className="ap-modal-btn ap-modal-cancel" onClick={closeSettleModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="ap-root">
        {/* Top bar */}
        <div className="ap-topbar">
          <div className="ap-brand">
            🏸 SBC Admin <span className="ap-badge">ADMIN</span>
          </div>
          <div className="ap-topbar-right">
            <span className="ap-balance-payments-label">Outstanding payments:</span>
            <span
              className="ap-balance-payments"
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

        {/* Page-level tabs */}
        <div className="ap-page-tabs">
          <button
            className={`ap-page-tab${activeTab === 'slots' ? ' active' : ''}`}
            onClick={() => setActiveTab('slots')}
          >
            📅 Slots &amp; Bookings
          </button>
          <button
            className={`ap-page-tab${activeTab === 'users' ? ' active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Registered Users
          </button>
        </div>

        <div className={`ap-container${activeTab === 'users' ? ' users-tab' : ''}`}>
          {/* ══════════════════════ SLOTS & BOOKINGS TAB ══════════════════════ */}
          {activeTab === 'slots' && (
            <>
              {/* Create */}
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
                          '7:00 AM',
                          '7:30 AM',
                          '8:00 AM',
                          '8:30 AM',
                          '9:00 AM',
                          '9:30 AM',
                          '10:00 AM',
                          '10:30 AM',
                          '11:00 AM',
                          '11:30 AM',
                          '12:00 PM',
                          '12:30 PM',
                          '1:00 PM',
                          '1:30 PM',
                          '2:00 PM',
                          '2:30 PM',
                          '3:00 PM',
                          '3:30 PM',
                          '4:00 PM',
                          '4:30 PM',
                          '5:00 PM',
                          '5:30 PM',
                          '6:00 PM',
                          '6:30 PM',
                          '7:00 PM',
                          '7:30 PM',
                          '8:00 PM',
                          '8:30 PM',
                          '9:00 PM',
                          '9:30 PM',
                          '10:00 PM',
                          '10:30 PM',
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
                          '7:30 AM',
                          '8:00 AM',
                          '8:30 AM',
                          '9:00 AM',
                          '9:30 AM',
                          '10:00 AM',
                          '10:30 AM',
                          '11:00 AM',
                          '11:30 AM',
                          '12:00 PM',
                          '12:30 PM',
                          '1:00 PM',
                          '1:30 PM',
                          '2:00 PM',
                          '2:30 PM',
                          '3:00 PM',
                          '3:30 PM',
                          '4:00 PM',
                          '4:30 PM',
                          '5:00 PM',
                          '5:30 PM',
                          '6:00 PM',
                          '6:30 PM',
                          '7:00 PM',
                          '7:30 PM',
                          '8:00 PM',
                          '8:30 PM',
                          '9:00 PM',
                          '9:30 PM',
                          '10:00 PM',
                          '10:30 PM',
                          '11:00 PM',
                        ].map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="ap-form-field">
                      <label>Total No. of Players</label>
                      <input
                        type="number"
                        className="ap-input"
                        min={4}
                        value={createNumPlayers}
                        onChange={(e) => setCreateNumPlayers(Number(e.target.value))}
                      />
                    </div>
                    <div className="ap-form-field">
                      <label>Total No. of Waitlist Players</label>
                      <input
                        type="number"
                        className="ap-input"
                        min={1}
                        value={createNumWaitlistPlayers}
                        onChange={(e) => setCreateNumWaitlistPlayers(Number(e.target.value))}
                      />
                    </div>
                    <div className="ap-form-field">
                      <label>No. of Courts Booked</label>
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

              {/* Manage */}
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
                    const displayTotal = Math.round((first.slotTotalAmount * 100) / 100);
                    const isEditingAmt = editAmtKey === groupKey;
                    return (
                      <div key={key} className="ap-group">
                        <div className="ap-group-label">
                          📅 {first.date} · {first.time}
                        </div>
                        {activeSlots.map((slot) => (
                          <div
                            key={slot._id}
                            className={`ap-slot-card${slot.slotLocked ? ' locked' : ''}${slot.slotHidden ? ' hidden' : ''}`}
                          >
                            <span className="ap-amount-label">
                              Total Amount (inc. birdies+tax):
                            </span>
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
                            <div className="ap-slot-header">
                              <div className="ap-slot-title">
                                {slot.numberOfCourts} Court(s)
                                {slot.slotLocked && <span className="ap-tag locked">LOCKED</span>}
                                {slot.slotHidden && <span className="ap-tag hidden">HIDDEN</span>}
                                <button
                                  className="ap-resize-btn"
                                  onClick={() => openResizeModal(slot)}
                                >
                                  ➖ Remove Courts / Players
                                </button>
                              </div>
                              <div className="ap-slot-actions">
                                <button
                                  title={
                                    slot.slotLocked
                                      ? 'Unlock this slot so others can edit their names.'
                                      : 'Lock this slot so others cannot add or edit any names.'
                                  }
                                  className={`ap-action-btn ${slot.slotLocked ? 'success' : 'warn'}`}
                                  onClick={() => handleLock(slot)}
                                >
                                  {slot.slotLocked ? '🔓 Unlock' : '🔒 Lock'}
                                </button>
                                <button
                                  title={
                                    slot.slotHidden
                                      ? 'Show this slot so others can see it in the Player View Page.'
                                      : 'Hide this slot from the Player View Page.'
                                  }
                                  className={`ap-action-btn ${slot.slotHidden ? 'success' : ''}`}
                                  onClick={() => handleHide(slot)}
                                >
                                  {slot.slotHidden ? '👁 Show' : '🙈 Hide'}
                                </button>
                                <button
                                  title={
                                    'Archive this slot so it is moved to a different "Archived Bookings" section. You can unarchive anytime.'
                                  }
                                  className="ap-action-btn"
                                  onClick={() => handleArchive(slot)}
                                >
                                  📦 Archive
                                </button>
                                <button
                                  title={
                                    'Delete this slot permanently. Note that this action cannot be undone!'
                                  }
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
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  {p.name || `P${i + 1} open`}
                                  {p.name && (
                                    <span
                                      className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}
                                    >
                                      {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                    </span>
                                  )}
                                </span>
                              ))}
                              {slot.waitList.map((p: Player, i: number) => (
                                <span
                                  key={i}
                                  className={`ap-player-chip ${p.name ? 'filled' : 'empty'}`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  {p.name || `WL${i + 1} open`}
                                  {p.name && (
                                    <span
                                      className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}
                                    >
                                      {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })
              )}

              {/* Archived */}
              {(() => {
                const allArchived = Object.values(groupedSlots)
                  .flat()
                  .filter((s) => s.slotArchived);

                if (allArchived.length === 0) return null;

                // Group archived slots by date__time, same as active bookings
                const archivedGroups = new Map<string, Slot[]>();
                for (const slot of allArchived) {
                  const key = `${slot.date}__${slot.time}`;
                  if (!archivedGroups.has(key)) archivedGroups.set(key, []);
                  archivedGroups.get(key)!.push(slot);
                }

                // Sort groups by date ascending
                const sortedGroups = Array.from(archivedGroups.entries()).sort(([, a], [, b]) => {
                  const da = new Date(`${a[0].date} ${a[0].time.split('–')[0].trim()}`);
                  const db = new Date(`${b[0].date} ${b[0].time.split('–')[0].trim()}`);
                  return da.getTime() - db.getTime();
                });

                return (
                  <>
                    <p className="ap-section-title">Archived Bookings</p>
                    {sortedGroups.map(([groupKey, slots]) => {
                      const first = slots[0];
                      const isExpanded = expandedArchiveIds.has(groupKey);

                      // One combined total across all courts in the group
                      const displayTotal = Math.round((first.slotTotalAmount * 100) / 100);

                      return (
                        <div key={groupKey} className="ap-archive-card">
                          <div
                            className="ap-archive-summary"
                            onClick={() => toggleArchiveExpand(groupKey)}
                          >
                            <div className="ap-archive-meta">
                              <span className="ap-archive-date">{first.date}</span>
                              <span className="ap-archive-time">{first.time}</span>
                              <span className="ap-archive-court">
                                {slots.length} court{slots.length > 1 ? 's' : ''}
                              </span>
                            </div>
                            <span className={`ap-archive-chevron${isExpanded ? ' open' : ''}`}>
                              ▼
                            </span>
                          </div>

                          {isExpanded && (
                            <div className="ap-archive-body">
                              {/* Single total for the whole group */}
                              <div className="ap-group-amount-bar" style={{ marginTop: '4px' }}>
                                <span className="ap-amount-label">Total Amount:</span>
                                <span className="ap-amount-value">
                                  {displayTotal > 0 ? `$${fmt(displayTotal)}` : '—'}
                                </span>
                              </div>

                              {/* One sub-card per court */}
                              {slots.map((slot, ci) => (
                                <div key={slot._id} style={{ marginTop: '10px' }}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      marginBottom: '6px',
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: '12px',
                                        fontFamily: "'Syne', sans-serif",
                                        fontWeight: 700,
                                        color: '#555',
                                      }}
                                    >
                                      Court {slot.courtNo > 0 ? slot.courtNo : ci + 1}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <button
                                        title="Unarchive this court booking back to Manage Bookings."
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
                                  <div className="ap-archive-players">
                                    {slot.players.map((p: Player, i: number) => (
                                      <span
                                        key={i}
                                        className={`ap-player-chip ${p.name ? 'filled' : 'empty'}`}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '5px',
                                        }}
                                      >
                                        {p.name || `P${i + 1} open`}
                                        {p.name && (
                                          <span
                                            className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}
                                          >
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
                                          <span
                                            className={`ap-paid-coin ${p.payment ? 'paid' : 'unpaid'}`}
                                          >
                                            {p.playerAmt > 0 ? `$${fmt(p.playerAmt)}` : '$'}
                                          </span>
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </>
          )}

          {/* ══════════════════════ REGISTERED USERS TAB ══════════════════════ */}
          {activeTab === 'users' && (
            <>
              <p className="ap-section-title">Registered Users</p>

              {usersLoading ? (
                <div className="usr-loader">
                  <div className="usr-spinner" />
                  Loading users...
                </div>
              ) : users.length === 0 ? (
                <p className="usr-empty">No registered users found.</p>
              ) : (
                <div className="usr-table-wrap">
                  <table className="usr-table">
                    <thead>
                      <tr>
                        <th style={{ width: 48 }}>SL NO</th>
                        <th style={{ minWidth: 130 }}>
                          <span className="usr-th-inner">
                            NAME{' '}
                            <SortArrow
                              col="name"
                              activeKey={userSortKey}
                              dir={userSortDir}
                              onSort={handleUserSort}
                            />
                          </span>
                        </th>
                        <th style={{ minWidth: 160 }}>
                          <span className="usr-th-inner">
                            CONTACT{' '}
                            <SortArrow
                              col="contact"
                              activeKey={userSortKey}
                              dir={userSortDir}
                              onSort={handleUserSort}
                            />
                          </span>
                        </th>
                        <th style={{ minWidth: 180, maxWidth: 220 }}>COMMENTS</th>
                        <th style={{ minWidth: 120 }}>
                          <span className="usr-th-inner">
                            LAST LOGIN{' '}
                            <SortArrow
                              col="lastLogin"
                              activeKey={userSortKey}
                              dir={userSortDir}
                              onSort={handleUserSort}
                            />
                          </span>
                        </th>
                        <th style={{ minWidth: 110 }}>
                          <span className="usr-th-inner"></span>
                          OUTSTANDING PAYMENTS{' '}
                          <SortArrow
                            col="netPayments"
                            activeKey={userSortKey}
                            dir={userSortDir}
                            onSort={handleUserSort}
                          />
                        </th>
                        <th style={{ width: 140 }} className="center">
                          <span className="usr-th-inner" style={{ justifyContent: 'center' }}>
                            APPROVAL STATUS{' '}
                            <SortArrow
                              col="profileApproved"
                              activeKey={userSortKey}
                              dir={userSortDir}
                              onSort={handleUserSort}
                            />
                          </span>
                        </th>
                        <th style={{ width: 100 }} className="center">
                          REMOVE USER
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers().map((u, idx) => (
                        <tr key={u._id}>
                          <td>
                            <span className="usr-sl">{idx + 1}</span>
                          </td>
                          <td>
                            <span className="usr-name">{u.name}</span>
                          </td>
                          <td>
                            <span className="usr-contact">{getContact(u)}</span>
                          </td>
                          <td
                            className="usr-comment-cell"
                            title={u.comments || 'Click to add a comment'}
                            onClick={() => openCommentModal(u)}
                          >
                            {u.comments ? (
                              <span className="usr-comment-preview">{u.comments}</span>
                            ) : (
                              <span className="usr-comment-empty">+ add</span>
                            )}
                          </td>
                          <td>
                            {u.lastLogin ? (
                              <span className="usr-login">{formatLastLogin(u.lastLogin)}</span>
                            ) : (
                              <span className="usr-login-never">Never</span>
                            )}
                          </td>
                          <td
                            className="usr-net-pay-cell"
                            onMouseEnter={() =>
                              u.balancePayments > 0 ? setSettleHovered(u._id) : undefined
                            }
                            onMouseLeave={() => setSettleHovered(null)}
                            onClick={() => {
                              if (u.balancePayments > 0) {
                                // on mobile tap: if not already showing the button, show it first;
                                // second tap (when button is shown) does nothing — the button itself handles it
                                if (settleHovered !== u._id) {
                                  setSettleHovered(u._id);
                                }
                              }
                            }}
                          >
                            {settleHovered === u._id && u.balancePayments > 0 ? (
                              <button
                                className="usr-settle-btn"
                                onClick={(e) => {
                                  e.stopPropagation(); // prevent the td onClick from re-triggering
                                  openSettleModal(u);
                                  setSettleHovered(null);
                                }}
                              >
                                SETTLE UP?
                              </button>
                            ) : (
                              <span
                                className="usr-net-pay"
                                style={{
                                  color: u.balancePayments > 0 ? '#f59e0b' : '#22c55e',
                                  // hint on mobile that positive values are tappable
                                  cursor: u.balancePayments > 0 ? 'pointer' : 'default',
                                }}
                              >
                                {u.balancePayments > 0
                                  ? `$${Math.round(u.balancePayments * 100) / 100}`
                                  : u.balancePayments < 0
                                    ? `-$${Math.round(Math.abs(u.balancePayments) * 100) / 100}`
                                    : '$0'}
                              </span>
                            )}
                          </td>
                          <td className="center">
                            {u.profileApproved ? (
                              <span className="usr-status-approved">✓ COMPLETED</span>
                            ) : (
                              <button
                                className="usr-approve-btn"
                                onClick={() => handleApproveUser(u)}
                              >
                                APPROVE
                              </button>
                            )}
                          </td>
                          <td className="center">
                            {u.role === 'user' ? (
                              <button
                                className="usr-remove-btn"
                                title="Delete user"
                                onClick={() => handleDeleteUser(u)}
                              >
                                ❌
                              </button>
                            ) : (
                              <span className="usr-remove-txt">ADMIN</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
