export interface Player {
  _id: string;
  name: string;
  identifier: string;
  bookedBy: string;
  timeStamp: string;
  payment: boolean;
  playerAmt: number;
}

export interface Slot {
  _id: string;
  date: string;
  time: string;
  courtNo: number;
  slotLocked: boolean;
  slotHidden: boolean;
  slotArchived: boolean;
  players: Player[];
  waitList: Player[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAmountPayload {
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
