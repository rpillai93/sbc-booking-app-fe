import axios from 'axios';
import type {
  SlotsResponse,
  AuthResponse,
  LoginPayload,
  RegisterPayload,
  ResetByKeyPayload,
  ResetByKeyResponse,
  RegisterResponse,
  UpdateAmountPayload,
  GetUsersResponse,
} from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';

const getHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
});

export const login = (data: LoginPayload) => axios.post<AuthResponse>(`${BASE}/auth/login`, data);

export const register = (data: RegisterPayload) =>
  axios.post<RegisterResponse>(`${BASE}/auth/register`, data);

export const resetByKey = (data: ResetByKeyPayload) =>
  axios.post<ResetByKeyResponse>(`${BASE}/auth/reset-by-key`, data);

export const getSlots = () => axios.get<SlotsResponse>(`${BASE}/slots`, { headers: getHeaders() });

export const createSlot = (data: { date: string; time: string; courts: number }) =>
  axios.post(`${BASE}/slots`, data, { headers: getHeaders() });

export const deleteSlot = (id: string) =>
  axios.delete(`${BASE}/slots/${id}`, { headers: getHeaders() });

export const updatePlayer = (
  id: string,
  data: { playerIndex: number; name: string; lastUpdatedAt: string },
) => axios.patch(`${BASE}/slots/${id}/player`, data, { headers: getHeaders() });

export const updateAmount = (id: string, data: UpdateAmountPayload) =>
  axios.patch(`${BASE}/slots/${id}/amount`, data, { headers: getHeaders() });

export const updatePayment = (
  id: string,
  data: { playerIndex: number; paymentStatus: boolean; lastUpdatedAt: string },
) => axios.patch(`${BASE}/slots/${id}/payment`, data, { headers: getHeaders() });

export const lockSlot = (id: string, data: { isLocked: boolean }) =>
  axios.patch(`${BASE}/slots/${id}/lock`, data, { headers: getHeaders() });

export const hideSlot = (id: string, data: { isHidden: boolean }) =>
  axios.patch(`${BASE}/slots/${id}/hide`, data, { headers: getHeaders() });

export const archiveSlot = (id: string, data: { isArchived: boolean }) =>
  axios.patch(`${BASE}/slots/${id}/archive`, data, { headers: getHeaders() });

export const updateCourtNo = (id: string, data: { courtNo: number }) =>
  axios.patch(`${BASE}/slots/${id}/courtno`, data, { headers: getHeaders() });

export const getUsers = () =>
  axios.get<GetUsersResponse>(`${BASE}/users`, { headers: getHeaders() });

export const approveUser = (id: string) =>
  axios.patch(`${BASE}/users/${id}/approve`, {}, { headers: getHeaders() });

export const deleteUser = (id: string) =>
  axios.delete(`${BASE}/users/${id}`, { headers: getHeaders() });

export const addUserComments = (id: string, data: { comments: string }) =>
  axios.patch(`${BASE}/users/${id}/comment`, data, { headers: getHeaders() });
