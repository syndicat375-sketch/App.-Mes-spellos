import { Shift, UserProfile } from '../types';

const SHIFTS_KEY = 'mes_spellos_shifts';
const PROFILE_KEY = 'mes_spellos_profile';

export const storageService = {
  getShifts(): Shift[] {
    const data = localStorage.getItem(SHIFTS_KEY);
    return data ? JSON.parse(data) : [];
  },

  saveShifts(shifts: Shift[]) {
    localStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts));
  },

  getProfile(): UserProfile | null {
    const data = localStorage.getItem(PROFILE_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveProfile(profile: UserProfile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },

  updateProfile(profile: Partial<UserProfile>): UserProfile {
    const current = this.getProfile() || { uid: 'google-sheets', displayName: '', email: '', employees: [] };
    const updated = { ...current, ...profile };
    this.saveProfile(updated);
    return updated;
  },

  updateShift(shift: Shift): Shift[] {
    const shifts = this.getShifts();
    const index = shifts.findIndex(s => s.date === shift.date);
    
    if (index !== -1) {
      shifts[index] = { ...shifts[index], ...shift };
    } else {
      shifts.push({ ...shift, localId: crypto.randomUUID() });
    }
    
    this.saveShifts(shifts);
    return shifts;
  },

  deleteShift(date: string): Shift[] {
    const shifts = this.getShifts();
    const index = shifts.findIndex(s => s.date === date);
    
    if (index !== -1) {
      // If it's already synced, mark for deletion
      if (shifts[index].syncStatus === 'synced') {
        shifts[index].syncStatus = 'pending_delete';
      } else {
        // If it was never synced, just remove it
        shifts.splice(index, 1);
      }
    }
    
    this.saveShifts(shifts);
    return shifts;
  },

  // Merge remote shifts with local pending changes
  mergeShifts(remoteShifts: Shift[]): Shift[] {
    const localShifts = this.getShifts();
    const pendingChanges = localShifts.filter(s => s.syncStatus && s.syncStatus !== 'synced');
    
    // Start with remote shifts marked as synced
    const merged = remoteShifts.map(s => ({ ...s, syncStatus: 'synced' as const }));
    
    // Apply pending changes
    pendingChanges.forEach(pending => {
      const index = merged.findIndex(m => m.date === pending.date);
      if (pending.syncStatus === 'pending_delete') {
        if (index !== -1) merged.splice(index, 1);
      } else if (pending.syncStatus === 'pending_save') {
        if (index !== -1) {
          merged[index] = pending;
        } else {
          merged.push(pending);
        }
      }
    });
    
    this.saveShifts(merged);
    return merged;
  }
};
