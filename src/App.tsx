/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronLeft, 
  Zap, 
  CheckCircle2, 
  Circle, 
  LayoutGrid, 
  Calendar, 
  ArrowRight,
  Sparkles,
  Trophy,
  Plus,
  X,
  Tag,
  Sprout,
  Leaf,
  Flower,
  TreeDeciduous,
  TreePine,
  Trees,
  LogOut,
  LogIn,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, collection, getDoc, writeBatch } from 'firebase/firestore';

// --- Types ---

type SprintStatus = 'not-started' | 'in-progress' | 'completed';

interface MicroGoal {
  text: string;
  category: string;
  days: boolean[]; // 10 days for this specific goal
}

interface DailyLog {
  date: string; // ISO string or YYYY-MM-DD
  encouragement: string;
  tasks: string[];
  taskStatus: boolean[];
  achievements: string[];
  gratitude: string[];
  reflection: string[];
  mood: string;
}

interface SprintData {
  id: number;
  microGoals: MicroGoal[]; // Up to 3
  days: boolean[]; // Overall energy check-in (deprecated in UI but kept for state)
  reflection: string; // Stage reflection
  currentDay: number;
  lastUpdated: string;
  dailyLogs: Record<string, DailyLog>; // Keyed by YYYY-MM-DD
}

interface AppState {
  sprints: Record<number, SprintData>;
}

type ViewState = 'year' | 'sprint' | 'journal';

// --- Constants ---

const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月"
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ENERGY_QUOTES = [
  "你的能量是你的货币。请明智地使用它。",
  "专注于进步，而非完美。",
  "小步快跑，终成大器。",
  "今天是一个成长的全新机会。",
  "持之以恒是精通的关键。",
  "注意力所在，能量随之流动。",
  "成为你想吸引的那种能量。",
  "脚踏实地，专注当下。",
  "未来的你会感谢今天的自己。",
  "休息也是一种生产力。倾听身体的声音。"
];

const CATEGORIES = [
  "健康", "关系", "财富", "知识", "事业", "精神", "娱乐", "个人成长"
];

const getSprintInfo = (sprintId: number) => {
  const monthIndex = Math.floor((sprintId - 1) / 3);
  const sprintInMonth = ((sprintId - 1) % 3) + 1;
  const monthName = MONTH_NAMES[monthIndex];
  
  let startDay = 1;
  let endDay = 10;
  let totalDays = 10;

  if (sprintInMonth === 1) {
    startDay = 1;
    endDay = 10;
    totalDays = 10;
  } else if (sprintInMonth === 2) {
    startDay = 11;
    endDay = 20;
    totalDays = 10;
  } else {
    startDay = 21;
    endDay = DAYS_IN_MONTH[monthIndex];
    totalDays = endDay - 21 + 1;
  }

  return { monthName, sprintInMonth, startDay, endDay, totalDays, monthIndex };
};

const getCurrentSprintId = () => {
  const now = new Date();
  const monthIdx = now.getMonth();
  const day = now.getDate();
  let sprintInMonth = 1;
  if (day > 20) sprintInMonth = 3;
  else if (day > 10) sprintInMonth = 2;
  return (monthIdx * 3) + sprintInMonth;
};

// --- Error Boundary ---

