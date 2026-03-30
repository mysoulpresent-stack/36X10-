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
  Loader2,
  Moon,
  Sun,
  Heart,
  Activity,
  BookOpen,
  Briefcase,
  Wallet,
  Users,
  Smile,
  Coffee,
  PenTool,
  TrendingUp,
  Target,
  Info
} from 'lucide-react';
import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, collection, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

// --- Types ---

type SprintStatus = 'not-started' | 'in-progress' | 'completed';

interface MicroGoal {
  text: string;
  mainCategory: string;
  subCategory: string;
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
  lastUpdated: any;
  dailyLogs: Record<string, DailyLog>; // Keyed by YYYY-MM-DD
}

interface AppState {
  sprints: Record<number, SprintData>;
  manifesto: string[];
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

const MANIFESTO_LIBRARY: Record<string, string[]> = {
  "Health（健康）": [
    "我是一个重视身体的人",
    "我是一个保持规律作息的人",
    "我是一个愿意运动的人"
  ],
  "Growth（成长）": [
    "我是一个持续学习的人",
    "我是一个每天都有进步的人",
    "我是一个不断提升自己的人"
  ],
  "Career（事业）": [
    "我是一个能把事情做好的人",
    "我是一个有执行力的人",
    "我是一个对工作负责的人"
  ],
  "Relationships（关系）": [
    "我是一个愿意表达关心的人",
    "我是一个珍惜身边人的人",
    "我是一个用心经营关系的人"
  ],
  "Mind（内在 / 情绪）": [
    "我是一个情绪稳定的人",
    "我是一个对自己温柔的人",
    "我是一个接纳自己的人"
  ]
};

const MANIFESTO_FEEDBACK = [
  "你正在成为一个持续行动的人",
  "这就是你正在实践的自己",
  "你正在靠近你想成为的那个人"
];

const GOAL_TEMPLATES: Record<string, { icon: any, color: string, subs: Record<string, string> }> = {
  "健康": {
    icon: Activity,
    color: "text-red-500 bg-red-50 dark:bg-red-900/20",
    subs: {
      "运动": "每天步行 ≥ 6000步",
      "睡眠": "12点前上床",
      "饮食": "每天至少吃一份蔬菜"
    }
  },
  "成长": {
    icon: TrendingUp,
    color: "text-blue-500 bg-blue-50 dark:bg-blue-900/20",
    subs: {
      "学习": "每天学习20分钟",
      "阅读": "每天阅读10页",
      "输出": "每天记录1条笔记"
    }
  },
  "事业 / 财务": {
    icon: Briefcase,
    color: "text-amber-500 bg-amber-50 dark:bg-amber-900/20",
    subs: {
      "主业提升": "每天完成1个高优先级任务",
      "副业探索": "每天投入20分钟",
      "财务记录": "每天记录一笔支出"
    }
  },
  "关系": {
    icon: Users,
    color: "text-pink-500 bg-pink-50 dark:bg-pink-900/20",
    subs: {
      "家人": "每天与家人交流10分钟",
      "伴侣": "每天表达一次关心或感谢",
      "社交": "每天主动联系1人"
    }
  },
  "生活 / 情绪": {
    icon: Smile,
    color: "text-purple-500 bg-purple-50 dark:bg-purple-900/20",
    subs: {
      "情绪觉察": "每天记录一句感受",
      "放松": "每天10分钟无压力休息",
      "兴趣": "每天做一件让自己开心的事"
    }
  }
};

const CATEGORIES = Object.keys(GOAL_TEMPLATES);

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
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
          <div className="glass-card p-8 max-w-md w-full text-center space-y-4">
            <AlertCircle className="mx-auto text-red-500" size={48} />
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">抱歉，出现了一些问题</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{errorMessage}</p>
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
  const [appState, setAppState] = useState<AppState>({ sprints: {}, manifesto: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showCookieHelp, setShowCookieHelp] = useState(false);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(() => {
    return localStorage.getItem('36x10_onboarding') === 'true';
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const completeOnboarding = () => {
    localStorage.setItem('36x10_onboarding', 'true');
    setHasSeenOnboarding(true);
  };

  const [energyQuote, setEnergyQuote] = useState("");

  const [showWelcome, setShowWelcome] = useState(false);

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
          // New user
          setShowWelcome(true);
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
                lastUpdated: serverTimestamp(),
                dailyLogs: {}
              };
            }
          }

          // Batch write to Firestore
          const batch = writeBatch(db);
          batch.set(userDocRef, { initialized: true, manifesto: [] });
          
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

