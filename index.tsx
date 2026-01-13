import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

// --- Types ---
type Edition = 'Java' | 'Bedrock' | 'Education' | 'NetEase';
type ViewMode = 'standard' | 'history';
type Category = '全部' | '基础' | '作弊' | '管理' | '技术' | '教育';
type ActiveView = 'wiki' | 'ids';
type IDCategory = '物品与方块' | '实体' | '状态效果' | '生物群系';

interface CommandVersion {
  syntax: string;
  note?: string;
  isDeprecated?: boolean;
  deprecationReason?: string;
  versionRange?: string; 
  permission?: number; 
  requirements?: string[]; 
}

interface MinecraftCommand {
  name: string;
  description: string;
  category: Category;
  details: {
    [key in Edition]?: CommandVersion;
  };
}

interface IDEntry {
  id: string;
  name: string;
  category: IDCategory;
  namespace?: string;
}

// --- Data Constants ---
const VERSION_MAP: Record<Edition, { label: string; value: string }[]> = {
  Java: [
    { label: '1.21', value: 'pc/1.21' },
    { label: '1.20.1', value: 'pc/1.20.1' },
    { label: '1.19.4', value: 'pc/1.19.4' },
    { label: '1.18.2', value: 'pc/1.18.2' },
    { label: '1.16.5', value: 'pc/1.16.5' },
    { label: '1.12.2', value: 'pc/1.12.2' },
  ],
  Bedrock: [
    { label: '1.21.0', value: 'bedrock/1.21.0' },
    { label: '1.20.0', value: 'bedrock/1.20.0' },
    { label: '1.19.80', value: 'bedrock/1.19.80' },
  ],
  Education: [{ label: '最新', value: 'bedrock/1.21.0' }],
  NetEase: [{ label: '1.12.2', value: 'pc/1.12.2' }],
};

const CATEGORY_FILE_MAP: Record<IDCategory, string> = {
  '物品与方块': 'items.json',
  '实体': 'entities.json',
  '状态效果': 'effects.json',
  '生物群系': 'biomes.json',
};

const COMMAND_DATABASE: MinecraftCommand[] = [
  {
    name: 'help / ?',
    description: '提供指令的使用指南。',
    category: '基础',
    details: {
      Java: { syntax: '/help [指令]', versionRange: "1.0+", permission: 0 },
      Bedrock: { syntax: '/help [页码|指令]', versionRange: "1.0+", permission: 0 },
      Education: { syntax: '/help [指令]', versionRange: "1.0+", permission: 0 }
    }
  },
  {
    name: 'tp / teleport',
    description: '将实体传送至特定坐标或目标。',
    category: '基础',
    details: {
      Java: { syntax: '/tp <目标> <目的地>', versionRange: "1.0+", permission: 2 },
      Bedrock: { syntax: '/tp <目标> <目的地>', versionRange: "1.0+", permission: 1 }
    }
  },
  {
    name: 'give',
    description: '给予玩家指定物品。',
    category: '作弊',
    details: {
      Java: { syntax: '/give <玩家> <物品> [数量]', versionRange: "1.0+", permission: 2 },
      Bedrock: { syntax: '/give <玩家> <物品> [数量] [数据]', versionRange: "1.0+", permission: 1 }
    }
  },
  {
    name: 'gamemode',
    description: '更改玩家的游戏模式。',
    category: '作弊',
    details: {
      Java: { syntax: '/gamemode <模式> [玩家]', versionRange: "1.3.1+", permission: 2 },
      Bedrock: { syntax: '/gamemode <模式> [玩家]', versionRange: "1.0+", permission: 1 }
    }
  },
  {
    name: 'ability',
    description: '赋予或剥夺玩家的能力。',
    category: '教育',
    details: {
      Education: { syntax: '/ability <玩家> <能力> <值>', versionRange: "EDU独有", permission: 1 },
      Bedrock: { syntax: '/ability <玩家> <能力> <值>', note: "仅限教育模式开启时使用。" }
    }
  },
  {
    name: 'wb / worldbuilder',
    description: '切换世界建造者状态。',
    category: '教育',
    details: {
      Education: { syntax: '/wb', note: "允许在受限区域放置方块。", permission: 1 },
      Bedrock: { syntax: '/wb', note: "仅限开启教育模式可用。" }
    }
  },
  {
    name: 'execute',
    description: '在特定条件下执行指令。',
    category: '技术',
    details: {
      Java: { syntax: '/execute ... run <指令>', versionRange: "1.13+", permission: 2, note: "Java 1.13 重构了该指令语法。" },
      Bedrock: { syntax: '/execute ... run <指令>', versionRange: "1.19.70+", permission: 1, note: "现已与 Java 语法对齐。" }
    }
  },
  {
    name: 'testfor',
    description: '检测实体是否存在。',
    category: '技术',
    details: {
      Java: { syntax: '/testfor <目标>', isDeprecated: true, deprecationReason: "1.13后并入/execute指令。" },
      Bedrock: { syntax: '/testfor <目标>', versionRange: "1.0+", permission: 1 }
    }
  }
];

