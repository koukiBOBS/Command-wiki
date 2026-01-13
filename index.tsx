import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

// --- Types ---
type Edition = 'Java' | 'Bedrock' | 'Education' | 'NetEase';
type ViewMode = 'standard' | 'history';
type Category = '全部' | '基础' | '作弊' | '管理' | '技术';
type ActiveView = 'wiki' | 'ids';
type IDCategory = '全部' | '物品与方块' | '实体' | '状态效果' | '结构' | '生物群系';

interface CommandVersion {
  syntax: string;
  note?: string;
  isDeprecated?: boolean;
  deprecationReason?: string;
  versionRange?: string; 
  permission?: number; 
  requirements?: string[]; 
  legacy?: {
    syntax: string;
    versionRange: string;
  };
}

interface MinecraftCommand {
  name: string;
  description: string;
  category: '基础' | '作弊' | '管理' | '技术';
  details: {
    [key in Edition]?: CommandVersion;
  };
}

interface IDEntry {
  id: string;
  name: string;
  category: Exclude<IDCategory, '全部'>;
  namespace?: string;
}

// --- Constants for Fetching ---
const VERSION_MAP: Record<Edition, { label: string; value: string }[]> = {
  Java: [
    { label: '1.21', value: 'pc/1.21' },
    { label: '1.20.1', value: 'pc/1.20.1' },
    { label: '1.19.4', value: 'pc/1.19.4' },
    { label: '1.18.2', value: 'pc/1.18.2' },
    { label: '1.16.5', value: 'pc/1.16.5' },
    { label: '1.12.2', value: 'pc/1.12.2' },
    { label: '1.8.9', value: 'pc/1.8.9' },
  ],
  Bedrock: [
    { label: '1.21.0', value: 'bedrock/1.21.0' },
    { label: '1.19.80', value: 'bedrock/1.19.80' },
    { label: '1.18.11', value: 'bedrock/1.18.11' },
    { label: '1.17.10', value: 'bedrock/1.17.10' },
  ],
  Education: [{ label: '最新', value: 'bedrock/1.19.80' }],
  NetEase: [{ label: '1.12.2 (PC)', value: 'pc/1.12.2' }],
};

const COMMAND_DATABASE: MinecraftCommand[] = [
  // --- 基础指令 ---
  {
    name: 'help / ?',
    description: '列出所有可用指令或显示指定指令的语法帮助。',
    category: '基础',
    details: {
      Java: { syntax: '/help [指令名]', versionRange: "1.0 - 至今", permission: 0 },
      Bedrock: { syntax: '/help [页码|指令名] 或 /? [页码|指令名]', versionRange: "1.0.0 - 至今", permission: 0 },
      Education: { syntax: '/help [页码|指令名]', versionRange: "1.0 - 至今", permission: 0 }
    }
  },
  {
    name: 'tp / teleport',
    description: '传送实体（玩家、生物等）到指定位置或另一实体。',
    category: '基础',
    details: {
      Java: { syntax: '/tp <目标> <目的地> 或 /teleport <目标> <目的地>', versionRange: "1.0 - 至今", permission: 2, requirements: ["开启作弊"] },
      Bedrock: { syntax: '/tp <目标> <目的地>', versionRange: "1.0.0 - 至今", permission: 1, requirements: ["开启作弊"] }
    }
  },
  {
    name: 'gamemode',
    description: '更改玩家的游戏模式。',
    category: '作弊',
    details: {
      Java: { syntax: '/gamemode <模式>', versionRange: "1.3.1 - 至今", permission: 2 },
      Bedrock: { syntax: '/gamemode <模式> [玩家]', versionRange: "1.0.0 - 至今", permission: 1 }
    }
  },
  {
    name: 'execute',
    description: '在复杂条件下执行另一条指令。',
    category: '技术',
    details: {
      Java: { syntax: '/execute ... run <指令>', versionRange: "1.13 - 至今", permission: 2 },
      Bedrock: { syntax: '/execute ... run <指令>', versionRange: "1.19.70 - 至今", permission: 1 }
    }
  }
];

