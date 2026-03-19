export type RelayType = 'fini' | 'shot' | 'tard';
export type ConfigType = '2-employees' | '3-employees';

export interface Assignment {
  employeeName: string;
  relayType: RelayType;
}

export interface Shift {
  id?: string;
  date: string; // ISO 8601
  configType: ConfigType;
  assignments: Assignment[];
  employeeNames: string[];
  createdBy: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
}

export const RELAY_COLORS: Record<RelayType, string> = {
  fini: '#91d050',
  shot: '#f86048',
  tard: '#ffff99',
};