    // Real-time listener for user settings (manifesto)
    const unsubscribeUser = onSnapshot(userDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setAppState(prev => ({ ...prev, manifesto: data.manifesto || [] }));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

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
        return { ...prev, sprints };
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sprints`);
    });

    return () => {
      unsubscribeUser();
      unsubscribeSprints();
    };
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
          window.scrollTo(0, 0);
        } else {
          setView('sprint');
          window.scrollTo(0, 0);
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
          [id]: { ...currentSprint, ...data, lastUpdated: serverTimestamp() }
        }
      };
    });

    try {
      const sprintRef = doc(db, 'users', user.uid, 'sprints', id.toString());
      const { dailyLogs, ...updateData } = data;
      await updateDoc(sprintRef, { ...updateData, lastUpdated: serverTimestamp() });
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
    window.scrollTo(0, 0);
  };

  const navigateToJournal = (id: number, date: string) => {
    setActiveSprintId(id);
    setActiveDate(date);
    setView('journal');
    window.history.pushState({}, '', `?sprint=${id}&date=${date}`);
    window.scrollTo(0, 0);
  };

  const navigateToYear = () => {
    setView('year');
    setActiveSprintId(null);
    window.history.pushState({}, '', '/');
    window.scrollTo(0, 0);
  };

  const updateManifesto = async (newManifesto: string[]) => {
    if (!user) return;
    setAppState(prev => ({ ...prev, manifesto: newManifesto }));
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, { manifesto: newManifesto });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleLogin = async () => {
    setLoginError(null);
    setShowCookieHelp(false);
    try {
      await loginWithGoogle();
    } catch (error: any) {
      console.error('Login error caught:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('登录窗口被关闭，请重新点击登录。');
      } else if (error.code === 'auth/cancelled-by-user') {
        setLoginError('登录已取消。');
      } else if (error.message?.includes('blocking a required security cookies') || error.code === 'auth/network-request-failed') {
        setLoginError('浏览器阻止了安全 Cookie，导致登录失败。');
        setShowCookieHelp(true);
      } else {
        setLoginError('登录出现问题，请稍后重试。');
      }
    }
  };

  if (!isAuthReady || (user && isLoading)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 space-y-4">
        <Loader2 className="text-brand-green-deep animate-spin" size={48} />
        <p className="text-slate-400 dark:text-slate-500 font-bold tracking-widest text-xs uppercase">正在同步云端数据...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
        <div className="glass-card p-10 max-w-md w-full text-center space-y-10">
          <div className="space-y-4">
            <div className="w-20 h-20 bg-brand-green-light/20 rounded-3xl flex items-center justify-center mx-auto text-brand-green-deep rotate-3">
              <Sprout size={48} />
            </div>
            <div className="space-y-1">
              <h1 className="text-5xl font-black tracking-tighter text-brand-green-deep">36X10</h1>
              <p className="text-slate-400 dark:text-slate-500 font-bold tracking-widest text-xs uppercase">个人成长微计划 & 身份重塑</p>
            </div>
          </div>
          
          <div className="space-y-4 text-sm md:text-base text-slate-500 dark:text-slate-400 leading-relaxed">
            <p className="font-bold text-slate-700 dark:text-slate-200 text-lg">开启你的 36 周期进化</p>
            <p>通过 36 个 10 天的微小迭代，<br/>见证一个全新的自己。</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleLogin}
              className="w-full py-4 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm group"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              <span className="text-slate-700 dark:text-slate-300">使用 Google 账号登录</span>
              <ArrowRight size={18} className="text-slate-300 dark:text-slate-500 group-hover:translate-x-1 transition-transform" />
            </button>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-red-50 border border-red-100 rounded-xl flex flex-col gap-2 text-red-600 text-xs font-medium"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} />
                  {loginError}
                </div>
                {showCookieHelp && (
                  <div className="mt-2 p-2 bg-white/50 dark:bg-slate-800/50 rounded-lg text-slate-600 dark:text-slate-300 font-normal leading-relaxed">
                    <p className="font-bold mb-1">解决方法：</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>请在浏览器设置中<b>允许第三方 Cookie</b>。</li>
                      <li>如果您使用的是 Safari，请在“偏好设置 &gt; 隐私”中取消勾选<b>“阻止所有 Cookie”</b>。</li>
                      <li>或者尝试使用 Chrome 或 Edge 浏览器。</li>
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-4 md:py-8 relative">
      {/* Welcome / Onboarding Modal */}
      {(showWelcome || !hasSeenOnboarding) && user && view === 'year' && (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl w-full max-w-lg text-center space-y-8 relative overflow-hidden my-auto"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-green via-brand-yellow to-brand-green-dark" />
            
            <div className="space-y-4">
              <div className="w-20 h-20 bg-brand-green-light/20 rounded-3xl flex items-center justify-center mx-auto text-brand-green-deep rotate-3">
                <Sprout size={48} />
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-brand-green-deep tracking-tight">
                欢迎开启<br />你的成长之旅
              </h2>
              <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-xs mx-auto">
                原来，1年并非漫长的 365 天，而是 36 个触手可及的“10天”！
              </p>
            </div>

            <div className="space-y-6 text-left">
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-brand-green font-bold shadow-sm">1</div>
                <div className="space-y-1">
                  <p className="font-bold text-slate-800 dark:text-slate-200">36个微周期</p>
                  <p className="text-sm text-slate-500">专注 36 次更新迭代的机会，让成长在 10 天的节奏中自然发生。</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-brand-green font-bold shadow-sm">2</div>
                <div className="space-y-1">
                  <p className="font-bold text-slate-800 dark:text-slate-200">身份导向</p>
                  <p className="text-sm text-slate-500">通过“我是一个……的人”建立身份认同，让微小的行动塑造真实的自己。</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0 text-brand-green font-bold shadow-sm">3</div>
                <div className="space-y-1">
                  <p className="font-bold text-slate-800 dark:text-slate-200">每日觉察</p>
                  <p className="text-sm text-slate-500">记录每一天的成就与反思。你的记录将实时同步至云端，见证你的蜕变。</p>
                </div>
              </div>
            </div>

            <button 
              onClick={() => {
                setShowWelcome(false);
                completeOnboarding();
              }}
              className="w-full py-4 bg-brand-green-deep text-white rounded-2xl font-black text-lg shadow-lg shadow-brand-green/20 hover:bg-brand-green-dark hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              开启我的成长之旅 <ArrowRight size={20} />
            </button>
          </motion.div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          className="p-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-100 dark:border-slate-700 rounded-full shadow-lg text-slate-400 dark:text-slate-500 hover:text-brand-green-dark transition-colors"
          title={isDarkMode ? "切换到亮色模式" : "切换到暗色模式"}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button 
          onClick={logout}
          className="p-3 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border border-slate-100 dark:border-slate-700 rounded-full shadow-lg text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors"
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
            onUpdateManifesto={updateManifesto}
          />
        ) : view === 'sprint' ? (
          <SprintView 
            key="sprint"
            sprint={appState.sprints[activeSprintId!]}
            energyQuote={energyQuote}
            manifesto={appState.manifesto}
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
            onBack={() => {
              setView('sprint');
              window.scrollTo(0, 0);
            }}
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
  onSelectSprint,
  onUpdateManifesto
}: { 
  appState: AppState, 
  getSprintStatus: (id: number) => SprintStatus,
  onSelectSprint: (id: number) => void,
  onUpdateManifesto: (manifesto: string[]) => void,
  key?: string
}) {
  const currentYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, i) => i);
  const currentSprintId = getCurrentSprintId();
  const [showLibrary, setShowLibrary] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showLimitNote, setShowLimitNote] = useState(false);
  
  const totalCompleted = Object.values(appState.sprints).filter(s => {
    const info = getSprintInfo(s.id);
    const completedDays = Array.from({ length: info.totalDays }).filter((_, i) => 
      s.microGoals.some(goal => goal.days[i])
    ).length;
    return completedDays === info.totalDays;
  }).length;

  const manifesto = appState.manifesto || [];

  const stats = useMemo(() => {
    let totalCheckins = 0;
    let totalGoalsAchieved = 0;
    let totalLogs = 0;
    let currentStreak = 0;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    Object.values(appState.sprints).forEach(sprint => {
      sprint.microGoals.forEach(goal => {
        totalGoalsAchieved += goal.days.filter(d => d).length;
      });
      const logDates = Object.keys(sprint.dailyLogs);
      totalLogs += logDates.length;
      totalCheckins += logDates.length;
    });

    // Simple streak calculation
    let checkDate = today;
    const allLogDates = new Set(Object.values(appState.sprints).flatMap(s => Object.keys(s.dailyLogs)));
    
    if (!allLogDates.has(today) && allLogDates.has(yesterday)) {
      checkDate = yesterday;
    }

    while (allLogDates.has(checkDate)) {
      currentStreak++;
      const d = new Date(checkDate);
      d.setDate(d.getDate() - 1);
      checkDate = d.toISOString().split('T')[0];
    }

    return { totalCheckins, totalGoalsAchieved, totalLogs, currentStreak };
  }, [appState.sprints]);

  const motivationMessage = useMemo(() => {
    if (stats.totalCheckins === 0) return "开启你的第一次打卡，见证改变的开始 ✨";
    if (stats.currentStreak >= 7) return `太棒了！你已经连续坚持了 ${stats.currentStreak} 天，这种力量无可阻挡 🚀`;
    if (stats.totalGoalsAchieved > 50) return "你已经完成了超过 50 次微目标，你正在重塑自己 💎";
    if (stats.totalLogs > 10) return "记录是成长的足迹。你已经留下了 10 篇珍贵的日记 📖";
    return "每一次打卡，都是对未来自己的一次投票。继续加油！💪";
  }, [stats]);

  const addManifesto = (text: string = '') => {
    const nonEmptyManifesto = manifesto.filter(m => m.trim() !== '');
    
    // If adding from library, try to fill first empty slot
    if (text !== '') {
      const firstEmptyIndex = manifesto.findIndex(m => m.trim() === '');
      if (firstEmptyIndex !== -1) {
        const newManifesto = [...manifesto];
        newManifesto[firstEmptyIndex] = text;
        onUpdateManifesto(newManifesto);
        return;
      }
      
      // If no empty slot but already have 5 non-empty items, show note
      if (nonEmptyManifesto.length >= 5) {
        setShowLimitNote(true);
        return;
      }
    } else {
      // Manual add: if already have 5 items (including empty ones), show note
      if (manifesto.length >= 5) {
        setShowLimitNote(true);
        return;
      }
    }

    onUpdateManifesto([...manifesto, text]);
  };

  const updateManifestoItem = (index: number, value: string) => {
    const newManifesto = [...manifesto];
    newManifesto[index] = value;
    onUpdateManifesto(newManifesto);
  };

  const removeManifestoItem = (index: number) => {
    const newManifesto = [...manifesto];
    newManifesto.splice(index, 1);
    onUpdateManifesto(newManifesto);
  };

  const defaultExamples = [
    "我是一个重视身体的人",
    "我是一个持续学习的人",
    "我是一个情绪稳定的人"
  ];

  useEffect(() => {
    if (manifesto.length === 0) {
      onUpdateManifesto(defaultExamples);
    }
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-4"
    >
      <header className="glass-card p-6 bg-gradient-to-br from-white to-brand-green/30 dark:from-slate-800 dark:to-slate-900/50 border border-slate-100 dark:border-slate-700">
        <div className="space-y-2">
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-brand-green-deep dark:text-brand-green-dark leading-none">
            {currentYear}
          </h1>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-200 leading-tight">
            36X10。36周期。个人成长微计划 & 日记
          </h2>
        </div>
      </header>

      {/* Manifesto Section */}
      <div className="glass-card p-6 bg-gradient-to-br from-white to-brand-green/30 dark:from-slate-800 dark:to-slate-900/50 relative overflow-hidden rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-brand-green-deep dark:text-brand-green-light">
            <h3 className="text-lg font-black tracking-tight">{currentYear} 年度个人宣言</h3>
            <button 
              onClick={() => setShowRules(!showRules)}
              className="p-1 text-brand-green-deep/60 dark:text-brand-green-light/60 hover:text-brand-green-deep dark:hover:text-white transition-colors"
            >
              <Info size={16} />
            </button>
          </div>
        </div>

        {/* Light Content */}
        <div className="p-6 space-y-6">
          <AnimatePresence>
            {showRules && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 bg-brand-green-light/10 rounded-xl border border-brand-green-light/30 space-y-3 text-sm">
                  <div className="flex items-start gap-2">
                    <div className="space-y-1">
                      <p className="font-bold text-brand-green-deep">如何写出更有力量的宣言？</p>
                      <p className="text-slate-600 dark:text-slate-400">我们建议使用：<span className="font-black text-brand-green-deep">“我是一个……的人”</span></p>
                    </div>
                  </div>
                  <div className="space-y-2 text-slate-500 pl-0 leading-relaxed">
                    <p>这能帮助你建立“身份认同”，而不仅仅是完成任务。试着描述你想成为的样子，让它在日常点滴中自然发生。</p>
                    <p>比如：<span className="text-brand-green-deep font-medium">“我是一个重视身体的人”</span> 比 “我要变健康” 更有力量哦！</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="p-2 bg-slate-50 dark:bg-slate-900/10 rounded-lg text-[10px]">
                      <p className="font-bold text-slate-400">任务导向 (Task)</p>
                      <p className="text-slate-400">我要赚很多钱 / 我要变瘦</p>
                    </div>
                    <div className="p-2 bg-brand-green-light/20 rounded-lg text-[10px]">
                      <p className="font-bold text-brand-green-deep">身份导向 (Identity)</p>
                      <p className="text-slate-600">我是一个对财务有掌控感的人 / 我是一个爱护身体的人</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            {manifesto.map((item, i) => (
              <div key={i} className="flex items-center gap-2 group">
                <div className="w-6 h-6 rounded-full bg-brand-green/20 flex items-center justify-center text-[10px] font-black text-brand-green-deep shrink-0">
                  {i + 1}
                </div>
                <input 
                  type="text"
                  value={item}
                  onChange={(e) => updateManifestoItem(i, e.target.value)}
                  placeholder="我是一个……的人"
                  className="flex-1 bg-transparent border-b border-slate-100 dark:border-slate-700 py-1 text-sm md:text-base font-medium text-slate-700 dark:text-slate-200 focus:border-brand-green outline-none transition-colors"
                />
                <button 
                  onClick={() => removeManifestoItem(i)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            ))}

            <div className="flex gap-4 pt-2">
              <button 
                onClick={() => addManifesto()}
                className="flex items-center gap-2 text-xs font-bold text-brand-green-dark hover:text-brand-green-deep transition-colors py-2"
              >
                <Plus size={14} /> 新增宣言
              </button>
              <button 
                onClick={() => setShowLibrary(true)}
                className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-brand-green-deep transition-colors py-2"
              >
                <LayoutGrid size={14} /> 从句子库选择
              </button>
            </div>
          </div>
        </div>
      </div>

        {/* Limit Note Modal */}
        <AnimatePresence>
          {showLimitNote && (
            <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-2xl w-full max-w-sm text-center space-y-4"
              >
                <div className="w-16 h-16 bg-brand-green-light/20 rounded-full flex items-center justify-center mx-auto text-brand-green-deep">
                  <Sparkles size={32} />
                </div>
                <h3 className="text-xl font-black text-brand-green-deep">专注是成长的秘诀</h3>
                <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                  我们建议每年只设置 <span className="font-bold text-brand-green-deep">5 条</span> 以内的宣言。
                  <br /><br />
                  过多的目标会分散你的能量。把注意力集中在最重要的几个身份上，你会发现改变发生得更有力量。
                </p>
                <button 
                  onClick={() => setShowLimitNote(false)}
                  className="w-full py-3 bg-brand-green-deep text-white rounded-xl font-bold hover:bg-brand-green-dark transition-colors"
                >
                  我知道了
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Library Modal */}
        <AnimatePresence>
          {showLibrary && (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl w-full max-w-md space-y-6 max-h-[80vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 pb-4 z-10">
                  <h3 className="text-xl font-black text-brand-green-deep">宣言句子库</h3>
                  <button onClick={() => setShowLibrary(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  {Object.entries(MANIFESTO_LIBRARY).map(([category, sentences]) => (
                    <div key={category} className="space-y-3">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">{category}</h4>
                      <div className="grid grid-cols-1 gap-2">
                        {sentences.map((s, idx) => (
                          <button
                            key={idx}
                            disabled={manifesto.includes(s)}
                            onClick={() => {
                              addManifesto(s);
                              setShowLibrary(false);
                            }}
                            className={`text-left p-3 rounded-xl border text-sm font-medium transition-all ${
                              manifesto.includes(s)
                                ? 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-300'
                                : 'border-slate-100 dark:border-slate-800 hover:border-brand-green-dark hover:bg-brand-green-light/10 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      {/* Motivation Card */}
      {stats.totalCheckins > 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-brand-green-deep to-brand-green-dark p-6 rounded-3xl text-white shadow-xl shadow-brand-green/10 space-y-4 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp size={120} />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
              <Trophy size={20} className="text-brand-yellow" />
            </div>
            <div>
              <p className="text-xs font-bold text-brand-green-light uppercase tracking-widest">成长动力</p>
              <p className="font-bold text-lg leading-tight">{motivationMessage}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-brand-green-light/80 uppercase tracking-wider">累计打卡</p>
              <p className="text-2xl font-black">{stats.totalCheckins}<span className="text-xs ml-1 font-normal opacity-60">天</span></p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-brand-green-light/80 uppercase tracking-wider">目标达成</p>
              <p className="text-2xl font-black">{stats.totalGoalsAchieved}<span className="text-xs ml-1 font-normal opacity-60">次</span></p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-brand-green-light/80 uppercase tracking-wider">当前连胜</p>
              <p className="text-2xl font-black">{stats.currentStreak}<span className="text-xs ml-1 font-normal opacity-60">天</span></p>
            </div>
          </div>
        </motion.div>
      )}

      <div className="glass-card p-6 space-y-4 bg-gradient-to-br from-white to-brand-green/30 dark:from-slate-800 dark:to-slate-900/50 border border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-lg font-black text-brand-green-deep dark:text-brand-green-light tracking-tight">
            你现在正处于 <span className="text-brand-green-dark dark:text-brand-green text-xl">{currentSprintId}</span> / 36
          </h3>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-4">
        {months.map(mIdx => {
          const monthSprints = [mIdx * 3 + 1, mIdx * 3 + 2, mIdx * 3 + 3];
          
          return (
            <div key={mIdx} className="space-y-0.5">
              <div className="flex justify-between items-center px-0.5">
                <h3 className="text-xs md:text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-tight">{MONTH_NAMES[mIdx]}</h3>
              </div>
              
              <div className="flex gap-1">
                {monthSprints.map(id => {
                  const status = getSprintStatus(id);
                  const isCurrent = id === currentSprintId;
                  
                  // Calculate completion rate for heatmap
                  const sprint = appState.sprints[id];
                  let completionRate = 0;
                  if (sprint) {
                    const info = getSprintInfo(id);
                    const completedDays = Array.from({ length: info.totalDays }).filter((_, i) => 
                      sprint.microGoals.some(goal => goal.days[i])
                    ).length;
                    completionRate = completedDays / info.totalDays;
                  }

                  let bgColor = 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-300 dark:text-slate-600';
                  if (isCurrent) {
                    bgColor = 'bg-brand-green-deep border-brand-green-deep text-white z-10 shadow-md ring-2 ring-brand-green-deep/20 ring-offset-1';
                  } else if (completionRate === 0 && status === 'in-progress') {
                    bgColor = 'bg-brand-yellow border-brand-yellow-dark text-brand-yellow-dark';
                  } else if (completionRate > 0) {
                    if (completionRate < 0.4) bgColor = 'bg-brand-green border-brand-green text-brand-green-dark';
                    else if (completionRate < 0.8) bgColor = 'bg-brand-green-dark/60 border-brand-green-dark/60 text-white';
                    else bgColor = 'bg-brand-green-dark border-brand-green-dark text-white';
                  } else if (status === 'completed') {
                    // Completed but no goals checked (edge case)
                    bgColor = 'bg-brand-green border-brand-green-dark text-brand-green-dark';
                  }
                  
                  return (
                    <motion.div
                      key={id}
                      whileHover={{ scale: 1.1, y: -1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onSelectSprint(id)}
                      className={`
                        flex-1 aspect-square flex items-center justify-center rounded-lg transition-all duration-300 cursor-pointer border
                        ${bgColor}
                      `}
                    >
                      <span className="text-sm md:text-base font-black leading-none">{id}</span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="text-center pt-1">
        <div className="inline-flex items-center gap-2 px-2 py-0.5 bg-white/50 dark:bg-slate-800/50 rounded-full border border-slate-100 dark:border-slate-700 text-sm md:text-base md:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.05em]">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600" /> 未开始</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-brand-green" /> 少量</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-brand-green-dark/60" /> 中等</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-brand-green-dark" /> 丰富</div>
        </div>
      </footer>
      </div>
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
  refreshQuote,
  manifesto
}: { 
  sprint: SprintData, 
  energyQuote: string, 
  onBack: () => void, 
  onUpdate: (data: Partial<SprintData>) => void,
  onEnterJournal: (date: string) => void,
  refreshQuote: () => void,
  manifesto: string[],
  key?: string
}) {
  const [showUpgradeNote, setShowUpgradeNote] = useState(false);
  const [isSelectingGoal, setIsSelectingGoal] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [selectionStep, setSelectionStep] = useState<'main' | 'sub' | 'edit'>('main');
  const [selectedMain, setSelectedMain] = useState<string | null>(null);
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [tempGoalText, setTempGoalText] = useState('');
  const [manifestoIndex, setManifestoIndex] = useState(0);
  
  const info = getSprintInfo(sprint.id);
  const nonEmptyManifesto = (manifesto || []).filter(m => m.trim() !== '');

  useEffect(() => {
    if (nonEmptyManifesto.length <= 1) return;
    
    const interval = setInterval(() => {
      setManifestoIndex(prev => (prev + 1) % nonEmptyManifesto.length);
    }, 5000); // 5 seconds

    return () => clearInterval(interval);
  }, [nonEmptyManifesto.length]);

  const showFeedback = () => {
    const msg = MANIFESTO_FEEDBACK[Math.floor(Math.random() * MANIFESTO_FEEDBACK.length)];
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3000);
  };
  
  const year = new Date().getFullYear();
  const month = info.monthIndex;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const calendarDays = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

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
      {/* Feedback Toast */}
      <AnimatePresence>
        {feedbackMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[150] px-6 py-3 bg-brand-green-deep text-white rounded-full shadow-2xl flex items-center gap-3 border border-brand-green whitespace-nowrap"
          >
            <Sparkles className="text-brand-yellow w-5 h-5" />
            <span className="font-black tracking-tight">{feedbackMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="p-2 -ml-2 hover:bg-white/50 dark:hover:bg-slate-800/50 rounded-full transition-colors flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium"
        >
          <ChevronLeft size={20} />
          <span>返回主页</span>
        </button>
        <div className="flex flex-col items-end">
          <div className="px-3 py-1 bg-brand-green-deep text-white rounded-full text-xs md:text-sm font-black tracking-widest uppercase">
            {info.monthName}{['上旬', '中旬', '下旬'][info.sprintInMonth - 1]} • {info.startDay}/{info.monthIndex + 1} - {info.endDay}/{info.monthIndex + 1}
          </div>
        </div>
      </nav>

      {/* Manifesto Header (formerly Energy Header) */}
      <div className="glass-card p-6 bg-gradient-to-br from-white to-brand-green/30 relative overflow-hidden min-h-[140px] flex flex-col justify-center">
        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-brand-green-dark">
              <Sparkles size={18} fill="currentColor" />
              <span className="text-xs font-bold uppercase tracking-wider">2026 年度个人宣言</span>
            </div>
            {nonEmptyManifesto.length > 1 && (
              <div className="flex gap-1">
                {nonEmptyManifesto.map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-1 h-1 rounded-full transition-all duration-500 ${i === manifestoIndex ? 'bg-brand-green-dark w-3' : 'bg-brand-green-dark/20'}`}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="relative h-16 flex items-center">
            <AnimatePresence mode="wait">
              <motion.p 
                key={manifestoIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5 }}
                className="text-lg md:text-xl font-bold text-slate-700 dark:text-slate-300 leading-relaxed"
              >
                {nonEmptyManifesto[manifestoIndex] || "开启你的成长之旅 ✨"}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <div className="absolute -right-4 -bottom-4 opacity-10 text-brand-green-dark">
          <Sparkles size={120} />
        </div>
      </div>

      {/* Main Content */}
      <div className="glass-card p-6 space-y-8">
        <div className="text-center py-2">
          <p className="text-lg md:text-xl font-black text-brand-green-deep tracking-tight">
            {new Date().getFullYear()}年{new Date().getMonth() + 1}月{new Date().getDate()}日 • 我的微计划打卡
          </p>
        </div>

        {/* Micro Goals */}
        <div className="space-y-4">
          <div className="flex flex-col gap-1 ml-1">
            <h4 className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              第 {sprint.id} 周期微目标
            </h4>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                （💡：可先设置3个）
              </span>
              <button 
                onClick={() => {
                  if (sprint.microGoals.length >= 3) {
                    setShowUpgradeNote(true);
                  } else {
                    setIsSelectingGoal(true);
                    setSelectionStep('main');
                    setSelectedMain(null);
                    setSelectedSub(null);
                  }
                }}
                className="text-sm md:text-base font-bold text-brand-green-dark flex items-center gap-1 hover:underline"
              >
                <Plus size={12} /> 添加目标
              </button>
            </div>
          </div>
          
          <div className="space-y-3">
            {sprint.microGoals.map((goal, idx) => (
              <div key={idx} className="p-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-sm group transition-all hover:border-slate-200 dark:hover:border-slate-600">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="px-2 py-0.5 bg-brand-green-light/30 text-[10px] md:text-xs font-bold text-brand-green-deep rounded-full uppercase tracking-wider">
                        {goal.mainCategory} • {goal.subCategory}
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
                        className="flex-1 bg-transparent border-none focus:ring-0 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-500 text-sm font-semibold text-slate-700 dark:text-slate-300"
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
                              if (!newGoals[idx].days) newGoals[idx].days = Array(info.totalDays).fill(false);
                              const wasChecked = newGoals[idx].days[dIdx];
                              newGoals[idx].days[dIdx] = !newGoals[idx].days[dIdx];
                              onUpdate({ microGoals: newGoals });
                              if (!wasChecked) showFeedback();
                            }}
                            className={`w-6 h-6 md:w-7 md:h-7 rounded-md flex items-center justify-center transition-all relative ${
                              day 
                                ? 'bg-brand-green-dark text-white shadow-sm' 
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            <span className="text-xs font-bold">{info.startDay + dIdx}</span>
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
                    className="text-slate-300 dark:text-slate-500 hover:text-red-400 transition-colors mt-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
            {sprint.microGoals.length === 0 && (
              <div 
                onClick={() => {
                  setIsSelectingGoal(true);
                  setSelectionStep('main');
                }}
                className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Plus size={20} className="mx-auto text-slate-300 dark:text-slate-500 mb-1" />
                <p className="text-sm md:text-base text-slate-400 dark:text-slate-500 font-medium">还没有微目标，点击添加</p>
              </div>
            )}
            {showUpgradeNote && sprint.microGoals.length >= 3 && (
              <div className="mt-4 py-3 px-4 bg-brand-green-light/10 border border-brand-green-light/30 rounded-xl text-center flex items-center justify-center gap-2 relative">
                <button 
                  onClick={() => setShowUpgradeNote(false)}
                  className="absolute top-2 right-2 text-brand-green-dark/50 hover:text-brand-green-dark transition-colors"
                >
                  <X size={14} />
                </button>
                <span className="text-lg">💡</span>
                <p className="text-sm md:text-base text-brand-green-dark font-bold tracking-wide">
                  想要添加更多微目标？请联系 Admin 开通高级服务。
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Goal Selection Modal */}
        <AnimatePresence>
          {isSelectingGoal && (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl w-full max-w-md space-y-6 overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-brand-green-deep">
                    {selectionStep === 'main' && "选择一个方向"}
                    {selectionStep === 'sub' && `专注哪个${selectedMain}?`}
                    {selectionStep === 'edit' && "确认你的微目标"}
                  </h3>
                  <button onClick={() => setIsSelectingGoal(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={20} />
                  </button>
                </div>

                <div className="min-h-[240px]">
                  {selectionStep === 'main' && (
                    <div className="grid grid-cols-1 gap-3">
                      {CATEGORIES.map(cat => {
                        const Template = GOAL_TEMPLATES[cat];
                        return (
                          <button
                            key={cat}
                            onClick={() => {
                              setSelectedMain(cat);
                              setSelectionStep('sub');
                            }}
                            className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-brand-green-dark hover:bg-brand-green-light/10 transition-all group"
                          >
                            <div className={`p-3 rounded-xl ${Template.color}`}>
                              <Template.icon size={24} />
                            </div>
                            <div className="text-left">
                              <div className="font-bold text-slate-800 dark:text-slate-200">{cat}</div>
                              <div className="text-xs text-slate-400">点击选择子分类</div>
                            </div>
                            <ChevronLeft size={16} className="ml-auto rotate-180 text-slate-300 group-hover:text-brand-green-dark" />
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectionStep === 'sub' && selectedMain && (
                    <div className="space-y-3">
                      <button 
                        onClick={() => setSelectionStep('main')}
                        className="text-xs font-bold text-brand-green-dark flex items-center gap-1 mb-2"
                      >
                        <ChevronLeft size={12} /> 返回主分类
                      </button>
                      <div className="grid grid-cols-1 gap-2">
                        {Object.entries(GOAL_TEMPLATES[selectedMain].subs).map(([sub, template]) => (
                          <button
                            key={sub}
                            onClick={() => {
                              setSelectedSub(sub);
                              setTempGoalText(template);
                              setSelectionStep('edit');
                            }}
                            className="flex items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-brand-green-dark hover:bg-brand-green-light/5 transition-all"
                          >
                            <div className="text-left">
                              <div className="font-bold text-slate-700 dark:text-slate-300">{sub}</div>
                              <div className="text-sm text-slate-400">{template}</div>
                            </div>
                            <Plus size={16} className="text-brand-green-dark" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectionStep === 'edit' && selectedMain && selectedSub && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg ${GOAL_TEMPLATES[selectedMain].color}`}>
                            {React.createElement(GOAL_TEMPLATES[selectedMain].icon, { size: 16 })}
                          </div>
                          <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">{selectedMain} • {selectedSub}</span>
                        </div>
                        <textarea
                          value={tempGoalText}
                          onChange={(e) => setTempGoalText(e.target.value)}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl focus:ring-2 focus:ring-brand-green-dark outline-none text-lg font-bold text-slate-700 dark:text-slate-200 resize-none h-32"
                          placeholder="输入你的微目标..."
                        />
                        <p className="text-xs text-slate-400 italic">💡 提示：微目标应是具体的、可每日执行的行为。</p>
                      </div>

                      <div className="flex gap-3">
                        <button 
                          onClick={() => setSelectionStep('sub')}
                          className="flex-1 py-3 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-500"
                        >
                          返回
                        </button>
                        <button 
                          onClick={() => {
                            const newGoal: MicroGoal = {
                              text: tempGoalText,
                              mainCategory: selectedMain,
                              subCategory: selectedSub,
                              days: Array(info.totalDays).fill(false)
                            };
                            onUpdate({ microGoals: [...sprint.microGoals, newGoal] });
                            setIsSelectingGoal(false);
                          }}
                          className="flex-[2] py-3 bg-brand-green-deep text-white rounded-xl font-bold shadow-lg shadow-brand-green-deep/20"
                        >
                          确认添加
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Stage Reflection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between ml-1">
            <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">阶段复盘</label>
            <span className="text-xs md:text-sm text-slate-400 dark:text-slate-500">记录本周期的感悟与成长</span>
          </div>
          <textarea
            value={sprint.reflection}
            onChange={(e) => onUpdate({ reflection: e.target.value })}
            placeholder="在这里记录你的阶段性反思..."
            className="w-full h-[140px] p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm focus:ring-2 focus:ring-brand-green-light focus:border-brand-green-dark outline-none text-sm md:text-base leading-relaxed placeholder:text-slate-300 dark:placeholder:text-slate-500 resize-none"
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
            <p className="text-sm text-slate-600 dark:text-slate-400">你已成功完成本周期。花点时间反思你的成长。</p>
          </motion.div>
        )}

        {/* Monthly Calendar for Journals */}
        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between ml-1">
            <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{info.monthName} 日记</label>
            <span className="text-xs md:text-sm text-slate-400 dark:text-slate-500">点击日期进入</span>
          </div>
          
          <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
            <div className="grid grid-cols-7 gap-1 md:gap-2 text-center mb-2">
              {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                <div key={day} className="text-xs font-bold text-slate-400 dark:text-slate-500 py-1">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 md:gap-2 text-center">
              {calendarDays.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="p-2"></div>;
                }
                
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                // Determine if this day has a journal entry
                const hasJournal = sprint.dailyLogs && sprint.dailyLogs[dateStr] !== undefined;
                
                // Determine if this day is in the current sprint
                const isSprintDay = day >= info.startDay && day <= info.endDay;
                
                // Determine if this day is today
                const today = new Date();
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

                return (
                  <button
                    key={day}
                    onClick={() => onEnterJournal(dateStr)}
                    className={`relative p-2 md:py-3 rounded-lg text-sm md:text-base font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                      isToday 
                        ? 'bg-brand-green-deep text-white shadow-md hover:bg-brand-green-dark' 
                        : isSprintDay
                          ? 'bg-brand-green-light/20 text-brand-green-dark hover:bg-brand-green-light/40'
                          : 'text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{day}</span>
                    {hasJournal && (
                      <div className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white dark:bg-slate-900' : 'bg-brand-green-dark'}`} />
                    )}
                  </button>
                );
              })}
            </div>
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
  const info = getSprintInfo(sprintId);
  const displayDate = date.split('-').reverse().slice(0, 2).join('/'); // DD/MM

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  
  const MOODS = [
    { emoji: '🥳', label: '兴奋' },
    { emoji: '😄', label: '开心' },
    { emoji: '😊', label: '满足' },
    { emoji: '😌', label: '平静' },
    { emoji: '⚖️', label: '有得有失' },
    { emoji: '🤔', label: '思考/困惑' },
    { emoji: '😫', label: '疲惫' },
    { emoji: '😰', label: '焦虑' },
    { emoji: '😔', label: '难过' },
    { emoji: '😠', label: '生气' },
  ];

  const updateField = (field: keyof DailyLog, value: any) => {
    onUpdate({ ...log, [field]: value });
  };

  const updateArrayField = (field: 'tasks' | 'achievements' | 'gratitude' | 'reflection', index: number, value: string) => {
    const newArr = [...log[field]];
    newArr[index] = value;
    updateField(field, newArr);
  };

  const addArrayItem = (field: 'tasks' | 'achievements' | 'gratitude' | 'reflection') => {
    const newArr = [...log[field], ''];
    if (field === 'tasks') {
      const newStatus = [...(log.taskStatus || []), false];
      onUpdate({ ...log, [field]: newArr, taskStatus: newStatus });
    } else {
      updateField(field, newArr);
    }
  };

  const removeArrayItem = (field: 'tasks' | 'achievements' | 'gratitude' | 'reflection', index: number) => {
    const newArr = [...log[field]];
    newArr.splice(index, 1);
    if (field === 'tasks') {
      const newStatus = [...(log.taskStatus || [])];
      newStatus.splice(index, 1);
      onUpdate({ ...log, [field]: newArr, taskStatus: newStatus });
    } else {
      updateField(field, newArr);
    }
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
          className="p-2 -ml-2 hover:bg-white/50 dark:hover:bg-slate-800/50 rounded-full transition-colors flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium"
        >
          <ChevronLeft size={20} />
          <span>返回微计划打卡</span>
        </button>
        <div className="flex flex-col items-end">
          <div className="px-3 py-1 bg-brand-green-deep text-white rounded-full text-xs md:text-sm font-black tracking-widest uppercase">
            {info.monthName}{['上旬', '中旬', '下旬'][info.sprintInMonth - 1]} • {info.startDay}/{info.monthIndex + 1} - {info.endDay}/{info.monthIndex + 1}
          </div>
        </div>
      </nav>

      <div className="glass-card p-6 space-y-8">
        <div className="text-center py-2">
          <p className="text-lg md:text-xl font-black text-brand-green-deep tracking-tight">
            {new Date().getFullYear()}年{new Date().getMonth() + 1}月{new Date().getDate()}日 • 我的日记
          </p>
        </div>

        {/* Encouragement */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2 ml-1">
            <span className="text-lg">💖</span>
            <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">鼓励自己的话</label>
          </div>
          <input 
            type="text"
            value={log.encouragement}
            onChange={(e) => updateField('encouragement', e.target.value)}
            placeholder="写下一句给自己的话..."
            className="w-full p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-sm focus:ring-2 focus:ring-brand-green-light focus:border-brand-green-dark outline-none text-sm md:text-base font-medium text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500"
          />
        </motion.div>

        {/* Sections Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tasks */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🎯</span>
              <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">今日核心任务</label>
            </div>
            <div className="space-y-2">
              {log.tasks.map((task, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button 
                    onClick={() => toggleTaskStatus(i)}
                    className={`transition-colors ${log.taskStatus?.[i] ? 'text-brand-green-dark' : 'text-slate-200 dark:text-slate-600 hover:text-slate-300 dark:hover:text-slate-400'}`}
                  >
                    {log.taskStatus?.[i] ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                  <input 
                    type="text"
                    value={task || ''}
                    onChange={(e) => updateArrayField('tasks', i, e.target.value)}
                    className={`flex-1 bg-white dark:bg-slate-800 border border-slate-50 dark:border-slate-700 p-2 rounded-lg text-sm md:text-base font-medium focus:border-brand-green-dark outline-none transition-all ${
                      log.taskStatus?.[i] ? 'text-slate-300 dark:text-slate-500 line-through' : 'text-slate-600 dark:text-slate-300'
                    }`}
                    placeholder={`任务 ${i + 1}...`}
                  />
                  <button onClick={() => removeArrayItem('tasks', i)} className="text-slate-300 dark:text-slate-500 hover:text-red-400 transition-colors p-1">
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button onClick={() => addArrayItem('tasks')} className="flex items-center gap-1 text-sm font-bold text-brand-green-dark hover:text-brand-green-deep transition-colors mt-2 ml-7">
                <Plus size={16} /> 添加任务
              </button>
            </div>
          </motion.div>

          {/* Achievements */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🏆</span>
              <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">今日小成就</label>
            </div>
            <div className="space-y-2">
              {log.achievements.map((achievement, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm md:text-base font-bold text-slate-300 dark:text-slate-500 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={achievement || ''}
                    onChange={(e) => updateArrayField('achievements', i, e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-50 dark:border-slate-700 p-2 rounded-lg text-sm md:text-base font-medium text-slate-600 dark:text-slate-300 focus:border-brand-green-dark outline-none transition-colors"
                  />
                  <button onClick={() => removeArrayItem('achievements', i)} className="text-slate-300 dark:text-slate-500 hover:text-red-400 transition-colors p-1">
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button onClick={() => addArrayItem('achievements')} className="flex items-center gap-1 text-sm font-bold text-brand-green-dark hover:text-brand-green-deep transition-colors mt-2 ml-6">
                <Plus size={16} /> 添加成就
              </button>
            </div>
          </motion.div>

          {/* Gratitude */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">🌷</span>
              <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">今日感恩</label>
            </div>
            <div className="space-y-2">
              {log.gratitude.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm md:text-base font-bold text-slate-300 dark:text-slate-500 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={item || ''}
                    onChange={(e) => updateArrayField('gratitude', i, e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-50 dark:border-slate-700 p-2 rounded-lg text-sm md:text-base font-medium text-slate-600 dark:text-slate-300 focus:border-brand-green-dark outline-none transition-colors"
                  />
                  <button onClick={() => removeArrayItem('gratitude', i)} className="text-slate-300 dark:text-slate-500 hover:text-red-400 transition-colors p-1">
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button onClick={() => addArrayItem('gratitude')} className="flex items-center gap-1 text-sm font-bold text-brand-green-dark hover:text-brand-green-deep transition-colors mt-2 ml-6">
                <Plus size={16} /> 添加感恩
              </button>
            </div>
          </motion.div>

          {/* Reflection */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 ml-1">
              <span className="text-lg">💡</span>
              <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">今日反思</label>
            </div>
            <div className="space-y-2">
              {log.reflection.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm md:text-base font-bold text-slate-300 dark:text-slate-500 w-4">{i + 1}。</span>
                  <input 
                    type="text"
                    value={item || ''}
                    onChange={(e) => updateArrayField('reflection', i, e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-50 dark:border-slate-700 p-2 rounded-lg text-sm md:text-base font-medium text-slate-600 dark:text-slate-300 focus:border-brand-green-dark outline-none transition-colors"
                  />
                  <button onClick={() => removeArrayItem('reflection', i)} className="text-slate-300 dark:text-slate-500 hover:text-red-400 transition-colors p-1">
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button onClick={() => addArrayItem('reflection')} className="flex items-center gap-1 text-sm font-bold text-brand-green-dark hover:text-brand-green-deep transition-colors mt-2 ml-6">
                <Plus size={16} /> 添加反思
              </button>
            </div>
          </motion.div>
        </div>

        {/* Mood */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800"
        >
          <div className="flex items-center gap-3 ml-1 h-6">
            <label className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">今日情绪</label>
            <span className="text-sm md:text-base font-black text-brand-green-dark bg-brand-green-light/20 px-2 py-0.5 rounded-lg">
              {MOODS.find(m => m.emoji === log.mood)?.label || '未选择'}
            </span>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
            {MOODS.map((m, i) => (
              <div key={i} className="relative flex justify-center">
                <button
                  onClick={() => updateField('mood', m.emoji)}
                  className={`w-full aspect-square flex flex-col items-center justify-center rounded-xl transition-all ${
                    log.mood === m.emoji 
                      ? 'bg-brand-green-dark text-white shadow-md scale-110' 
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="text-xl">{m.emoji}</span>
                </button>
              </div>
            ))}
          </div>
        </motion.div>

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