// --- Components ---

const App = () => {
  const [activeView, setActiveView] = useState<ActiveView>('wiki');
  const [edition, setEdition] = useState<Edition>('Java');
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [selectedCategory, setSelectedCategory] = useState<Category>('全部');
  const [selectedIDCategory, setSelectedIDCategory] = useState<IDCategory>('全部');
  const [selectedVersion, setSelectedVersion] = useState(VERSION_MAP['Java'][0].value);
  const [search, setSearch] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Dynamic ID State
  const [dynamicIDs, setDynamicIDs] = useState<IDEntry[]>([]);
  const [isLoadingIDs, setIsLoadingIDs] = useState(false);

  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('mc_command_search_history');
    if (saved) {
      try { setSearchHistory(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('mc_command_search_history', JSON.stringify(searchHistory));
  }, [searchHistory]);

  // Fetch IDs whenever version changes
  useEffect(() => {
    if (activeView === 'ids') {
      fetchMinecraftData(selectedVersion);
    }
  }, [selectedVersion, activeView]);

  // Sync version when edition changes
  useEffect(() => {
    const defaultVersion = VERSION_MAP[edition][0].value;
    setSelectedVersion(defaultVersion);
  }, [edition]);

  const fetchMinecraftData = async (versionPath: string) => {
    setIsLoadingIDs(true);
    try {
      const response = await fetch(`https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/${versionPath}/items.json`);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      
      const mappedData: IDEntry[] = data.map((item: any) => ({
        id: item.name,
        name: item.displayName || item.name,
        category: '物品与方块',
        namespace: 'minecraft'
      }));
      
      setDynamicIDs(mappedData);
    } catch (error) {
      console.error('Failed to fetch items:', error);
      setDynamicIDs([]); // Fallback to empty if fetch fails
    } finally {
      setIsLoadingIDs(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addToHistory = (term: string) => {
    const cleanTerm = term.trim();
    if (!cleanTerm) return;
    setSearchHistory(prev => {
      const filtered = prev.filter(h => h !== cleanTerm);
      return [cleanTerm, ...filtered].slice(0, 10);
    });
  };

  const filteredCommands = useMemo(() => {
    return COMMAND_DATABASE.filter(cmd => {
      const details = cmd.details[edition];
      if (!details) return false;
      const matchesSearch = cmd.name.toLowerCase().includes(search.toLowerCase()) || cmd.description.includes(search);
      const isDeprecated = !!details.isDeprecated;
      const matchesViewMode = viewMode === 'history' ? isDeprecated : !isDeprecated;
      const matchesCategory = selectedCategory === '全部' || cmd.category === selectedCategory;
      return matchesSearch && matchesViewMode && matchesCategory;
    });
  }, [search, edition, viewMode, selectedCategory]);

  const filteredIDs = useMemo(() => {
    return dynamicIDs.filter(item => {
      const matchesSearch = item.id.toLowerCase().includes(search.toLowerCase()) || 
                           item.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = selectedIDCategory === '全部' || item.category === selectedIDCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, selectedIDCategory, dynamicIDs]);

  const historySuggestions = useMemo(() => {
    if (!search.trim()) return searchHistory;
    return searchHistory.filter(h => h.toLowerCase().includes(search.toLowerCase()) && h.toLowerCase() !== search.toLowerCase());
  }, [search, searchHistory]);

  const handleAiAsk = async () => {
    if (!aiInput.trim()) return;
    setIsGenerating(true);
    setAiResponse('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是一个Minecraft专家。当前版本是：${edition} ${selectedVersion}。用户问：${aiInput}。请用中文回答并提供指令示例。`,
      });
      setAiResponse(response.text || '无法生成内容。');
    } catch (error) {
      setAiResponse('生成失败。');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('已复制：' + text);
  };

  const categories: Category[] = ['全部', '基础', '作弊', '管理', '技术'];
  const idCategories: IDCategory[] = ['全部', '物品与方块', '实体', '状态效果', '结构', '生物群系'];

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-6xl mx-auto mb-8 text-center">
        <h1 className="text-4xl md:text-6xl mc-font text-white mb-2 drop-shadow-md">
          我的世界指令库
        </h1>
        <p className="text-gray-400">Minecraft Command Wiki & Dynamic ID Master</p>
      </header>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside className="lg:col-span-1 space-y-6">
          <section className="mc-panel p-4">
            <h3 className="mc-font text-xl text-yellow-400 mb-4">导航控制</h3>
            <div className="flex flex-col gap-2 mb-6">
              <button onClick={() => setActiveView('wiki')} className={`mc-button text-left text-sm ${activeView === 'wiki' ? 'active' : ''}`}>
                📚 指令百科
              </button>
              <button onClick={() => setActiveView('ids')} className={`mc-button text-left text-sm ${activeView === 'ids' ? 'active' : ''}`}>
                🆔 万能ID库 (实时)
              </button>
            </div>

            <div className="flex flex-col gap-2 mb-6">
              <label className="text-xs text-gray-400 block mb-1 uppercase font-bold tracking-widest">选择平台</label>
              {(['Java', 'Bedrock', 'Education', 'NetEase'] as Edition[]).map(ed => (
                <button key={ed} onClick={() => setEdition(ed)} className={`mc-button text-left text-sm ${edition === ed ? 'active' : ''}`}>{ed}</button>
              ))}
            </div>

            {activeView === 'ids' && (
              <div className="mb-6">
                <label className="text-xs text-gray-400 block mb-2 uppercase font-bold tracking-widest">选择游戏版本</label>
                <select 
                  value={selectedVersion} 
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  className="w-full bg-black border-2 border-gray-600 p-2 text-white text-sm outline-none focus:border-blue-500"
                >
                  {VERSION_MAP[edition].map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}

            {activeView === 'wiki' && (
              <div className="mb-6">
                <label className="text-xs text-gray-400 block mb-2 uppercase font-bold tracking-widest">指令类别</label>
                <div className="grid grid-cols-2 gap-1 bg-black/30 p-1 rounded border border-gray-700">
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-[11px] py-1.5 px-2 rounded transition-all text-center ${selectedCategory === cat ? 'bg-blue-700 text-white border border-blue-400/50' : 'text-gray-400 hover:text-gray-200'}`}>{cat}</button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="mc-panel p-4 relative" ref={historyRef}>
            <h3 className="mc-font text-xl text-green-400 mb-4">快速过滤</h3>
            <div className="relative">
              <input type="text" placeholder="键入搜索关键词..." className="w-full bg-black border-2 border-gray-600 p-2 text-white text-sm focus:border-green-500 outline-none" value={search} onFocus={() => setShowHistory(true)} onKeyDown={(e) => { if (e.key === 'Enter') { addToHistory(search); setShowHistory(false); } }} onChange={(e) => { setSearch(e.target.value); setShowHistory(true); }} />
              {showHistory && historySuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-[#313131] border-2 border-black z-50 shadow-2xl mt-1">
                  <div className="flex justify-between items-center p-2 border-b border-black bg-black/20"><span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">历史记录</span><button onClick={() => setSearchHistory([])} className="text-[10px] text-red-400 hover:text-red-300">清空</button></div>
                  <ul className="max-h-48 overflow-y-auto scrollbar-thin">
                    {historySuggestions.map((item, idx) => (
                      <li key={idx} className="p-2 text-sm text-gray-300 hover:bg-green-700 hover:text-white cursor-pointer border-b border-black last:border-0" onClick={() => { setSearch(item); setShowHistory(false); addToHistory(item); }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section className="mc-panel p-4 bg-[#403025]">
            <h3 className="mc-font text-xl text-blue-400 mb-2">指令生成器</h3>
            <textarea className="w-full bg-black border-2 border-gray-600 p-2 text-white h-24 text-sm mb-2 outline-none" placeholder="描述你的需求..." value={aiInput} onChange={(e) => setAiInput(e.target.value)}></textarea>
            <button onClick={handleAiAsk} disabled={isGenerating} className="mc-button w-full disabled:opacity-50">{isGenerating ? '处理中...' : '询问专家'}</button>
            {aiResponse && <div className="mt-4 p-2 bg-black/50 border border-blue-500/50 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-48 scrollbar-thin font-mono text-blue-200">{aiResponse}</div>}
          </section>
        </aside>

        <main className="lg:col-span-3 space-y-4">
          {activeView === 'wiki' ? (
            <div className="grid grid-cols-1 gap-4">
              {filteredCommands.map(cmd => {
                const details = cmd.details[edition]!;
                return (
                  <div key={cmd.name} className={`command-card p-5 rounded-lg shadow-xl border-l-8 ${viewMode === 'history' ? 'border-l-red-800' : 'border-l-green-700'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-green-900/30 text-green-500">{cmd.category}</span>
                        <h3 className="text-xl font-bold text-white">/{cmd.name}</h3>
                      </div>
                      <button onClick={() => { copyToClipboard(details.syntax); addToHistory(cmd.name); }} className="text-xs text-gray-400 hover:text-white bg-white/5 px-2 py-1 rounded">复制</button>
                    </div>
                    <p className="text-gray-300 text-sm mb-4">{cmd.description}</p>
                    <div className="bg-black/40 p-3 rounded border-l-4 border-yellow-500">
                      <code className="text-sm block overflow-x-auto whitespace-pre">{details.syntax}</code>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mc-panel p-4 mb-4 bg-blue-900/20 border-blue-500/50 flex justify-between items-center">
                <div>
                  <h2 className="text-xl mc-font text-blue-400 mb-1">物品与方块 ID 库</h2>
                  <p className="text-xs text-gray-400">正在显示来自 <span className="text-white">PrismarineJS</span> 的官方数据 • 命名空间: <code className="text-[10px]">minecraft:</code></p>
                </div>
                {isLoadingIDs && <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>}
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredIDs.length > 0 ? filteredIDs.slice(0, 300).map((item, idx) => (
                  <div key={idx} className="command-card p-3 rounded flex flex-col justify-between border-l-4 border-l-blue-500 hover:bg-white/5 transition-all group">
                    <div>
                      <h4 className="text-white font-bold text-sm mb-1 group-hover:text-blue-400">{item.name}</h4>
                      <code className="text-[11px] text-yellow-500 block truncate">{item.id}</code>
                    </div>
                    <button 
                      onClick={() => { copyToClipboard(item.id); addToHistory(item.id); }} 
                      className="mt-2 text-[10px] text-center w-full bg-white/5 hover:bg-blue-900/40 py-1 rounded text-gray-400 hover:text-white"
                    >
                      复制 ID
                    </button>
                  </div>
                )) : (
                  !isLoadingIDs && <div className="col-span-full mc-panel p-16 text-center text-gray-500">此版本暂无物品数据</div>
                )}
                {filteredIDs.length > 300 && <div className="col-span-full p-4 text-center text-gray-500 text-xs">... 还有 {filteredIDs.length - 300} 个项，请通过搜索精确查找</div>}
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="max-w-6xl mx-auto mt-16 pt-8 border-t border-gray-800 text-center text-gray-500 text-sm pb-8">
        <p className="mc-font text-lg text-gray-400">Minecraft Command & Data Master</p>
        <p className="mt-1">数据由 PrismarineJS 提供 • 支持版本切换</p>
      </footer>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
