/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  ArrowLeft,
  ArrowRight,
  Calendar,
  PlusCircle,
  CheckCircle2,
  Upload, 
  FileText, 
  Send, 
  Copy, 
  Check, 
  Loader2, 
  Briefcase, 
  Target, 
  Zap, 
  Clock, 
  CreditCard, 
  PhoneCall,
  Image as ImageIcon,
  X,
  Plus,
  Database,
  Globe,
  Mail,
  Download,
  Trash2,
  Moon,
  Sun,
  AlertCircle,
  LogIn,
  LogOut,
  Settings,
  ShieldCheck,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  doc, 
  updateDoc, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
import * as XLSX from 'xlsx';
import { jsPDF } from "jspdf";
import { db, auth } from './firebase';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ActivityLog {
  id: string;
  action: string;
  timestamp: string;
  details?: string;
}

interface Lead {
  id: string;
  websiteUrl: string;
  contactEmail: string;
  companyName?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  score?: number;
  language?: 'ru' | 'en';
  emailSent?: boolean;
  websiteText?: string;
  screenshotUrl?: string;
  generatedProposal?: string;
  editedProposal?: string;
  skipReason?: string;
  createdAt: any;
  updatedAt: any;
  activityLogs?: ActivityLog[];
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [newWebsite, setNewWebsite] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [proposalTemplate, setProposalTemplate] = useState<'standard' | 'aggressive' | 'soft'>('standard');
  const [showStats, setShowStats] = useState(true);
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showConfirmProcess, setShowConfirmProcess] = useState(false);

  const addActivityLog = async (leadId: string, action: string, details?: string) => {
    try {
      const log: ActivityLog = {
        id: Math.random().toString(36).substr(2, 9),
        action,
        timestamp: new Date().toISOString(),
        details
      };
      const leadRef = doc(db, 'leads', leadId);
      const leadDoc = await getDocFromServer(leadRef);
      if (leadDoc.exists()) {
        const currentLogs = leadDoc.data().activityLogs || [];
        await updateDoc(leadRef, {
          activityLogs: [log, ...currentLogs].slice(0, 20),
          updatedAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('Error adding activity log:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showToast = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 3000);
  };
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'completed' | 'skipped'>('all');
  const [currentView, setCurrentView] = useState<'leads' | 'settings'>('leads');
  const [targetLanguage, setTargetLanguage] = useState<'ru' | 'en'>('ru');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [customGeminiKey, setCustomGeminiKey] = useState(localStorage.getItem('custom_gemini_key') || '');
  const [customResendKey, setCustomResendKey] = useState(localStorage.getItem('custom_resend_key') || '');
  const [apiStatus, setApiStatus] = useState<{ resend: boolean; gemini: boolean }>({ resend: false, gemini: false });
  const excelInputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    console.log("Setting up auth listener...");
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      console.log("Auth state changed:", u ? "User logged in" : "No user");
      setUser(u);
      setIsAuthReady(true);
    });

    // Fallback if auth takes too long
    const timeout = setTimeout(() => {
      if (!isAuthReady) {
        console.warn("Auth check timed out, forcing ready state.");
        setIsAuthReady(true);
      }
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // API Health Check
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        setApiStatus({ resend: data.hasResendKey });
      } catch (e) {
        console.error("Health check failed", e);
      }
    };
    checkHealth();
  }, []);

  // Leads Listener
  useEffect(() => {
    if (!user) {
      setLeads([]);
      return;
    }

    const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Lead[];
      setLeads(leadsData);
    }, (err) => {
      if (err.message.includes('permission-denied')) {
        setError("У вас нет прав администратора для просмотра базы данных.");
      } else {
        handleFirestoreError(err, OperationType.LIST, 'leads');
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        let importedCount = 0;
        for (const row of jsonData) {
          // Look for common column names
          const website = row.website || row.Website || row.site || row.Site || row.url || row.URL || row['Сайт'] || row['ссылка'];
          const email = row.email || row.Email || row.mail || row.Mail || row.contact || row['Почта'] || row['email'];

          if (website && email) {
            await addDoc(collection(db, 'leads'), {
              websiteUrl: String(website).startsWith('http') ? String(website) : `https://${String(website)}`,
              contactEmail: String(email),
              status: 'pending',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            importedCount++;
          }
        }
        showToast(`Успешно импортировано ${importedCount} лидов из таблицы.`);
      } catch (err) {
        console.error("Excel import error:", err);
        setError("Ошибка при чтении Excel файла. Убедитесь, что в таблице есть колонки 'website' и 'email'.");
      } finally {
        setIsImporting(false);
        if (excelInputRef.current) excelInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const processAllPending = async () => {
    const pendingLeads = leads.filter(l => l.status === 'pending');
    if (pendingLeads.length === 0) return;
    
    for (const lead of pendingLeads) {
      await processLead(lead);
    }
    setShowConfirmProcess(false);
  };

  const addLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebsite || !newEmail) return;

    setIsAdding(true);
    try {
      await addDoc(collection(db, 'leads'), {
        websiteUrl: newWebsite.startsWith('http') ? newWebsite : `https://${newWebsite}`,
        contactEmail: newEmail,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setNewWebsite('');
      setNewEmail('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leads');
    } finally {
      setIsAdding(false);
    }
  };

  const deleteLead = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'leads', id));
      if (selectedLead?.id === id) setSelectedLead(null);
      setSelectedLeadIds(prev => prev.filter(item => item !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `leads/${id}`);
    }
  };

  const deleteSelectedLeads = async () => {
    if (selectedLeadIds.length === 0) return;
    if (!window.confirm(`Удалить ${selectedLeadIds.length} выбранных лидов?`)) return;

    try {
      for (const id of selectedLeadIds) {
        await deleteDoc(doc(db, 'leads', id));
      }
      setSelectedLeadIds([]);
      if (selectedLead && selectedLeadIds.includes(selectedLead.id)) setSelectedLead(null);
      showToast(`Удалено ${selectedLeadIds.length} лидов`);
    } catch (err) {
      setError("Ошибка при массовом удалении");
    }
  };

  const exportToCSV = () => {
    const dataToExport = leads.map(l => ({
      Website: l.websiteUrl,
      Email: l.contactEmail,
      Status: l.status,
      Score: l.score || 'N/A',
      'Created At': l.createdAt?.toDate().toLocaleString() || 'N/A'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, `leads_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const toggleLeadSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLeadIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedLeadIds.length === filteredLeads.length) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(filteredLeads.map(l => l.id));
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchesTab = activeTab === 'all' 
      ? (lead.status === 'pending' || lead.status === 'processing' || lead.status === 'failed')
      : lead.status === activeTab;
    
    const matchesSearch = lead.websiteUrl.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (lead.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                          (lead.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    
    return matchesTab && matchesSearch;
  });

  const [editedProposal, setEditedProposal] = useState('');

  useEffect(() => {
    if (selectedLead) {
      setEditedProposal(selectedLead.editedProposal || selectedLead.generatedProposal || '');
    }
  }, [selectedLead]);

  const saveEditedProposal = async () => {
    if (!selectedLead) return;
    try {
      await updateDoc(doc(db, 'leads', selectedLead.id), {
        editedProposal: editedProposal,
        updatedAt: serverTimestamp()
      });
      addActivityLog(selectedLead.id, 'Proposal Edited', 'User manually updated the proposal text');
      showToast("Изменения сохранены!");
      setIsEditingProposal(false);
    } catch (err) {
      setError("Ошибка при сохранении");
    }
  };

  const processLead = async (lead: Lead) => {
    // Use custom key if available, otherwise fallback to env
    const apiKey = customGeminiKey || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      setError("Ключ Gemini API не настроен. Пожалуйста, добавьте его в настройках.");
      return;
    }

    try {
      await updateDoc(doc(db, 'leads', lead.id), {
        status: 'processing',
        updatedAt: serverTimestamp(),
        language: targetLanguage
      });

      const ai = new GoogleGenAI({ apiKey });
      
      // Simulate website scraping
      const mockWebsiteText = `Компания ${lead.websiteUrl.split('//')[1]?.split('.')[0] || 'Client'} занимается инновационными решениями в сфере B2B. На сайте представлены услуги по консалтингу и автоматизации. Отзывы клиентов подчеркивают высокую скорость работы, но отмечают нехватку оперативной поддержки в чате. Сайт выглядит немного устаревшим, мобильная версия грузится медленно.`;
      
      const model = "gemini-3-flash-preview";
      
      // Step 1: Deep Analysis & Scoring
      const analysisPrompt = `
        Ты — эксперт по B2B продажам и ИИ-технологиям. Проанализируй данные сайта: "${mockWebsiteText}".
        
        Твоя задача:
        1. Определить "боли" бизнеса (что можно улучшить с помощью ИИ).
        2. Оценить потенциал внедрения ИИ от 1 до 100 (Score).
        3. Решить, стоит ли предлагать услуги (PROCEED) или пропустить (SKIP).
        
        Критерии для SKIP:
        - Уже есть продвинутый ИИ-агент.
        - Сайт идеально автоматизирован.
        
        Верни JSON на языке: ${targetLanguage === 'ru' ? 'русский' : 'английский'}:
        {
          "decision": "PROCEED" или "SKIP",
          "reason": "причина решения",
          "score": число от 1 до 100,
          "pains": ["боль 1", "боль 2"],
          "solutions": ["решение 1", "решение 2"]
        }
      `;

      const analysisResponse = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: analysisPrompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const analysisData = JSON.parse(analysisResponse.text);

      if (analysisData.decision === "SKIP") {
        await updateDoc(doc(db, 'leads', lead.id), {
          status: 'skipped',
          skipReason: analysisData.reason,
          score: analysisData.score,
          updatedAt: serverTimestamp()
        });
        return;
      }

      // Step 2: Generate High-Quality Proposal
      const proposalPrompt = `
        Напиши премиальное коммерческое предложение для компании ${lead.websiteUrl}.
        Язык: ${targetLanguage === 'ru' ? 'Русский' : 'English'}.
        
        Контекст анализа:
        Боли: ${analysisData.pains.join(', ')}
        Предлагаемые решения: ${analysisData.solutions.join(', ')}
        
        Структура письма:
        1. Персонализированное приветствие.
        2. Признание достижений компании.
        3. Мягкое указание на выявленные "боли" (из анализа).
        4. Как наши ИИ-решения решат эти проблемы и увеличат прибыль.
        5. Призыв к действию (бесплатный аудит).
        
        Тон: Экспертный, лаконичный, дорогой.
        Напиши только текст письма.
      `;

      const proposalResponse = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: proposalPrompt }] }],
      });

      const mockScreenshot = `https://picsum.photos/seed/${lead.id}/800/600`;

      await updateDoc(doc(db, 'leads', lead.id), {
        status: 'completed',
        websiteText: mockWebsiteText,
        screenshotUrl: mockScreenshot,
        generatedProposal: proposalResponse.text,
        score: analysisData.score,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Processing error:", err);
      await updateDoc(doc(db, 'leads', lead.id), {
        status: 'failed',
        updatedAt: serverTimestamp()
      });
    }
  };

  const generatePDF = (lead: Lead) => {
    const doc = new jsPDF();
    
    // Simple PDF layout
    doc.setFontSize(20);
    doc.text("Commercial Proposal", 20, 20);
    
    doc.setFontSize(12);
    doc.text(`Target: ${lead.websiteUrl}`, 20, 35);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 42);
    
    doc.line(20, 48, 190, 48);
    
    const splitText = doc.splitTextToSize(lead.generatedProposal || '', 170);
    doc.text(splitText, 20, 60);
    
    doc.save(`Proposal_${lead.websiteUrl.replace(/[^a-z0-9]/gi, '_')}.pdf`);
  };

  const sendEmail = async (lead: Lead) => {
    if (!lead.generatedProposal) return;
    
    setIsSendingEmail(true);
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: lead.contactEmail,
          subject: targetLanguage === 'ru' ? 'Предложение по оптимизации вашего бизнеса' : 'Proposal for business optimization',
          text: lead.generatedProposal,
          customApiKey: customResendKey
        })
      });

      const result = await response.json();
      if (result.success) {
        await updateDoc(doc(db, 'leads', lead.id), {
          emailSent: true,
          updatedAt: serverTimestamp()
        });
        showToast("Письмо успешно отправлено!");
      } else {
        throw new Error(result.error?.message || "Failed to send email");
      }
    } catch (err) {
      console.error("Email error:", err);
      setError("Ошибка при отправке: " + (err instanceof Error ? err.message : "Неизвестная ошибка"));
    } finally {
      setIsSendingEmail(false);
    }
  };

  const saveCustomKeys = () => {
    localStorage.setItem('custom_gemini_key', customGeminiKey);
    localStorage.setItem('custom_resend_key', customResendKey);
    showToast("Ключи успешно сохранены локально!");
    setTimeout(() => window.location.reload(), 1000); // Reload after toast
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <Loader2 className="animate-spin text-emerald-600" size={32} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-12 rounded-3xl shadow-xl max-w-md w-full text-center border border-black/5"
        >
          <div className="w-20 h-20 bg-emerald-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-8 shadow-lg">
            <Briefcase size={40} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-4">AI Sales Pro</h1>
          <p className="text-slate-500 mb-10 leading-relaxed">
            Автоматизированная система генерации коммерческих предложений на основе анализа сайтов. Войдите как администратор.
          </p>
          <button
            onClick={handleLogin}
            className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-emerald-700 transition-all active:scale-[0.98] shadow-md"
          >
            <LogIn size={20} />
            Войти через Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#0a0a0a] text-slate-100' : 'bg-[#f5f5f5] text-slate-900'} font-sans selection:bg-emerald-100 pb-20 transition-colors duration-300`}>
      {/* Header */}
      <header className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-b border-black/5'} sticky top-0 z-10`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <Briefcase size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">AI B2B Sales Pro</h1>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <nav className={`flex items-center gap-1 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} p-1 rounded-xl`}>
              <button 
                onClick={() => setCurrentView('leads')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${currentView === 'leads' ? (theme === 'dark' ? 'bg-white/10 text-emerald-400' : 'bg-white shadow-sm text-emerald-600') : 'text-slate-500 hover:text-slate-700'}`}
              >
                Лиды
              </button>
              <button 
                onClick={() => setCurrentView('settings')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center gap-1.5 ${currentView === 'settings' ? (theme === 'dark' ? 'bg-white/10 text-emerald-400' : 'bg-white shadow-sm text-emerald-600') : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Settings size={14} className={currentView === 'settings' ? 'text-emerald-600' : 'text-slate-400'} />
                <span className="hidden xs:inline">Настройки</span>
              </button>
            </nav>
            
            <button 
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/5 text-yellow-400 hover:bg-white/10' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              title="Переключить тему"
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-slate-400 uppercase tracking-widest">
              <Database size={14} />
              <span>Admin Dashboard</span>
            </div>
            <div className="flex items-center gap-3 pl-6 border-l border-slate-100">
              <button 
                onClick={() => setCurrentView('settings')}
                className={`p-2 rounded-lg transition-colors ${currentView === 'settings' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                title="Настройки системы"
              >
                <Settings size={20} />
              </button>
              <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-slate-200" alt="Avatar" />
              <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Dashboard Stats */}
        {currentView === 'leads' && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-sm font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                Обзор показателей
              </h2>
              <button 
                onClick={() => setShowStats(!showStats)}
                className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                {showStats ? 'Скрыть' : 'Показать'}
              </button>
            </div>
            
            <AnimatePresence>
              {showStats && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-hidden"
                >
                  {[
                    { label: 'Всего лидов', value: leads.length, icon: Database, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                    { label: 'В очереди', value: leads.filter(l => l.status === 'pending').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                    { label: 'Готово', value: leads.filter(l => l.status === 'completed').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                    { label: 'Конверсия', value: `${leads.length ? Math.round((leads.filter(l => l.emailSent).length / leads.length) * 100) : 0}%`, icon: Target, color: 'text-purple-500', bg: 'bg-purple-500/10' },
                  ].map((stat, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} border p-5 rounded-2xl shadow-sm flex items-center gap-4 transition-colors`}
                    >
                      <div className={`w-12 h-12 ${stat.bg} rounded-xl flex items-center justify-center ${stat.color}`}>
                        <stat.icon size={24} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
                        <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
            <AlertCircle size={18} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {currentView === 'settings' ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto space-y-8"
          >
            <div className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-3xl p-10 shadow-sm border transition-colors`}>
              <h2 className={`text-2xl font-bold mb-8 flex items-center gap-3 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                <Settings className="text-emerald-600" /> Настройки системы
              </h2>

              <div className="space-y-10">
                {/* API Keys Configuration */}
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-6 flex items-center gap-2">
                    <Key size={16} /> Конфигурация API Ключей
                  </h3>
                  <div className="grid gap-6">
                    <div className="space-y-2">
                      <label className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Gemini AI API Key</label>
                      <div className="relative">
                        <input 
                          type="password"
                          value={customGeminiKey}
                          onChange={(e) => setCustomGeminiKey(e.target.value)}
                          placeholder="Вставьте ваш ключ от Google AI Studio..."
                          className={`w-full pl-4 pr-12 py-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none font-mono text-sm`}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          {apiStatus.gemini || customGeminiKey ? <CheckCircle2 size={18} className="text-emerald-500" /> : <AlertCircle size={18} className="text-slate-300" />}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400">Используется для анализа сайтов и генерации текста КП.</p>
                    </div>

                    <div className="space-y-2">
                      <label className={`text-sm font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Resend API Key</label>
                      <div className="relative">
                        <input 
                          type="password"
                          value={customResendKey}
                          onChange={(e) => setCustomResendKey(e.target.value)}
                          placeholder="re_..."
                          className={`w-full pl-4 pr-12 py-3 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all outline-none font-mono text-sm`}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          {apiStatus.resend || customResendKey ? <CheckCircle2 size={18} className="text-emerald-500" /> : <AlertCircle size={18} className="text-slate-300" />}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400">Необходим для отправки писем клиентам напрямую из приложения.</p>
                    </div>

                    <button 
                      onClick={saveCustomKeys}
                      className={`w-full py-3 ${theme === 'dark' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'} text-white rounded-xl font-bold transition-all active:scale-[0.98]`}
                    >
                      Сохранить ключи
                    </button>
                  </div>
                </section>

                {/* Preferences */}
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">Предпочтения</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-black/5">
                      <div>
                        <p className="text-sm font-bold">Язык предложений по умолчанию</p>
                        <p className="text-xs text-slate-500">На каком языке ИИ будет генерировать тексты</p>
                      </div>
                      <div className="flex bg-white p-1 rounded-lg border border-black/5">
                        <button 
                          onClick={() => setTargetLanguage('ru')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${targetLanguage === 'ru' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}
                        >
                          RU
                        </button>
                        <button 
                          onClick={() => setTargetLanguage('en')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${targetLanguage === 'en' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}
                        >
                          EN
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="text-center">
              <button 
                onClick={() => setCurrentView('leads')}
                className="text-sm font-bold text-slate-400 hover:text-emerald-600 transition-colors flex items-center justify-center gap-2 mx-auto"
              >
                <ArrowLeft size={16} /> Вернуться к базе лидов
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Pane: Details */}
            <div className="lg:col-span-4">
              <AnimatePresence mode="wait">
                {selectedLead ? (
                  <motion.div
                    key={selectedLead.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* Lead Info Header */}
                    <div className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-3xl p-6 shadow-sm border flex flex-col gap-4 transition-colors`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h2 className={`text-xl font-bold tracking-tight truncate ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                              {selectedLead.websiteUrl.replace('https://', '').replace('http://', '')}
                            </h2>
                          </div>
                          <div className="flex flex-col gap-2 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5 truncate"><Mail size={12} /> {selectedLead.contactEmail}</span>
                            <span className="flex items-center gap-1.5"><Calendar size={12} /> {new Date(selectedLead.createdAt?.toDate()).toLocaleDateString()}</span>
                            {selectedLead.emailSent && (
                              <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                                <Check size={12} /> Отправлено
                              </span>
                            )}
                          </div>
                        </div>

                        {selectedLead.score && (
                          <div className="relative w-16 h-16 flex-shrink-0">
                            <svg className="w-full h-full" viewBox="0 0 36 36">
                              <path
                                className={`${theme === 'dark' ? 'stroke-white/5' : 'stroke-slate-100'}`}
                                strokeWidth="3"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                              <path
                                className={`${selectedLead.score > 70 ? 'stroke-emerald-500' : 'stroke-amber-500'}`}
                                strokeWidth="3"
                                strokeDasharray={`${selectedLead.score}, 100`}
                                strokeLinecap="round"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center flex-col">
                              <span className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{selectedLead.score}</span>
                              <span className="text-[6px] uppercase font-bold text-slate-400">Score</span>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 pt-2 border-t border-black/5">
                        {selectedLead.status === 'completed' && (
                          <>
                            <button 
                              onClick={() => generatePDF(selectedLead)}
                              className="p-2.5 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-colors border border-black/5"
                              title="Скачать PDF"
                            >
                              <FileText size={18} />
                            </button>
                            <button 
                              onClick={() => sendEmail(selectedLead)}
                              disabled={isSendingEmail}
                              className={`flex-1 p-2.5 rounded-xl transition-all border border-black/5 flex items-center justify-center gap-2 font-bold text-xs ${
                                selectedLead.emailSent 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200'
                              }`}
                            >
                              {isSendingEmail ? (
                                <Loader2 className="animate-spin" size={16} />
                              ) : selectedLead.emailSent ? (
                                <>Повторить <Send size={14} /></>
                              ) : (
                                <>Отправить <Send size={14} /></>
                              )}
                            </button>
                          </>
                        )}
                        {selectedLead.status === 'pending' || selectedLead.status === 'failed' ? (
                          <button 
                            onClick={() => processLead(selectedLead)}
                            className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg flex items-center justify-center gap-2 text-sm"
                          >
                            <Zap size={16} /> Начать анализ
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {selectedLead.status === 'skipped' ? (
                      <div className="bg-white rounded-3xl p-10 shadow-sm border border-black/5 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-500">
                          <X size={24} />
                        </div>
                        <h3 className="text-lg font-bold mb-1">Лид пропущен</h3>
                        <p className="text-slate-500 text-xs max-w-xs mb-4">
                          {selectedLead.skipReason}
                        </p>
                        <button 
                          onClick={() => processLead(selectedLead)}
                          className="text-[10px] font-bold text-emerald-600 hover:underline uppercase tracking-widest"
                        >
                          Все равно обработать
                        </button>
                      </div>
                    ) : selectedLead.status === 'completed' ? (
                      <div className="space-y-6">
                        {/* Analysis Results */}
                        <section className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-2xl p-4 shadow-sm border transition-colors`}>
                          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                            <ImageIcon size={12} /> Визуальный аудит
                          </h3>
                          <div className="aspect-video rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                            <img src={selectedLead.screenshotUrl} className="w-full h-full object-cover" alt="Website Screenshot" referrerPolicy="no-referrer" />
                          </div>
                        </section>

                        {/* Generated Proposal */}
                        <div className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-2xl shadow-lg border overflow-hidden flex flex-col transition-colors`}>
                          <div className={`${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-black/5'} px-4 py-3 border-b flex items-center justify-between`}>
                            <div className="flex items-center gap-2 text-emerald-600">
                              <Target size={16} />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Proposal</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => setIsEditingProposal(!isEditingProposal)}
                                className={`p-1.5 rounded-lg transition-colors ${isEditingProposal ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-100'}`}
                                title="Редактировать"
                              >
                                <PlusCircle size={14} />
                              </button>
                              <button
                                onClick={() => copyToClipboard(editedProposal)}
                                className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-emerald-600 transition-colors"
                              >
                                {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                {copied ? 'Ок' : 'Копировать'}
                              </button>
                            </div>
                          </div>
                          <div className="p-6">
                            {isEditingProposal ? (
                              <div className="space-y-4">
                                <textarea
                                  value={editedProposal}
                                  onChange={(e) => setEditedProposal(e.target.value)}
                                  className={`w-full h-[400px] p-4 rounded-2xl border ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-700'} text-sm font-serif leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500 transition-all`}
                                />
                                <div className="flex items-center justify-end gap-3">
                                  <button 
                                    onClick={() => setIsEditingProposal(false)}
                                    className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                                  >
                                    Отмена
                                  </button>
                                  <button 
                                    onClick={saveEditedProposal}
                                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-md"
                                  >
                                    Сохранить
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className={`whitespace-pre-wrap leading-relaxed font-serif text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                                {editedProposal}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Activity Logs */}
                        <div className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-2xl shadow-sm border overflow-hidden transition-colors`}>
                          <div className={`${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-black/5'} px-4 py-2 border-b`}>
                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                              <Clock size={12} /> История действий
                            </h3>
                          </div>
                          <div className="p-4 space-y-4 max-h-[250px] overflow-y-auto custom-scrollbar relative">
                            {selectedLead.activityLogs && selectedLead.activityLogs.length > 0 ? (
                              <div className="space-y-4">
                                {selectedLead.activityLogs.map((log, idx) => (
                                  <div key={log.id} className="relative flex gap-3">
                                    {idx !== selectedLead.activityLogs!.length - 1 && (
                                      <div className="absolute left-[7px] top-4 bottom-[-16px] w-[2px] bg-slate-100 dark:bg-white/5" />
                                    )}
                                    <div className={`w-4 h-4 rounded-full border-2 ${theme === 'dark' ? 'bg-[#141414] border-emerald-500/50' : 'bg-white border-emerald-500'} flex-shrink-0 z-10`} />
                                    <div className="flex-1 pb-2">
                                      <div className="flex items-center justify-between mb-0.5">
                                        <p className={`text-[10px] font-bold ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{log.action}</p>
                                        <p className="text-[8px] text-slate-400">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                      </div>
                                      {log.details && <p className="text-[9px] text-slate-500 leading-relaxed">{log.details}</p>}
                                      <p className="text-[7px] text-slate-300 dark:text-slate-600 mt-1">{new Date(log.timestamp).toLocaleDateString()}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-8">
                                <Clock size={24} className="mx-auto text-slate-200 mb-2" />
                                <p className="text-[10px] text-slate-400 italic">История пуста</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : selectedLead.status === 'processing' ? (
                      <div className="bg-white rounded-3xl p-10 shadow-sm border border-black/5 flex flex-col items-center justify-center text-center">
                        <Loader2 className="animate-spin text-emerald-600 mb-4" size={32} />
                        <h3 className="text-lg font-bold mb-1">Анализируем...</h3>
                        <p className="text-slate-500 text-xs">
                          Изучаем структуру сайта и контент...
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-3xl p-10 shadow-sm border border-black/5 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
                          <Zap size={24} />
                        </div>
                        <h3 className="text-lg font-bold mb-1">Ожидание</h3>
                        <p className="text-slate-500 text-xs">
                          Нажмите "Начать анализ" для запуска.
                        </p>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <div className={`h-full min-h-[400px] ${theme === 'dark' ? 'bg-white/5 border-white/5' : 'bg-white/50 border-slate-200'} border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 text-center transition-colors`}>
                    <div className={`w-20 h-20 ${theme === 'dark' ? 'bg-white/5' : 'bg-white'} rounded-3xl shadow-sm flex items-center justify-center text-emerald-500 mb-6`}>
                      <Target size={40} className="opacity-50" />
                    </div>
                    <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-400'}`}>Выберите лида</h3>
                    <p className="text-slate-400 text-sm max-w-[240px] leading-relaxed">
                      Выберите компанию из списка справа, чтобы увидеть детальный анализ и сгенерированное предложение.
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Right Pane: Add Form + List */}
            <div className="lg:col-span-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Add Lead Form */}
                <section className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-3xl p-6 shadow-sm border transition-colors`}>
                  <h2 className={`text-sm font-bold mb-4 flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                    <PlusCircle className="text-emerald-600" size={18} /> Добавить клиента
                  </h2>
                  <form onSubmit={addLead} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                          type="text"
                          value={newWebsite}
                          onChange={(e) => setNewWebsite(e.target.value)}
                          placeholder="example.com"
                          className={`w-full pl-9 pr-3 py-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm transition-all`}
                        />
                      </div>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="ceo@example.com"
                          className={`w-full pl-9 pr-3 py-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-sm transition-all`}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isAdding}
                      className={`w-full py-2.5 ${theme === 'dark' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-black'} text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm`}
                    >
                      {isAdding ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                      Добавить в базу
                    </button>
                  </form>

                  <div className={`mt-4 pt-4 border-t ${theme === 'dark' ? 'border-white/5' : 'border-slate-100'} flex items-center justify-between text-[10px] text-slate-400`}>
                    <div className="flex items-center gap-4">
                      <span>Импорт данных:</span>
                      <button 
                        onClick={() => excelInputRef.current?.click()}
                        className="text-emerald-600 font-bold hover:underline"
                      >
                        Excel / CSV
                      </button>
                    </div>
                    <input 
                      type="file" 
                      ref={excelInputRef} 
                      onChange={handleExcelImport} 
                      className="hidden" 
                      accept=".xlsx, .xls, .csv"
                    />
                  </div>
                </section>

                {/* Quick Stats or Actions */}
                <div className={`rounded-3xl p-6 text-white shadow-lg flex flex-col justify-between transition-all ${theme === 'dark' ? 'bg-emerald-900/40 border border-emerald-500/20 shadow-none' : 'bg-emerald-600 shadow-emerald-200'}`}>
                  <div>
                    <h3 className="text-lg font-bold mb-1">Массовая обработка</h3>
                    <p className="text-emerald-100 text-xs opacity-80">Запустите анализ всех новых лидов в один клик</p>
                  </div>
                  <button 
                    onClick={() => setShowConfirmProcess(true)}
                    disabled={!leads.some(l => l.status === 'pending')}
                    className={`mt-4 w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${theme === 'dark' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white text-emerald-700 hover:bg-emerald-50'}`}
                  >
                    <Zap size={18} /> Обработать очередь ({leads.filter(l => l.status === 'pending').length})
                  </button>
                </div>
              </div>

              {/* Leads List */}
              <div className={`${theme === 'dark' ? 'bg-[#141414] border-white/5' : 'bg-white border-black/5'} rounded-3xl shadow-sm border overflow-hidden transition-colors`}>
                <div className={`p-4 border-b ${theme === 'dark' ? 'border-white/5 bg-white/5' : 'border-slate-50 bg-slate-50/50'} flex flex-col lg:flex-row items-center justify-between gap-4`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div 
                      onClick={toggleSelectAll}
                      className={`w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-all ${selectedLeadIds.length === filteredLeads.length && filteredLeads.length > 0 ? 'bg-emerald-600 border-emerald-600 text-white' : (theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-slate-300 bg-white')}`}
                      title="Выбрать всех"
                    >
                      {selectedLeadIds.length === filteredLeads.length && filteredLeads.length > 0 ? <Check size={12} strokeWidth={4} /> : selectedLeadIds.length > 0 && <div className="w-2 h-0.5 bg-slate-400" />}
                    </div>

                    <div className={`flex ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-200/50'} p-1 rounded-lg gap-1`}>
                      <button 
                        onClick={() => setActiveTab('all')}
                        className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === 'all' ? (theme === 'dark' ? 'bg-white/10 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm') : 'text-slate-500'}`}
                      >
                        Очередь ({leads.filter(l => l.status === 'pending' || l.status === 'processing').length})
                      </button>
                      <button 
                        onClick={() => setActiveTab('completed')}
                        className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === 'completed' ? (theme === 'dark' ? 'bg-white/10 text-emerald-400 shadow-sm' : 'bg-white text-emerald-600 shadow-sm') : 'text-slate-500'}`}
                      >
                        Готово ({leads.filter(l => l.status === 'completed').length})
                      </button>
                      <button 
                        onClick={() => setActiveTab('skipped')}
                        className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${activeTab === 'skipped' ? (theme === 'dark' ? 'bg-white/10 text-red-400 shadow-sm' : 'bg-white text-red-600 shadow-sm') : 'text-slate-500'}`}
                      >
                        Пропуск ({leads.filter(l => l.status === 'skipped').length})
                      </button>
                    </div>

                    <div className="flex items-center gap-2 ml-2">
                      <button 
                        onClick={exportToCSV}
                        className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-white/5 text-slate-400 hover:bg-white/10' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        title="Экспорт в CSV"
                      >
                        <Download size={16} />
                      </button>
                      {selectedLeadIds.length > 0 && (
                        <button 
                          onClick={deleteSelectedLeads}
                          className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors border border-red-100 flex items-center gap-2 text-[10px] font-bold"
                        >
                          <Trash2 size={16} />
                          <span className="hidden sm:inline">Удалить ({selectedLeadIds.length})</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Search Bar */}
                  <div className="relative w-full sm:w-64">
                    <Target className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Поиск по домену..."
                      className={`w-full pl-9 pr-3 py-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'} border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none text-[10px] transition-all`}
                    />
                  </div>
                </div>

                <div className="divide-y divide-slate-50 max-h-[800px] overflow-y-auto custom-scrollbar">
                  {filteredLeads.length > 0 ? (
                    <div className={`grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x ${theme === 'dark' ? 'divide-white/5' : 'divide-slate-50'}`}>
                      {filteredLeads.map((lead) => (
                        <div 
                          key={lead.id}
                          onClick={() => setSelectedLead(lead)}
                          className={`group p-4 hover:bg-emerald-50/30 transition-all cursor-pointer flex items-center justify-between ${selectedLead?.id === lead.id ? (theme === 'dark' ? 'bg-emerald-500/10 border-r-4 border-emerald-500' : 'bg-emerald-50 border-r-4 border-emerald-500') : ''}`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div 
                              onClick={(e) => toggleLeadSelection(lead.id, e)}
                              className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${selectedLeadIds.includes(lead.id) ? 'bg-emerald-600 border-emerald-600 text-white' : (theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-slate-300 bg-white')}`}
                            >
                              {selectedLeadIds.includes(lead.id) && <Check size={12} strokeWidth={4} />}
                            </div>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${lead.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : lead.status === 'processing' ? 'bg-amber-100 text-amber-600' : (theme === 'dark' ? 'bg-white/5 text-slate-500 group-hover:bg-white/10' : 'bg-slate-100 text-slate-400 group-hover:bg-white')}`}>
                              {lead.status === 'completed' ? <CheckCircle2 size={20} /> : lead.status === 'processing' ? <Loader2 size={20} className="animate-spin" /> : <Globe size={20} />}
                            </div>
                            <div className="min-w-0">
                              <h3 className={`font-bold text-sm truncate group-hover:text-emerald-500 transition-colors ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                                {lead.websiteUrl.replace('https://', '').replace('http://', '')}
                              </h3>
                              <div className="flex items-center gap-2 mt-0.5">
                                {lead.score && (
                                  <span className={`text-[10px] font-black ${lead.score > 70 ? 'text-emerald-500' : 'text-amber-500'}`}>
                                    {lead.score}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400 truncate">
                                  {lead.contactEmail || 'No email'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {lead.emailSent && <Check size={14} className="text-emerald-500" />}
                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                              className="p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-20 text-center">
                      <div className={`w-20 h-20 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-50'} rounded-3xl flex items-center justify-center text-slate-200 mx-auto mb-6`}>
                        <Target size={40} className="opacity-30" />
                      </div>
                      <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-slate-300' : 'text-slate-400'}`}>Ничего не найдено</h3>
                      <p className="text-slate-400 text-sm max-w-[240px] mx-auto">Попробуйте изменить параметры поиска или переключите вкладку фильтра.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-sm"
          >
            <CheckCircle2 className="text-emerald-400" size={18} />
            {successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmProcess && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmProcess(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full"
            >
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-6">
                <Zap size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2">Запустить массовую обработку?</h3>
              <p className="text-slate-500 mb-8 leading-relaxed">
                Система проанализирует все лиды со статусом "Ожидание" ({leads.filter(l => l.status === 'pending').length} шт). Это может занять несколько минут.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowConfirmProcess(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
                >
                  Отмена
                </button>
                <button 
                  onClick={processAllPending}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                >
                  Запустить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
