export interface Player {
  _id: string;
  name: string;
  ownerIdentifier: string;
  ownerName: string;
  lastUpdatedIdentifier: string;
  timeStamp: string;
  payment: boolean;
  playerAmt: number;
}

export interface Slot {
  _id: string;
  date: string;
  time: string;
  courtNo: number;
  numberOfCourts: number;
  slotLocked: boolean;
  slotHidden: boolean;
  slotArchived: boolean;
  slotAmountPublished: boolean;
  slotTotalAmount: number;
  players: Player[];
  waitList: Player[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAmountPayload {
  totalAmt: number;
  players: { _id: string; playerAmt: number }[];
  waitList: { _id: string; playerAmt: number }[];
}

export interface GroupedSlots {
  [key: string]: Slot[];
}

export interface SlotsResponse {
  sortedSlots: Slot[];
  groupedSlots: GroupedSlots;
}

export interface AuthUser {
  name: string;
  identifier: string;
  email: string | undefined;
  phone: string | undefined;
  role: 'user' | 'admin';
  balancePayments?: number;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterResponse {
  success: boolean;
  resetKey: string;
}

export interface LoginPayload {
  identifier: string;
  password: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  password: string;
  tosAgreed1: boolean;
  tosAgreed2: boolean;
}

export interface ResetByKeyPayload {
  identifier: string;
  resetKey: string;
  newPassword: string;
}

export interface ResetByKeyResponse {
  success: boolean;
  newResetKey: string;
}

export interface User {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  lastLogin: string; // ISO string or ""
  profileApproved: boolean;
  comments?: string;
  balancePayments: number;
  role: 'user' | 'admin';
}

export interface GetUsersResponse {
  users: User[];
}