const App = () => {
  const [activeView, setActiveView] = useState<ActiveView>('wiki');
  const [edition, setEdition] = useState<Edition>('Java');
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [selectedCategory, setSelectedCategory] = useState<Category>('全部');
  const [selectedIDCategory, setSelectedIDCategory] = useState<IDCategory>('物品与方块');
  const [selectedVersion, setSelectedVersion] = useState(VERSION_MAP['Java'][0].value);
  const [search, setSearch] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [dynamicIDs, setDynamicIDs] = useState<IDEntry[]>([]);
  const [isLoadingIDs, setIsLoadingIDs] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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

  useEffect(() => {
    if (activeView === 'ids') {
      fetchMinecraftData(selectedVersion, selectedIDCategory);
    }
  }, [selectedVersion, activeView, selectedIDCategory]);

  useEffect(() => {
    const defaultVersion = VERSION_MAP[edition][0].value;
    setSelectedVersion(defaultVersion);
    setFetchError(null);
  }, [edition]);

  const fetchMinecraftData = async (versionPath: string, idCategory: IDCategory) => {
    const fileName = CATEGORY_FILE_MAP[idCategory];
    const targetUrl = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/${versionPath}/${fileName}`;
    
    setIsLoadingIDs(true);
    setFetchError(null);
    
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error(`无法获取数据 (HTTP ${response.status})`);
      const data = await response.json();
      
      const mappedData: IDEntry[] = data.map((item: any) => ({
        id: item.name,
        name: item.displayName || item.name,
        category: idCategory,
        namespace: 'minecraft'
      }));
      
      setDynamicIDs(mappedData);
    } catch (error: any) {
      setFetchError(error.message);
      setDynamicIDs([]);
    } finally {
      setIsLoadingIDs(false);
    }
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
      return matchesSearch;
    });
  }, [search, dynamicIDs]);

  const handleAiAsk = async () => {
    if (!aiInput.trim()) return;
    setIsGenerating(true);
    setAiResponse('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `你是一位深谙《我的世界》全版本的顶级专家。请用专业、简洁的中文回答用户关于 ${edition} 版的问题：${aiInput}。如果涉及指令，请务必提供完整的 / 格式代码。`,
      });
      setAiResponse(response.text || '无法生成内容。');
    } catch (error) {
      setAiResponse('连接专家失败，请稍后重试。');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Silent success or custom toast would be better, using simple alert for now
    // Toast logic omitted for brevity
  };

  const categories: Category[] = ['全部', '基础', '作弊', '管理', '技术', '教育'];
  const idCategories: IDCategory[] = ['物品与方块', '实体', '状态效果', '生物群系'];

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-7xl mx-auto mb-8 text-center">
        <h1 className="text-5xl md:text-7xl mc-font text-white mb-4 drop-shadow-xl tracking-tighter">
          MINECRAFT 指令百科
        </h1>
        <div className="h-1 w-32 bg-green-600 mx-auto rounded-full shadow-lg"></div>
      </header>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar */}
        <aside className="lg:col-span-3 space-y-6">
          <section className="mc-panel p-5">
            <h3 className="mc-font text-2xl text-yellow-400 mb-5 border-b border-white/10 pb-2">功能导航</h3>
            <div className="flex flex-col gap-3 mb-8">
              <button onClick={() => setActiveView('wiki')} className={`mc-button text-left text-sm flex items-center gap-2 ${activeView === 'wiki' ? 'active' : ''}`}>
                <span className="text-lg">📚</span> 指令百科
              </button>
              <button onClick={() => setActiveView('ids')} className={`mc-button text-left text-sm flex items-center gap-2 ${activeView === 'ids' ? 'active' : ''}`}>
                <span className="text-lg">🆔</span> 万能 ID 库
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]">游戏版本</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Java', 'Bedrock', 'Education', 'NetEase'] as Edition[]).map(ed => (
                    <button key={ed} onClick={() => setEdition(ed)} className={`text-xs py-2 px-3 rounded border transition-all ${edition === ed ? 'bg-green-700 border-green-400 text-white shadow-lg' : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'}`}>{ed}</button>
                  ))}
                </div>
              </div>

              {activeView === 'wiki' ? (
                <div>
                  <label className="text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]">指令分类</label>
                  <div className="grid grid-cols-2 gap-2">
                    {categories.map(cat => (
                      <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-xs py-2 rounded border transition-all ${selectedCategory === cat ? 'bg-blue-700 border-blue-400 text-white shadow-lg' : 'bg-black/40 border-gray-700 text-gray-500 hover:text-gray-300'}`}>{cat}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]">数据库版本</label>
                    <select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} className="w-full bg-black/60 border border-gray-700 p-2 text-white text-xs rounded outline-none focus:border-blue-500">
                      {VERSION_MAP[edition].map(v => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]">库分类</label>
                    <div className="flex flex-col gap-1">
                      {idCategories.map(cat => (
                        <button key={cat} onClick={() => setSelectedIDCategory(cat)} className={`text-left text-xs py-2 px-3 rounded transition-all ${selectedIDCategory === cat ? 'bg-blue-800 text-white border-l-4 border-blue-400' : 'text-gray-500 hover:bg-white/5'}`}>{cat}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="mc-panel p-5 bg-[#403025]">
            <h3 className="mc-font text-2xl text-blue-400 mb-4 flex items-center gap-2">
               AI 专家问答
            </h3>
            <div className="relative group">
               <textarea 
                  className="w-full bg-black/80 border-2 border-gray-700 p-3 text-white h-32 text-xs mb-3 outline-none focus:border-blue-500 rounded transition-all" 
                  placeholder="例如：如何用指令生成一个骑着猪的僵尸？"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
               ></textarea>
               <div className="absolute top-2 right-2 opacity-20 group-hover:opacity-100 transition-opacity">
                  <span className="text-[10px] bg-blue-600 px-1 rounded text-white">Gemini 3.0</span>
               </div>
            </div>
            <button onClick={handleAiAsk} disabled={isGenerating} className="mc-button w-full disabled:opacity-50">
               {isGenerating ? '思考中...' : '提交问题'}
            </button>
            {aiResponse && (
              <div className="mt-4 p-4 bg-black/60 border border-blue-900/50 rounded-lg text-xs leading-relaxed text-blue-100 font-mono overflow-y-auto max-h-64 custom-scrollbar whitespace-pre-wrap shadow-inner">
                {aiResponse}
              </div>
            )}
          </section>
        </aside>

        {/* Main Content */}
        <main className="lg:col-span-9 space-y-6">
          <div className="mc-panel p-4 flex items-center gap-4 bg-black/20">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input 
                type="text" 
                placeholder={activeView === 'wiki' ? "搜索指令 (如: tp, fill, execute)..." : "搜索 ID 或 译名 (如: diamond, 僵尸)..."} 
                className="w-full bg-black/60 border-2 border-gray-800 py-3 pl-10 pr-4 text-white rounded-md focus:border-green-600 outline-none transition-colors"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {activeView === 'wiki' ? (
            <div className="space-y-4">
               {filteredCommands.length > 0 ? filteredCommands.map(cmd => {
                const det = cmd.details[edition]!;
                return (
                  <div key={cmd.name} className="command-card p-6 rounded-xl flex flex-col gap-4 border-l-8 border-l-green-600 group hover:shadow-2xl hover:shadow-green-900/10 transition-all">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 bg-green-900/40 text-green-400 text-[10px] font-bold rounded uppercase border border-green-800">{cmd.category}</span>
                        <h3 className="text-2xl font-black text-white group-hover:text-green-400 transition-colors">/{cmd.name}</h3>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(det.syntax)} 
                        className="text-xs text-gray-500 hover:text-white bg-white/5 px-3 py-1.5 rounded-full border border-gray-800 hover:border-green-500 transition-all"
                      >
                        复制语法
                      </button>
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{cmd.description}</p>
                    <div className="bg-black/60 p-4 rounded-lg border-2 border-gray-900 font-mono relative overflow-hidden">
                      <div className="text-[10px] text-gray-600 mb-2 uppercase tracking-widest font-bold">命令格式</div>
                      <code className="text-yellow-500 text-base block overflow-x-auto whitespace-nowrap scrollbar-hide">{det.syntax}</code>
                    </div>
                    <div className="flex flex-wrap gap-4 text-[11px]">
                      {det.versionRange && <span className="text-gray-500"><b className="text-gray-400">适用版本:</b> {det.versionRange}</span>}
                      {det.permission !== undefined && <span className="text-gray-500"><b className="text-gray-400">权限等级:</b> {det.permission}级</span>}
                      {det.note && <span className="text-blue-400 italic">💡 {det.note}</span>}
                    </div>
                  </div>
                );
               }) : (
                 <div className="mc-panel p-20 text-center opacity-40">
                    <span className="text-6xl block mb-4">📭</span>
                    <p className="mc-font text-2xl">未发现相关指令</p>
                 </div>
               )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between px-2">
                <h2 className="mc-font text-3xl text-blue-400">{selectedIDCategory} 库 <span className="text-sm text-gray-600 ml-2 font-sans tracking-normal">(共 {filteredIDs.length} 项)</span></h2>
                {isLoadingIDs && <div className="flex items-center gap-2 text-xs text-blue-500 animate-pulse font-bold">同步中...</div>}
              </div>

              {fetchError && (
                <div className="p-4 bg-red-900/20 border-2 border-red-900 text-red-400 rounded-lg text-xs flex items-center gap-3">
                  <span className="text-xl">⚠️</span> {fetchError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredIDs.length > 0 ? filteredIDs.slice(0, 300).map((item, idx) => (
                  <div key={idx} className="command-card p-4 rounded-lg group border-l-4 border-l-blue-600 hover:bg-blue-900/5">
                    <div className="flex flex-col gap-1">
                      <div className="text-[9px] text-gray-600 uppercase font-black tracking-widest">{item.namespace}:</div>
                      <h4 className="text-white font-bold text-sm truncate group-hover:text-blue-400 transition-colors">{item.name}</h4>
                      <code className="text-[11px] text-yellow-600/80 bg-transparent p-0 mt-1">{item.id}</code>
                    </div>
                    <button 
                      onClick={() => copyToClipboard(item.id)}
                      className="mt-3 w-full py-1 text-[10px] text-gray-500 border border-gray-800 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                    >
                      复制 ID
                    </button>
                  </div>
                )) : !isLoadingIDs && (
                  <div className="col-span-full mc-panel p-20 text-center opacity-30">
                     <p className="mc-font text-xl">暂无数据</p>
                  </div>
                )}
                {filteredIDs.length > 300 && (
                  <div className="col-span-full py-8 text-center text-gray-600 text-xs border-t border-gray-800">
                    ... 已精简展示，请通过搜索寻找特定 ID ...
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="max-w-7xl mx-auto mt-20 pt-10 border-t border-gray-800 pb-16 text-center">
        <div className="mc-font text-3xl text-gray-600 mb-2">MC COMMAND MASTER v2.0</div>
        <p className="text-xs text-gray-700 uppercase tracking-[0.4em] font-black">
          Powered by Gemini 3.0 & PrismarineJS Data
        </p>
      </footer>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
