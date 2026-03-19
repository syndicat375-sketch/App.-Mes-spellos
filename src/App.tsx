import React, { useState, useEffect, useMemo, useCallback, Component } from 'react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  User
} from './firebase';
import { authService } from './services/authService';
import { googleSheetsService } from './services/googleSheetsService';
import { storageService } from './services/storageService';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  parseISO,
  isToday
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  Search, 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  LogOut, 
  User as UserIcon, 
  X, 
  Trash2, 
  Edit2,
  AlertCircle,
  Settings,
  Cloud,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Shift, Assignment, RelayType, ConfigType, RELAY_COLORS, UserProfile } from './types';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error.message || "Une erreur est survenue.";

      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50 text-red-900">
          <AlertCircle className="w-12 h-12 mb-4" />
          <h1 className="text-xl font-bold mb-2">Oups ! Quelque chose s'est mal passé.</h1>
          <p className="text-center max-w-md mb-4">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-accent-navy text-white rounded-lg hover:opacity-90 transition-colors"
          >
            Recharger l'application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Relay Badge Component
const RelayBadge = ({ type, showLabel }: { type: RelayType, showLabel?: boolean }) => (
  <div className="flex items-center gap-2">
    <div 
      className="w-3 h-3 rounded-full border border-black/10 shadow-sm" 
      style={{ backgroundColor: RELAY_COLORS[type] }}
    />
    {showLabel && <span className="text-sm font-medium capitalize">{type}</span>}
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('google_access_token'));
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(localStorage.getItem('google_spreadsheet_id'));
  const [userProfile, setUserProfile] = useState<UserProfile | null>(storageService.getProfile());
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>(storageService.getShifts());
  const [activeTab, setActiveTab] = useState<'calendar' | 'search' | 'settings'>('calendar');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGisLoaded, setIsGisLoaded] = useState(false);

  // GIS Initialization
  useEffect(() => {
    const initGis = async () => {
      try {
        await authService.loadGisScript();
        authService.initTokenClient((response) => {
          if (response.access_token) {
            console.log("GIS Token received");
            setAccessToken(response.access_token);
            localStorage.setItem('google_access_token', response.access_token);
            setInitError(null);
          } else if (response.error) {
            console.error("GIS Auth Error:", response.error, response.error_description);
            let msg = "Erreur d'authentification Google.";
            if (response.error === 'access_denied') msg = "L'accès a été refusé. Veuillez autoriser l'application.";
            if (response.error === 'invalid_client') msg = "Configuration OAuth invalide (Client ID).";
            if (response.error === 'redirect_uri_mismatch') msg = "L'URL de redirection ne correspond pas à la configuration.";
            setInitError(msg);
          }
        });
        setIsGisLoaded(true);
      } catch (error) {
        console.error("GIS Script load failed", error);
        setInitError("Impossible de charger le script d'authentification Google.");
      }
    };
    initGis();
  }, [user]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      if (!user) {
        setAccessToken(null);
        setSpreadsheetId(null);
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_spreadsheet_id');
      }
    });
    return unsubscribe;
  }, []);

  // Sync Logic
  const syncData = useCallback(async () => {
    if (!accessToken || !spreadsheetId || isSyncing) return;
    
    const localShifts = storageService.getShifts();
    const pendingShifts = localShifts.filter(s => s.syncStatus && s.syncStatus !== 'synced');
    const localProfile = storageService.getProfile();
    const isProfilePending = localProfile?.syncStatus === 'pending';
    
    if (pendingShifts.length === 0 && !isProfilePending) return;
    
    setIsSyncing(true);
    try {
      // Sync Profile first
      if (isProfilePending && localProfile) {
        await googleSheetsService.saveProfile(accessToken, spreadsheetId, localProfile);
        const updatedProfile = { ...localProfile, syncStatus: 'synced' as const };
        storageService.saveProfile(updatedProfile);
        setUserProfile(updatedProfile);
      }

      // Sync Shifts
      for (const shift of pendingShifts) {
        if (shift.syncStatus === 'pending_save') {
          await googleSheetsService.saveShift(accessToken, spreadsheetId, shift);
        } else if (shift.syncStatus === 'pending_delete') {
          await googleSheetsService.deleteShift(accessToken, spreadsheetId, shift.date);
        }
      }
      
      // After successful sync, refresh from remote to ensure consistency
      const remoteShifts = await googleSheetsService.getShifts(accessToken, spreadsheetId);
      const merged = storageService.mergeShifts(remoteShifts);
      setShifts(merged);
      
      // Also refresh profile
      const remoteProfile = await googleSheetsService.getProfile(accessToken, spreadsheetId);
      if (remoteProfile) {
        const fullProfile = { ...remoteProfile, syncStatus: 'synced' as const };
        storageService.saveProfile(fullProfile);
        setUserProfile(fullProfile);
      }
      
      setInitError(null);
    } catch (error: any) {
      console.error("Sync failed", error);
      if (error.status === 401) {
        console.log("Token expired during sync, refreshing...");
        authService.requestAccessToken('none');
      }
      // Don't block the user, just keep the pending status
    } finally {
      setIsSyncing(false);
    }
  }, [accessToken, spreadsheetId, isSyncing]);

  // Periodic Sync
  useEffect(() => {
    const interval = setInterval(syncData, 30000); // Try to sync every 30 seconds
    return () => clearInterval(interval);
  }, [syncData]);

  // Sync when coming back online
  useEffect(() => {
    window.addEventListener('online', syncData);
    return () => window.removeEventListener('online', syncData);
  }, [syncData]);

  // Initialize Sheets
  useEffect(() => {
    const initSheets = async () => {
      if (!user || !accessToken) return;
      
      setInitError(null);
      // Don't set isLoading to true if we already have local data to show
      const hasLocalData = shifts.length > 0;
      if (!hasLocalData) setIsLoading(true);

      try {
        let sid = spreadsheetId;
        
        // If we have a sid, verify it's accessible
        if (sid) {
          try {
            await googleSheetsService.getShifts(accessToken, sid);
          } catch (e: any) {
            console.warn("Stored spreadsheet ID is invalid or inaccessible, searching for a new one.", e);
            if (e.status === 401) {
              console.log("Token expired during init, refreshing...");
              authService.requestAccessToken('none');
              return;
            }
            sid = null;
            setSpreadsheetId(null);
            localStorage.removeItem('google_spreadsheet_id');
          }
        }

        if (!sid) {
          sid = await googleSheetsService.getSpreadsheetId(accessToken);
          if (!sid) {
            sid = await googleSheetsService.createSpreadsheet(accessToken);
          }
          setSpreadsheetId(sid);
          localStorage.setItem('google_spreadsheet_id', sid);
        }

        // Load profile
        const profile = await googleSheetsService.getProfile(accessToken, sid);
        if (profile) {
          setUserProfile(profile);
          storageService.saveProfile(profile);
        } else {
          const initialProfile = { displayName: user.displayName || '', email: user.email || '' };
          await googleSheetsService.saveProfile(accessToken, sid, initialProfile);
          const fullProfile = { uid: 'google-sheets', ...initialProfile };
          setUserProfile(fullProfile);
          storageService.saveProfile(fullProfile);
        }

        // Load shifts and merge
        const fetchedShifts = await googleSheetsService.getShifts(accessToken, sid);
        const merged = storageService.mergeShifts(fetchedShifts);
        setShifts(merged);
        
        // Trigger initial sync for any pending local changes
        syncData();
      } catch (error: any) {
        console.error("Failed to initialize sheets", error);
        if (error.status === 401) {
          console.log("Token expired during init, refreshing...");
          authService.requestAccessToken('none');
        } else {
          setInitError("Mode hors-ligne : Connexion Google Sheets indisponible.");
        }
      } finally {
        setIsLoading(false);
      }
    };

    if (isAuthReady && user && accessToken) {
      initSheets();
    }
  }, [isAuthReady, user, accessToken, spreadsheetId]);

  const handleLogin = async () => {
    if (!isGisLoaded) {
      setInitError("Le service d'authentification n'est pas encore prêt.");
      return;
    }
    
    try {
      // First ensure Firebase auth is done (for identity)
      if (!user) {
        await signInWithPopup(auth, googleProvider);
      }
      
      // Then request GIS token for Sheets access
      authService.requestAccessToken('consent');
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        setInitError("Le popup de connexion a été bloqué par votre navigateur.");
      } else {
        setInitError(`Échec de la connexion: ${error.message}`);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      if (accessToken) {
        authService.revokeToken(accessToken);
      }
      setAccessToken(null);
      setSpreadsheetId(null);
      localStorage.removeItem('google_access_token');
      localStorage.removeItem('google_spreadsheet_id');
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const refreshShifts = async () => {
    if (!accessToken || !spreadsheetId) return;
    try {
      const fetchedShifts = await googleSheetsService.getShifts(accessToken, spreadsheetId);
      const merged = storageService.mergeShifts(fetchedShifts);
      setShifts(merged);
    } catch (error) {
      console.error("Failed to refresh shifts", error);
    }
  };

  const handleSaveShift = async (shiftData: Omit<Shift, 'id'>) => {
    // Optimistic local save
    const newShift: Shift = { ...shiftData, syncStatus: 'pending_save' };
    const updatedShifts = storageService.updateShift(newShift);
    setShifts([...updatedShifts]);
    
    // Attempt background sync
    syncData();
  };

  const handleDeleteShift = async (date: string) => {
    // Optimistic local delete
    const updatedShifts = storageService.deleteShift(date);
    setShifts([...updatedShifts]);
    
    // Attempt background sync
    syncData();
  };

  const handleSaveProfile = async (profile: Partial<UserProfile>) => {
    const updatedProfile = storageService.updateProfile({ ...profile, syncStatus: 'pending' });
    setUserProfile(updatedProfile);
    // Trigger background sync
    syncData();
  };

  if (!isAuthReady || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-stone-50">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-accent-navy/20 rounded-full mb-4" />
          <div className="h-4 w-32 bg-stone-200 rounded" />
          <p className="mt-4 text-stone-400 text-sm font-medium">Initialisation de Google Sheets...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-stone-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-xl border border-stone-200 max-w-sm w-full text-center"
        >
          <div className="w-20 h-20 bg-accent-navy/10 rounded-xl flex items-center justify-center mx-auto mb-6">
            <CalendarIcon className="w-10 h-10 text-accent-navy" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2">Mes spellos</h1>
          <p className="text-stone-500 mb-8">Gérez vos relais de travail en toute simplicité.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-accent-navy text-white rounded-2xl font-semibold hover:opacity-90 transition-all flex items-center justify-center gap-3 shadow-lg shadow-stone-200"
          >
            <UserIcon className="w-5 h-5" />
            Se connecter avec Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50 text-stone-900 font-sans pb-24">
        {/* Header */}
        <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
          <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-accent-navy">Mes spellos</h1>
              {isSyncing ? (
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded-full animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>SYNCHRONISATION...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-full">
                  <Cloud className="w-3 h-3" />
                  <span>À JOUR</span>
                </div>
              )}
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-stone-400 hover:text-red-500 transition-colors"
              title="Déconnexion"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
          {initError && (
            <div className="bg-red-50 border-t border-red-100 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-600 text-sm font-medium">
                <AlertCircle className="w-4 h-4" />
                <span>{initError}</span>
              </div>
              <button 
                onClick={handleLogin}
                className="text-xs font-bold text-red-700 hover:underline"
              >
                Se reconnecter
              </button>
            </div>
          )}
        </header>

        <main className="max-w-4xl mx-auto p-4">
          <AnimatePresence mode="wait">
            {activeTab === 'calendar' ? (
              <CalendarView 
                key="calendar"
                shifts={shifts} 
                userProfile={userProfile}
                onDateClick={(date, shift) => {
                  setSelectedDate(date);
                  setEditingShift(shift || null);
                  setIsModalOpen(true);
                }}
              />
            ) : activeTab === 'search' ? (
              <SearchView 
                key="search"
                shifts={shifts} 
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
              />
            ) : (
              <SettingsView 
                key="settings"
                userProfile={userProfile}
                accessToken={accessToken}
                spreadsheetId={spreadsheetId}
                onProfileUpdate={handleSaveProfile}
                onReconnect={handleLogin}
              />
            )}
          </AnimatePresence>
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-accent-navy text-white rounded-full px-2 py-2 shadow-2xl flex items-center gap-1 z-30">
          <button 
            onClick={() => setActiveTab('calendar')}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-full transition-all",
              activeTab === 'calendar' ? "bg-white text-accent-navy shadow-inner" : "hover:bg-white/10"
            )}
          >
            <CalendarIcon className="w-5 h-5" />
            <span className="hidden sm:inline font-medium">Calendrier</span>
          </button>
          <button 
            onClick={() => setActiveTab('search')}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-full transition-all",
              activeTab === 'search' ? "bg-white text-accent-navy shadow-inner" : "hover:bg-white/10"
            )}
          >
            <Search className="w-5 h-5" />
            <span className="hidden sm:inline font-medium">Recherche</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-full transition-all",
              activeTab === 'settings' ? "bg-white text-accent-navy shadow-inner" : "hover:bg-white/10"
            )}
          >
            <Settings className="w-5 h-5" />
            <span className="hidden sm:inline font-medium">Paramètres</span>
          </button>
        </nav>

        {/* Shift Modal */}
        <AnimatePresence>
          {isModalOpen && selectedDate && (
            <ShiftModal 
              date={selectedDate}
              shift={editingShift}
              userProfile={userProfile}
              onClose={() => {
                setIsModalOpen(false);
                setEditingShift(null);
                refreshShifts();
              }}
              onSave={handleSaveShift}
              onDelete={handleDeleteShift}
            />
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

// --- Views ---

function CalendarView({ shifts, userProfile, onDateClick }: { 
  shifts: Shift[], 
  userProfile: UserProfile | null,
  onDateClick: (date: Date, shift?: Shift) => void,
  key?: string
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const monthShifts = useMemo(() => {
    return shifts.reduce((acc, shift) => {
      const dateStr = format(parseISO(shift.date), 'yyyy-MM-dd');
      acc[dateStr] = shift;
      return acc;
    }, {} as Record<string, Shift>);
  }, [shifts]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between bg-white p-4 rounded-3xl border border-stone-200 shadow-sm">
        <h2 className="text-2xl font-bold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: fr })}
        </h2>
        <div className="flex gap-2">
          <button 
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-stone-100 rounded-full transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-stone-100 rounded-full transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
          <div key={day} className="text-center text-xs font-bold text-stone-400 uppercase py-2">
            {day}
          </div>
        ))}
        {days.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const shift = monthShifts[dateStr];
          const isCurrentMonth = isSameMonth(day, currentMonth);
          
          // Find user's relay
          const userAssignment = shift?.assignments.find(a => 
            userProfile && a.employeeName.toLowerCase() === userProfile.displayName.toLowerCase()
          );

          return (
            <button
              key={dateStr}
              onClick={() => onDateClick(day, shift)}
              className={cn(
                "aspect-square p-2 rounded-2xl border transition-all flex flex-col items-center justify-between relative group",
                isCurrentMonth ? "bg-white border-stone-100 shadow-sm" : "bg-stone-50 border-transparent opacity-40",
                isToday(day) && "ring-2 ring-accent-navy ring-offset-2",
                shift ? "hover:border-accent-navy/20 hover:bg-accent-navy/5" : "hover:border-stone-300"
              )}
            >
              <span className={cn(
                "text-sm font-semibold",
                isToday(day) ? "text-accent-navy" : "text-stone-600"
              )}>
                {format(day, 'd')}
              </span>
              
              {shift && (
                <div className="flex flex-col items-center gap-1 mt-auto w-full">
                  <div className="absolute top-1 right-1 flex gap-1">
                    {shift.note && (
                      <div className="w-1.5 h-1.5 bg-accent-navy rounded-full animate-pulse" title="Note présente" />
                    )}
                    {shift.syncStatus && shift.syncStatus !== 'synced' && (
                      <div className="text-amber-500" title="En attente de synchronisation">
                        <Cloud className="w-3 h-3 animate-bounce" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1">
                    {userAssignment ? (
                      <div 
                        className="w-3 h-3 rounded-full border border-black/5"
                        style={{ backgroundColor: RELAY_COLORS[userAssignment.relayType] }}
                      />
                    ) : (
                      // Fallback if user not found in shift, show all dots small
                      <div className="flex gap-0.5">
                        {shift.assignments.map((a, i) => (
                          <div 
                            key={i}
                            className="w-1.5 h-1.5 rounded-full border border-black/5"
                            style={{ backgroundColor: RELAY_COLORS[a.relayType] }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function SearchView({ shifts, searchQuery, setSearchQuery }: { 
  shifts: Shift[], 
  searchQuery: string,
  setSearchQuery: (q: string) => void,
  key?: string
}) {
  const filteredShifts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    return shifts
      .filter(shift => 
        shift.employeeNames.some(name => name.toLowerCase().includes(query))
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [shifts, searchQuery]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
          <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
        <input 
          type="text"
          placeholder="Rechercher un employé..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-3xl border border-stone-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-navy/20 focus:border-accent-navy transition-all text-lg"
        />
      </div>

      <div className="space-y-4">
        {filteredShifts.length > 0 ? (
          filteredShifts.map(shift => (
            <div 
              key={shift.id}
              className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-accent-navy/10 rounded-xl flex items-center justify-center text-accent-navy">
                    <CalendarIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900">
                      {format(parseISO(shift.date), 'EEEE d MMMM yyyy', { locale: fr })}
                    </h3>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-stone-400 uppercase tracking-wider font-semibold">
                        {shift.configType === '2-employees' ? '2 Employés' : '3 Employés'}
                      </p>
                      {shift.syncStatus && shift.syncStatus !== 'synced' && (
                        <div className="flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-md">
                          <Cloud className="w-2.5 h-2.5" />
                          <span>EN ATTENTE</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {shift.note && (
                <div className="p-4 bg-accent-navy/5 rounded-2xl border border-accent-navy/10">
                  <p className="text-sm text-accent-navy italic">
                    <span className="font-bold not-italic mr-2">Note:</span>
                    "{shift.note}"
                  </p>
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shift.assignments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-stone-50 rounded-2xl border border-stone-100">
                    <span className={cn(
                      "font-medium",
                      a.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ? "text-accent-navy font-bold" : "text-stone-600"
                    )}>
                      {a.employeeName}
                    </span>
                    <RelayBadge type={a.relayType} showLabel />
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : searchQuery.trim() ? (
          <div className="text-center py-12 text-stone-400">
            <p>Aucun résultat pour "{searchQuery}"</p>
          </div>
        ) : (
          <div className="text-center py-12 text-stone-400">
            <p>Entrez un nom pour commencer la recherche</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SettingsView({ userProfile, accessToken, spreadsheetId, onProfileUpdate, onReconnect }: { 
  userProfile: UserProfile | null, 
  accessToken: string | null,
  spreadsheetId: string | null,
  onProfileUpdate: (profile: Partial<UserProfile>) => void,
  onReconnect: () => void,
  key?: string 
}) {
  const [name, setName] = useState(userProfile?.displayName || '');
  const [employees, setEmployees] = useState<string[]>(userProfile?.employees || []);
  const [newEmployee, setNewEmployee] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.displayName);
      setEmployees(userProfile.employees || []);
    }
  }, [userProfile]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onProfileUpdate({
        displayName: name,
        employees: employees
      });
    } catch (error) {
      console.error("Failed to save profile", error);
    } finally {
      setIsSaving(false);
    }
  };

  const addEmployee = () => {
    if (newEmployee.trim() && !employees.includes(newEmployee.trim())) {
      setEmployees([...employees, newEmployee.trim()]);
      setNewEmployee('');
    }
  };

  const removeEmployee = (emp: string) => {
    setEmployees(employees.filter(e => e !== emp));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-md mx-auto space-y-8 pb-24"
    >
      {/* Profile Section */}
      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600">
            <UserIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Mon Profil</h2>
            <p className="text-sm text-stone-400">Configurez votre nom pour le calendrier.</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Votre Nom</label>
          <input 
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Entrez votre nom..."
            className="w-full px-4 py-3 bg-stone-50 rounded-2xl border border-stone-100 focus:outline-none focus:ring-2 focus:ring-accent-navy/20 focus:border-accent-navy transition-all"
          />
        </div>
      </div>

      {/* Employees Section */}
      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Employés</h2>
            <p className="text-sm text-stone-400">Gérez la liste de vos collègues.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <input 
              type="text"
              value={newEmployee}
              onChange={(e) => setNewEmployee(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addEmployee()}
              placeholder="Nom de l'employé..."
              className="flex-1 px-4 py-3 bg-stone-50 rounded-2xl border border-stone-100 focus:outline-none focus:ring-2 focus:ring-accent-navy/20 focus:border-accent-navy transition-all"
            />
            <button 
              onClick={addEmployee}
              className="p-3 bg-accent-navy text-white rounded-2xl hover:opacity-90 transition-all"
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {employees.map(emp => (
              <div 
                key={emp}
                className="flex items-center gap-2 px-4 py-2 bg-stone-50 rounded-full border border-stone-100 text-sm font-medium text-stone-700"
              >
                <span>{emp}</span>
                <button 
                  onClick={() => removeEmployee(emp)}
                  className="text-stone-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {employees.length === 0 && (
              <p className="text-sm text-stone-400 italic">Aucun employé ajouté.</p>
            )}
          </div>
        </div>
      </div>

      {/* Google Connection Info */}
      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
        <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-stone-600">Connexion Google</span>
            <span className={cn(
              "text-xs font-bold px-2 py-1 rounded-md",
              accessToken && spreadsheetId ? "text-green-600 bg-green-50" : "text-amber-600 bg-amber-50"
            )}>
              {accessToken && spreadsheetId ? 'Connecté' : 'Mode Hors-ligne'}
            </span>
          </div>
          <p className="text-xs text-stone-400 mb-4">
            {accessToken && spreadsheetId 
              ? 'Votre application est synchronisée avec Google Sheets.' 
              : 'Les modifications seront enregistrées localement et synchronisées plus tard.'}
          </p>
          <button 
            onClick={onReconnect}
            className="w-full py-2 text-xs font-bold text-accent-navy bg-accent-navy/5 rounded-xl hover:bg-accent-navy/10 transition-colors"
          >
            {accessToken && spreadsheetId ? 'Changer de compte / Reconnecter' : 'Se connecter à Google Sheets'}
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="sticky bottom-0 pt-4 bg-stone-50/80 backdrop-blur-sm">
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-4 bg-accent-navy text-white rounded-2xl font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-stone-200"
        >
          {isSaving ? 'Enregistrement...' : 'Enregistrer les modifications'}
        </button>
      </div>
    </motion.div>
  );
}

// --- Components ---

function ShiftModal({ date, shift, userProfile, onClose, onSave, onDelete }: { 
  date: Date, 
  shift: Shift | null, 
  userProfile: UserProfile | null,
  onClose: () => void,
  onSave: (shift: Omit<Shift, 'id'>) => Promise<void>,
  onDelete: (date: string) => Promise<void>
}) {
  const [configType, setConfigType] = useState<ConfigType>(shift?.configType || '2-employees');
  const [assignments, setAssignments] = useState<Assignment[]>(
    shift?.assignments || [
      { employeeName: '', relayType: 'fini' },
      { employeeName: '', relayType: 'tard' }
    ]
  );
  const [note, setNote] = useState(shift?.note || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Update assignments when config changes
  useEffect(() => {
    if (shift) return; // Don't reset if editing existing shift

    if (configType === '2-employees') {
      setAssignments([
        { employeeName: '', relayType: 'fini' },
        { employeeName: '', relayType: 'tard' }
      ]);
    } else {
      setAssignments([
        { employeeName: '', relayType: 'fini' },
        { employeeName: '', relayType: 'shot' },
        { employeeName: '', relayType: 'tard' }
      ]);
    }
  }, [configType, shift]);

  const handleSave = async () => {
    if (assignments.some(a => !a.employeeName.trim())) {
      setErrorMessage("Veuillez remplir tous les noms d'employés.");
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);
    const shiftData: Omit<Shift, 'id'> = {
      date: format(date, 'yyyy-MM-dd'),
      configType,
      assignments,
      employeeNames: assignments.map(a => a.employeeName),
      createdBy: 'user',
      note
    };

    try {
      await onSave(shiftData);
      onClose();
    } catch (error) {
      console.error("Failed to save shift", error);
      setErrorMessage("Erreur lors de la sauvegarde.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!shift) return;
    
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    setIsSaving(true);
    try {
      await onDelete(shift.date);
      onClose();
    } catch (error) {
      console.error("Failed to delete shift", error);
      setErrorMessage("Erreur lors de la suppression.");
    } finally {
      setIsSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10 flex flex-col"
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <h3 className="text-xl font-bold text-accent-navy">
              {shift ? 'Modifier le relais' : 'Nouveau relais'}
            </h3>
            <p className="text-stone-500 font-medium">
              {format(date, 'EEEE d MMMM yyyy', { locale: fr })}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-stone-200 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-8 overflow-y-auto max-h-[70vh]">
          {errorMessage && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 text-sm font-medium border border-red-100">
              <AlertCircle className="w-5 h-5" />
              {errorMessage}
            </div>
          )}
          {showDeleteConfirm && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl flex flex-col gap-3 border border-red-100">
              <p className="font-bold">Confirmer la suppression ?</p>
              <div className="flex gap-2">
                <button 
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold"
                >
                  Supprimer
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
          {/* Config Selection */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Configuration</label>
            <div className="grid grid-cols-2 gap-3">
              {(['2-employees', '3-employees'] as ConfigType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setConfigType(type)}
                  disabled={!!shift}
                  className={cn(
                    "py-3 px-4 rounded-2xl border-2 transition-all font-semibold",
                    configType === type 
                      ? "border-accent-navy bg-accent-navy/5 text-accent-navy" 
                      : "border-stone-100 bg-stone-50 text-stone-400 hover:border-stone-200",
                    shift && configType !== type && "opacity-50 grayscale"
                  )}
                >
                  {type === '2-employees' ? '2 Employés' : '3 Employés'}
                </button>
              ))}
            </div>
          </div>

          {/* Assignments */}
          <div className="space-y-4">
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Affectations</label>
            <div className="space-y-3">
              {assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-3 p-4 bg-stone-50 rounded-2xl border border-stone-100 group focus-within:border-accent-navy/20 focus-within:bg-white transition-all">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <input 
                          type="text"
                          placeholder="Nom de l'employé"
                          value={a.employeeName}
                          onChange={(e) => {
                            const newAssignments = [...assignments];
                            newAssignments[i].employeeName = e.target.value;
                            setAssignments(newAssignments);
                          }}
                          className="w-full bg-transparent font-bold text-stone-900 placeholder:text-stone-300 focus:outline-none"
                        />
                        {userProfile?.employees && userProfile.employees.length > 0 && !a.employeeName && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {userProfile.employees.map(emp => (
                              <button
                                key={emp}
                                onClick={() => {
                                  const newAssignments = [...assignments];
                                  newAssignments[i].employeeName = emp;
                                  setAssignments(newAssignments);
                                }}
                                className="text-[9px] font-bold text-stone-500 bg-stone-200/50 px-2 py-0.5 rounded hover:bg-stone-200 transition-colors"
                              >
                                {emp}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {userProfile && a.employeeName.toLowerCase() !== userProfile.displayName.toLowerCase() && (
                        <button 
                          onClick={() => {
                            const newAssignments = [...assignments];
                            newAssignments[i].employeeName = userProfile.displayName;
                            setAssignments(newAssignments);
                          }}
                          className="text-[10px] font-bold text-accent-navy bg-accent-navy/5 px-2 py-1 rounded-md hover:bg-accent-navy/10 transition-colors ml-2"
                        >
                          Moi
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl border border-stone-200 shadow-sm">
                    <select 
                      value={a.relayType}
                      onChange={(e) => {
                        const newAssignments = [...assignments];
                        newAssignments[i].relayType = e.target.value as RelayType;
                        setAssignments(newAssignments);
                      }}
                      className="bg-transparent text-sm font-medium capitalize focus:outline-none cursor-pointer"
                    >
                      {(['fini', 'shot', 'tard'] as RelayType[]).map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <div 
                      className="w-3 h-3 rounded-full border border-black/10 shadow-sm" 
                      style={{ backgroundColor: RELAY_COLORS[a.relayType] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Note Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Note / Commentaire</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ajouter une note (ex: Hier j'avais fini, donc aujourd'hui c'est tard...)"
              className="w-full px-4 py-3 bg-stone-50 rounded-2xl border border-stone-100 focus:outline-none focus:ring-2 focus:ring-accent-navy/20 focus:border-accent-navy transition-all min-h-[100px] text-stone-700 placeholder:text-stone-300"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-6 bg-stone-50/50 border-top border-stone-100 flex gap-3">
          {shift && (
            <button
              onClick={handleDelete}
              disabled={isSaving}
              className="p-4 text-red-500 hover:bg-red-50 rounded-2xl transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-6 h-6" />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-4 bg-accent-navy text-white rounded-2xl font-bold hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-stone-200"
          >
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
