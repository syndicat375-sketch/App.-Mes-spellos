export type RelayType = 'fini' | 'shot' | 'tard';
export type ConfigType = '2-employees' | '3-employees';

export interface Assignment {
  employeeName: string;
  relayType: RelayType;
}

export interface Shift {
  id?: string;
  localId?: string; // For offline tracking
  date: string; // ISO 8601
  configType: ConfigType;
  assignments: Assignment[];
  employeeNames: string[];
  createdBy: string;
  note?: string;
  syncStatus?: 'synced' | 'pending_save' | 'pending_delete';
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  employees?: string[];
  syncStatus?: 'synced' | 'pending';
}

export const RELAY_COLORS: Record<RelayType, string> = {
  fini: '#91d050',
  shot: '#f86048',
  tard: '#ffff99',
};