class ErrorBoundary extends React.Component<any, any> {
  public state: any;
  public props: any;
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "出错了，请刷新页面重试。";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) errorMessage = `数据库错误: ${parsed.error}`;
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
          <div className="glass-card p-8 max-w-md w-full text-center space-y-4">
            <AlertCircle className="mx-auto text-red-500" size={48} />
            <h2 className="text-xl font-bold text-slate-800">抱歉，出现了一些问题</h2>
            <p className="text-sm text-slate-500">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-brand-green-deep text-white rounded-xl font-bold hover:bg-brand-green-dark transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Components ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<ViewState>('year');
  const [activeSprintId, setActiveSprintId] = useState<number | null>(null);
  const [activeDate, setActiveDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [appState, setAppState] = useState<AppState>({ sprints: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [energyQuote, setEnergyQuote] = useState("");

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (!u) {
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Data sync
  useEffect(() => {
    if (!user) return;

    setIsLoading(true);
    const userDocRef = doc(db, 'users', user.uid);

    // Initial check/migration
    const syncData = async () => {
      try {
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          // New user or migration from localStorage
          const saved = localStorage.getItem('36x10_journal_state');
          let initialSprints: Record<number, SprintData> = {};
          
          if (saved) {
            const parsed = JSON.parse(saved);
            initialSprints = parsed.sprints;
            // Migration logic for local data
            Object.keys(initialSprints).forEach((id: any) => {
              const sprint = initialSprints[id] as any;
              if ('microGoal' in sprint && !('microGoals' in sprint)) {
                sprint.microGoals = sprint.microGoal ? [{ text: sprint.microGoal, category: '个人成长', days: Array(10).fill(false) }] : [];
                delete sprint.microGoal;
              }
              if (!('reflection' in sprint)) sprint.reflection = '';
              if (!('dailyLogs' in sprint)) sprint.dailyLogs = {};
              if (sprint.dailyLogs) {
                Object.keys(sprint.dailyLogs).forEach(date => {
                  if (!sprint.dailyLogs[date].taskStatus) {
                    sprint.dailyLogs[date].taskStatus = [false, false, false];
                  }
                });
              }
            });
          } else {
            // Fresh start
            for (let i = 1; i <= 36; i++) {
              const info = getSprintInfo(i);
              initialSprints[i] = {
                id: i,
                microGoals: [],
                days: Array(info.totalDays).fill(false),
                reflection: '',
                currentDay: 1,
                lastUpdated: new Date().toISOString(),
                dailyLogs: {}
              };
            }
          }

          // Batch write to Firestore
          const batch = writeBatch(db);
          batch.set(userDocRef, { initialized: true });
          
          for (let i = 1; i <= 36; i++) {
            const sprintRef = doc(db, 'users', user.uid, 'sprints', i.toString());
            const sprintData = initialSprints[i];
            const { dailyLogs, ...sprintMeta } = sprintData;
            batch.set(sprintRef, sprintMeta);
            
            // Daily logs as subcollection
            if (dailyLogs) {
              Object.entries(dailyLogs).forEach(([date, log]) => {
                const logRef = doc(db, 'users', user.uid, 'sprints', i.toString(), 'dailyLogs', date);
                batch.set(logRef, log);
              });
            }
          }
          
          await batch.commit();
          localStorage.removeItem('36x10_journal_state');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      }
    };

    syncData();

    // Real-time listener for sprints
    const sprintsColRef = collection(db, 'users', user.uid, 'sprints');
    const unsubscribeSprints = onSnapshot(sprintsColRef, (snapshot) => {
      setAppState(prev => {
        const sprints: Record<number, SprintData> = { ...prev.sprints };
        snapshot.docs.forEach(doc => {
          const data = doc.data() as SprintData;
          sprints[data.id] = { ...data, dailyLogs: prev.sprints[data.id]?.dailyLogs || {} };
        });
        
        if (Object.keys(sprints).length >= 36) {
          setIsLoading(false);
        }
        return { sprints };
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sprints`);
    });

    return () => unsubscribeSprints();
  }, [user]);

  // Handle daily logs sync for active sprint
  useEffect(() => {
    if (!user || !activeSprintId) return;

    const logsColRef = collection(db, 'users', user.uid, 'sprints', activeSprintId.toString(), 'dailyLogs');
    const unsubscribeLogs = onSnapshot(logsColRef, (snapshot) => {
      const logs: Record<string, DailyLog> = {};
      snapshot.docs.forEach(doc => {
        logs[doc.id] = doc.data() as DailyLog;
      });

      setAppState(prev => {
        const sprint = prev.sprints[activeSprintId];
        if (!sprint) return prev;
        return {
          ...prev,
          sprints: {
            ...prev.sprints,
            [activeSprintId]: { ...sprint, dailyLogs: logs }
          }
        };
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sprints/${activeSprintId}/dailyLogs`);
    });

    return () => unsubscribeLogs();
  }, [user, activeSprintId]);

  // Handle URL parameters for direct sprint access
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sprintId = params.get('sprint');
    const date = params.get('date');
    if (sprintId) {
      const id = parseInt(sprintId);
      if (id >= 1 && id <= 36) {
        setActiveSprintId(id);
        if (date) {
          setActiveDate(date);
          setView('journal');
        } else {
          setView('sprint');
        }
      }
    }
    setEnergyQuote(ENERGY_QUOTES[Math.floor(Math.random() * ENERGY_QUOTES.length)]);
  }, []);

  const updateSprint = async (id: number, data: Partial<SprintData>) => {
    if (!user) return;
    
    // Optimistic update
    setAppState(prev => {
      const currentSprint = prev.sprints[id];
      if (!currentSprint) return prev;
      return {
        ...prev,
        sprints: {
          ...prev.sprints,
          [id]: { ...currentSprint, ...data, lastUpdated: new Date().toISOString() }
        }
      };
    });

    try {
      const sprintRef = doc(db, 'users', user.uid, 'sprints', id.toString());
      const { dailyLogs, ...updateData } = data;
      await updateDoc(sprintRef, { ...updateData, lastUpdated: new Date().toISOString() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/sprints/${id}`);
    }
  };

  const updateDailyLog = async (sprintId: number, date: string, log: DailyLog) => {
    if (!user) return;

    // Optimistic update
    setAppState(prev => {
      const sprint = prev.sprints[sprintId];
      if (!sprint) return prev;
      return {
        ...prev,
        sprints: {
          ...prev.sprints,
          [sprintId]: {
            ...sprint,
            dailyLogs: { ...sprint.dailyLogs, [date]: log }
          }
        }
      };
    });

    try {
      const logRef = doc(db, 'users', user.uid, 'sprints', sprintId.toString(), 'dailyLogs', date);
      await setDoc(logRef, log);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/sprints/${sprintId}/dailyLogs/${date}`);
    }
  };

  const getCompletedCount = (sprint: SprintData) => {
    const info = getSprintInfo(sprint.id);
    return Array.from({ length: info.totalDays }).filter((_, i) => 
      sprint.microGoals.some(goal => goal.days[i])
    ).length;
  };

  const getSprintStatus = (id: number): SprintStatus => {
    const sprint = appState.sprints[id];
    if (!sprint) return 'not-started';
    const info = getSprintInfo(id);
    const completedDays = getCompletedCount(sprint);
    if (completedDays === info.totalDays) return 'completed';
    const hasGoals = sprint.microGoals && sprint.microGoals.some(g => g.text.trim() !== '');
    if (completedDays > 0 || hasGoals) return 'in-progress';
    return 'not-started';
  };

  const navigateToSprint = (id: number) => {
    setActiveSprintId(id);
    setView('sprint');
    window.history.pushState({}, '', `?sprint=${id}`);
    setEnergyQuote(ENERGY_QUOTES[Math.floor(Math.random() * ENERGY_QUOTES.length)]);
  };

  const navigateToJournal = (id: number, date: string) => {
    setActiveSprintId(id);
    setActiveDate(date);
    setView('journal');
    window.history.pushState({}, '', `?sprint=${id}&date=${date}`);
  };

  const navigateToYear = () => {
    setView('year');
    setActiveSprintId(null);
    window.history.pushState({}, '', '/');
  };

  const handleLogin = async () => {
    setLoginError(null);
    try {
      await loginWithGoogle();
    } catch (error: any) {
      console.error('Login error caught:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('登录窗口被关闭，请重新点击登录。');
      } else if (error.code === 'auth/cancelled-by-user') {
        setLoginError('登录已取消。');
      } else {
        setLoginError('登录出现问题，请稍后重试。');
      }
    }
  };

  if (!isAuthReady || (user && isLoading)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 space-y-4">
        <Loader2 className="text-brand-green-deep animate-spin" size={48} />
        <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">正在同步云端数据...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <div className="glass-card p-10 max-w-md w-full text-center space-y-8">
          <div className="space-y-2">
            <h1 className="text-5xl font-black tracking-tighter text-brand-green-deep">36X10</h1>
            <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">个人成长微计划&日志</p>
          </div>
          
          <div className="space-y-4 text-sm text-slate-500 leading-relaxed">
            <p>欢迎来到你的 36X10 计划。在这里，我们将一年折叠成 36 个触手可及的 10 天。</p>
            <p>请登录以开始记录你的成长轨迹，数据将实时同步至云端。</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-white border-2 border-slate-100 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-50 transition-all shadow-sm group"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              <span className="text-slate-700">使用 Google 账号登录</span>
              <ArrowRight size={18} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
            </button>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-xs font-medium"
              >
                <AlertCircle size={14} />
                {loginError}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-4 md:py-8">
      <div className="fixed bottom-6 right-6 z-50">
        <button 
          onClick={logout}
          className="p-3 bg-white/80 backdrop-blur-md border border-slate-100 rounded-full shadow-lg text-slate-400 hover:text-red-500 transition-colors"
          title="退出登录"
        >
          <LogOut size={20} />
        </button>
      </div>

      <AnimatePresence mode="wait">
        {view === 'year' ? (
          <YearOverview 
            key="year"
            appState={appState} 
            getSprintStatus={getSprintStatus}
            onSelectSprint={navigateToSprint}
          />
        ) : view === 'sprint' ? (
          <SprintView 
            key="sprint"
            sprint={appState.sprints[activeSprintId!]}
            energyQuote={energyQuote}
            onBack={navigateToYear}
            onUpdate={(data) => updateSprint(activeSprintId!, data)}
            onEnterJournal={(date) => navigateToJournal(activeSprintId!, date)}
            refreshQuote={() => setEnergyQuote(ENERGY_QUOTES[Math.floor(Math.random() * ENERGY_QUOTES.length)])}
          />
        ) : (
          <JournalView
            key="journal"
            sprintId={activeSprintId!}
            date={activeDate}
            log={appState.sprints[activeSprintId!].dailyLogs[activeDate] || {
              date: activeDate,
              encouragement: '',
              tasks: ['', '', ''],
              taskStatus: [false, false, false],
              achievements: ['', '', ''],
              gratitude: ['', '', ''],
              reflection: ['', '', ''],
              mood: '😊'
            }}
            onBack={() => setView('sprint')}
            onUpdate={(log) => updateDailyLog(activeSprintId!, activeDate, log)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Year Overview Component ---

function YearOverview({ 
  appState, 
  getSprintStatus, 
  onSelectSprint 
}: { 
  appState: AppState, 
  getSprintStatus: (id: number) => SprintStatus,
  onSelectSprint: (id: number) => void,
  key?: string
}) {
  const currentYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => i);
  const currentSprintId = getCurrentSprintId();
  
  const totalCompleted = Object.values(appState.sprints).filter(s => {
    const info = getSprintInfo(s.id);
    const completedDays = Array.from({ length: info.totalDays }).filter((_, i) => 
      s.microGoals.some(goal => goal.days[i])
    ).length;
    return completedDays === info.totalDays;
  }).length;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4"
    >
      <header className="space-y-3 border-b border-slate-100 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-black tracking-tighter text-brand-green-deep leading-none">36X10</h1>
          <div className="px-4 py-1.5 bg-brand-green-deep text-white rounded-full text-xs font-black tracking-widest shadow-lg shadow-brand-green-deep/20">
            {currentYear}
          </div>
        </div>
        <h2 className="text-3xl font-black tracking-tighter text-slate-800 leading-none">
          个人成长微计划&日志
        </h2>
      </header>

      {/* Description & Progress */}
      <div className="space-y-3 bg-white/50 p-4 rounded-xl border border-slate-100">
        <div className="space-y-2 text-[10px] leading-relaxed text-slate-500 font-medium">
          <p>原来，1年并非漫长的 365 天，而是 36 个触手可及的“10 天”。</p>
          <p>把一年的时间，折叠成 36 次行动。抛开宏大的年度誓言，只专注 36 次的冲刺。</p>
          <p>每一个 10 天，完成一个小计划；每一次累积，让你离更好的自己更近一步。</p>
        </div>
        
        <div className="space-y-1.5">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-black text-brand-green-deep">
              你现在正处于 <span className="text-brand-green-dark text-xs">{currentSprintId}</span>/36
            </span>
            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
              年度进度: {totalCompleted}/36
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(totalCompleted / 36) * 100}%` }}
              className="h-full bg-brand-green"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        {months.map(mIdx => {
          const monthSprints = [mIdx * 3 + 1, mIdx * 3 + 2, mIdx * 3 + 3];
          
          return (
            <div key={mIdx} className="space-y-0.5">
              <div className="flex justify-between items-center px-0.5">
                <h3 className="text-[8px] font-bold text-slate-700 uppercase tracking-tight">{MONTH_NAMES[mIdx]}</h3>
              </div>
              
              <div className="flex gap-1">
                {monthSprints.map(id => {
                  const status = getSprintStatus(id);
                  const isCurrent = id === currentSprintId;
                  
                  return (
                    <motion.div
                      key={id}
                      whileHover={{ scale: 1.1, y: -1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onSelectSprint(id)}
                      className={`
                        flex-1 aspect-square flex items-center justify-center rounded-full transition-all duration-300 cursor-pointer border
                        ${isCurrent ? 'bg-brand-green-deep border-brand-green-deep text-white z-10 shadow-md' : 
                          status === 'completed' ? 'bg-brand-green border-brand-green-dark text-brand-green-dark' : 
                          status === 'in-progress' ? 'bg-brand-yellow border-brand-yellow-dark text-brand-yellow-dark' : 
                          'bg-white border-slate-100 text-slate-300'}
                      `}
                    >
                      <span className="text-[9px] font-black leading-none">{id}</span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="text-center pt-1">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 bg-white/50 rounded-full border border-slate-100 text-[6px] font-bold text-slate-400 uppercase tracking-[0.05em]">
          <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-slate-200" /> 未开始</div>
          <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-brand-yellow-dark" /> 进行中</div>
          <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-brand-green-dark" /> 已完成</div>
          <div className="flex items-center gap-1"><div className="w-1 h-1 rounded-full bg-brand-green-deep" /> 当前阶段</div>
        </div>
      </footer>
    </motion.div>
  );
}

// --- Sprint View Component ---

function SprintView({ 
  sprint, 
  energyQuote, 
  onBack, 
  onUpdate,
  onEnterJournal,
  refreshQuote
}: { 
  sprint: SprintData, 
  energyQuote: string, 
  onBack: () => void, 
  onUpdate: (data: Partial<SprintData>) => void,
  onEnterJournal: (date: string) => void,
  refreshQuote: () => void,
  key?: string
}) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const formatDate = (date: Date) => {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const handlePrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const handleNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const info = getSprintInfo(sprint.id);
  const completedCount = Array.from({ length: info.totalDays }).filter((_, i) => 
    sprint.microGoals.some(goal => goal.days[i])
  ).length;
  const progress = (completedCount / info.totalDays) * 100;
  const isFinished = completedCount === info.totalDays;
  
  const firstUnfinished = Array.from({ length: info.totalDays }).findIndex((_, i) => 
    !sprint.microGoals.some(goal => goal.days[i])
  );
  const currentDay = firstUnfinished === -1 ? info.totalDays : firstUnfinished + 1;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      <nav className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-white/50 rounded-full transition-colors flex items-center gap-1 text-slate-500 font-medium"
        >
          <ChevronLeft size={20} />
          <span>年度概览</span>
        </button>
        <div className="flex flex-col items-end">
          <div className="px-3 py-1 bg-brand-green-deep text-white rounded-full text-[10px] font-black tracking-widest uppercase">
            {info.monthName} • 第 {info.sprintInMonth} 阶段
          </div>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">
            {String(info.startDay).padStart(2, '0')}/{String(info.monthIndex + 1).padStart(2, '0')} - {String(info.endDay).padStart(2, '0')}/{String(info.monthIndex + 1).padStart(2, '0')}
          </span>
        </div>
      </nav>

      {/* Energy Header */}
      <div className="glass-card p-6 bg-gradient-to-br from-white to-brand-green/30 relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-brand-green-dark">
              <Zap size={18} fill="currentColor" />
              <span className="text-xs font-bold uppercase tracking-wider">今日能量</span>
            </div>
            <button 
              onClick={refreshQuote}
              className="p-1 hover:rotate-180 transition-transform duration-500 text-slate-400"
            >
              <Sparkles size={16} />
            </button>
          </div>
          <p className="text-xl font-serif italic text-slate-700 leading-relaxed">
            "{energyQuote}"
          </p>
        </div>
        <div className="absolute -right-4 -bottom-4 opacity-10 text-brand-green-dark">
          <Zap size={120} />
        </div>
      </div>

      {/* Main Content */}
      <div className="glass-card p-6 space-y-8">
        <div className="text-center space-y-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">当前进度</p>
          <h2 className="text-4xl font-black text-brand-green-deep">
            第 <span className="text-brand-green-dark">{currentDay}</span>
            <span className="text-slate-300 text-2xl font-normal ml-1">天 / {info.totalDays} 天</span>
          </h2>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-brand-green-dark"
            />
          </div>
          <div className="flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-widest">
            <span>{String(info.startDay).padStart(2, '0')}/{String(info.monthIndex + 1).padStart(2, '0')}</span>
            <span>已完成 {completedCount} 天</span>
            <span>{String(info.endDay).padStart(2, '0')}/{String(info.monthIndex + 1).padStart(2, '0')}</span>
          </div>
        </div>

        {/* Micro Goals */}
        <div className="space-y-4">
          <div className="flex items-center justify-between ml-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">阶段微目标 (最多3个)</label>
            {sprint.microGoals.length < 3 && (
              <button 
                onClick={() => onUpdate({ microGoals: [...sprint.microGoals, { text: '', category: '个人成长', days: Array(10).fill(false) }] })}
                className="text-[10px] font-bold text-brand-green-dark flex items-center gap-1 hover:underline"
              >
                <Plus size={12} /> 添加目标
              </button>
            )}
          </div>
          
          <div className="space-y-3">
            {sprint.microGoals.map((goal, idx) => (
              <div key={idx} className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm group transition-all hover:border-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="relative inline-block">
                        <select
                          value={goal.category}
                          onChange={(e) => {
                            const newGoals = [...sprint.microGoals];
                            newGoals[idx].category = e.target.value;
                            onUpdate({ microGoals: newGoals });
                          }}
                          className="appearance-none bg-brand-green-light/30 border-none text-[9px] font-bold text-brand-green-deep px-2 py-0.5 pr-5 rounded-full focus:ring-0 cursor-pointer hover:bg-brand-green-light/50 transition-colors"
                        >
                          {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-brand-green-deep/50">
                          <ChevronLeft size={8} className="-rotate-90" />
                        </div>
                      </div>
                      <input 
                        type="text"
                        placeholder="这10天你的重心是什么？"
                        value={goal.text}
                        onChange={(e) => {
                          const newGoals = [...sprint.microGoals];
                          newGoals[idx].text = e.target.value;
                          onUpdate({ microGoals: newGoals });
                        }}
                        className="flex-1 bg-transparent border-none focus:ring-0 outline-none placeholder:text-slate-300 text-sm font-semibold text-slate-700"
                      />
                    </div>

                    {/* Goal Specific Check-in Grid */}
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: info.totalDays }).map((_, dIdx) => {
                        const day = goal.days[dIdx] || false;
                        return (
                          <button
                            key={dIdx}
                            onClick={() => {
                              const newGoals = [...sprint.microGoals];
                              if (!newGoals[idx].days) newGoals[idx].days = Array(11).fill(false);
                              newGoals[idx].days[dIdx] = !newGoals[idx].days[dIdx];
                              onUpdate({ microGoals: newGoals });
                            }}
                            className={`w-5 h-5 rounded-md flex items-center justify-center transition-all relative group/btn ${
                              day 
                                ? 'bg-brand-green-dark text-white shadow-sm' 
                                : 'bg-slate-50 text-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {day ? <CheckCircle2 size={10} /> : <span className="text-[7px] font-bold">{dIdx + 1}</span>}
                            
                            {/* Custom Tooltip - Only visible on hover */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-800 text-white text-[8px] rounded hidden group-hover/btn:block pointer-events-none whitespace-nowrap z-20">
                              {String(info.startDay + dIdx).padStart(2, '0')}/{String(info.monthIndex + 1).padStart(2, '0')}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      const newGoals = sprint.microGoals.filter((_, i) => i !== idx);
                      onUpdate({ microGoals: newGoals });
                    }}
                    className="text-slate-300 hover:text-red-400 transition-colors mt-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            {sprint.microGoals.length === 0 && (
              <div 
                onClick={() => onUpdate({ microGoals: [{ text: '', category: '个人成长', days: Array(10).fill(false) }] })}
                className="text-center py-6 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <Plus size={20} className="mx-auto text-slate-300 mb-1" />
                <p className="text-[10px] text-slate-400 font-medium">还没有微目标，点击添加</p>
              </div>
            )}
          </div>
        </div>

        {/* Stage Reflection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between ml-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">阶段复盘</label>
            <span className="text-[8px] text-slate-400">记录本周期的感悟与成长</span>
          </div>
          <textarea
            value={sprint.reflection}
            onChange={(e) => onUpdate({ reflection: e.target.value })}
            placeholder="在这里记录你的阶段性反思..."
            className="w-full h-[140px] p-4 bg-white border border-slate-100 rounded-2xl shadow-sm focus:ring-2 focus:ring-brand-green-light focus:border-brand-green-dark outline-none text-sm leading-relaxed placeholder:text-slate-300 resize-none"
          />
        </div>

        {/* Success Feedback */}
        {isFinished && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-brand-green/50 p-6 rounded-2xl border border-brand-green-dark/20 text-center space-y-3"
          >
            <div className="flex justify-center text-brand-green-dark">
              <Trophy size={40} />
            </div>
            <h3 className="text-lg font-bold text-brand-green-dark">阶段完成！</h3>
            <p className="text-sm text-slate-600">你已成功完成本周期。花点时间反思你的成长。</p>
          </motion.div>
        )}

        <div className="space-y-3">
          <button 
            onClick={() => onEnterJournal(selectedDate.toISOString().split('T')[0])}
            className="w-full py-4 bg-brand-green-deep text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-green-dark transition-colors shadow-lg shadow-slate-200"
          >
            <span>进入 {formatDate(selectedDate)} 日志</span>
            <ArrowRight size={18} />
          </button>
          
          <div className="flex justify-between px-2">
            <button 
              onClick={handlePrevDay}
              className="text-[10px] font-bold text-slate-400 hover:text-brand-green-deep transition-colors flex items-center gap-1"
            >
              <ChevronLeft size={10} /> 前一天
            </button>
            <button 
              onClick={handleNextDay}
              className="text-[10px] font-bold text-slate-400 hover:text-brand-green-deep transition-colors flex items-center gap-1"
            >
              后一天 <ChevronLeft size={10} className="rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- Journal View Component ---

function JournalView({
  sprintId,
  date,
  log,
  onBack,
  onUpdate
}: {
  sprintId: number,
  date: string,
  log: DailyLog,
  onBack: () => void,
  onUpdate: (log: DailyLog) => void,
  key?: string
}) {
  const [hoveredMood, setHoveredMood] = useState<string | null>(null);
  const info = getSprintInfo(sprintId);
  const displayDate = date.split('-').reverse().slice(0, 2).join('/'); // DD/MM
  
  const MOODS = [
    { emoji: '😄', label: '开心' },
    { emoji: '😊', label: '满足' },
    { emoji: '😌', label: '平静' },
    { emoji: '⚖️', label: '有得有失' },
    { emoji: '🤔', label: '思考/困惑' },
    { emoji: '😫', label: '疲惫' },
    { emoji: '😔', label: '难过' },
    { emoji: '😠', label: '生气' },
    { emoji: '🤯', label: '震惊/崩溃' },
  ];

  const updateField = (field: keyof DailyLog, value: any) => {
    onUpdate({ ...log, [field]: value });
  };

  const updateArrayField = (field: 'tasks' | 'achievements' | 'gratitude' | 'reflection', index: number, value: string) => {
    const newArr = [...log[field]];
    newArr[index] = value;
    updateField(field, newArr);
  };

  const toggleTaskStatus = (index: number) => {
    const newStatus = [...(log.taskStatus || [false, false, false])];
    newStatus[index] = !newStatus[index];
    updateField('taskStatus', newStatus);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6 pb-20"
    >
      <nav className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-white/50 rounded-full transition-colors flex items-center gap-1 text-slate-500 font-medium"
        >
          <ChevronLeft size={20} />
          <span>返回阶段</span>
        </button>
        <div className="flex flex-col items-end">
          <div className="px-3 py-1 bg-brand-green-deep text-white rounded-full text-[10px] font-black tracking-widest uppercase">
            {displayDate} 日志
          </div>
          <span className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">
            第 {sprintId} 阶段
          </span>
        </div>
      </nav>

      <div className="glass-card p-6 space-y-8">
        {/* Encouragement */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 ml-1">
            <span className="text-lg">💖</span>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">鼓励自己的话</label>
          </div>
          <input 
            type="text"
            value={log.encouragement}
            onChange={(e) => updateField('encouragement', e.target.value)}
            placeholder="写下一句给自己的话..."
            className="w-full p-4 bg-white border border-slate-100 rounded-2xl shadow-sm focus:ring-2 focus:ring-brand-green-light focus:border-brand-green-dark outline-none text-sm font-medium text-slate-700 placeholder:text-slate-300"
          />
        </div>

        {/* Sections Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tasks */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🎯</span>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">今日核心任务</label>
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <button 
                    onClick={() => toggleTaskStatus(i)}
                    className={`transition-colors ${log.taskStatus?.[i] ? 'text-brand-green-dark' : 'text-slate-200 hover:text-slate-300'}`}
                  >
                    {log.taskStatus?.[i] ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                  <input 
                    type="text"
                    value={log.tasks[i] || ''}
                    onChange={(e) => updateArrayField('tasks', i, e.target.value)}
                    className={`flex-1 bg-white border border-slate-50 p-2 rounded-lg text-xs font-medium focus:border-brand-green-dark outline-none transition-all ${
                      log.taskStatus?.[i] ? 'text-slate-300 line-through' : 'text-slate-600'
                    }`}
                    placeholder={`任务 ${i + 1}...`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">✅</span>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">今日小成就</label>
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-300 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={log.achievements[i] || ''}
                    onChange={(e) => updateArrayField('achievements', i, e.target.value)}
                    className="flex-1 bg-white border border-slate-50 p-2 rounded-lg text-xs font-medium text-slate-600 focus:border-brand-green-dark outline-none transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Gratitude */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🌷</span>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">今日感恩</label>
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-300 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={log.gratitude[i] || ''}
                    onChange={(e) => updateArrayField('gratitude', i, e.target.value)}
                    className="flex-1 bg-white border border-slate-50 p-2 rounded-lg text-xs font-medium text-slate-600 focus:border-brand-green-dark outline-none transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Reflection */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🧠</span>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">今日反思</label>
            </div>
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-300 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={log.reflection[i] || ''}
                    onChange={(e) => updateArrayField('reflection', i, e.target.value)}
                    className="flex-1 bg-white border border-slate-50 p-2 rounded-lg text-xs font-medium text-slate-600 focus:border-brand-green-dark outline-none transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mood */}
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between ml-1 h-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">今日情绪</label>
            <span className="text-[10px] font-black text-brand-green-dark">
              {MOODS.find(m => m.emoji === log.mood)?.label || '选择你的心情'}
            </span>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-9 gap-2">
            {MOODS.map((m, i) => (
              <div key={i} className="relative flex justify-center">
                <button
                  onMouseEnter={() => setHoveredMood(m.label)}
                  onMouseLeave={() => setHoveredMood(null)}
                  onClick={() => updateField('mood', m.emoji)}
                  className={`w-full aspect-square flex flex-col items-center justify-center rounded-xl transition-all ${
                    log.mood === m.emoji 
                      ? 'bg-brand-green-dark text-white shadow-md scale-110' 
                      : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-xl">{m.emoji}</span>
                </button>
                
                <AnimatePresence>
                  {hoveredMood === m.label && (
                    <motion.div
                      initial={{ opacity: 0, y: 5, x: '-50%' }}
                      animate={{ opacity: 1, y: 0, x: '-50%' }}
                      exit={{ opacity: 0, y: 2, x: '-50%' }}
                      className="absolute bottom-full left-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-[10px] font-bold rounded shadow-xl pointer-events-none z-20 whitespace-nowrap"
                    >
                      {m.label}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={onBack}
          className="w-full py-4 bg-brand-green-deep text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand-green-dark transition-colors shadow-lg shadow-slate-200"
        >
          <span>保存并返回</span>
          <CheckCircle2 size={18} />
        </button>
      </div>
    </motion.div>
  );
}
