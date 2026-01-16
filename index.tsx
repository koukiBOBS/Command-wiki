import { GoogleGenAI } from '@google/genai';

// --- 数据定义 ---
type Edition = 'Java' | 'Bedrock' | 'Education' | 'NetEase';
type ViewMode = 'wiki' | 'ids';

const VERSIONS: Record<Edition, { label: string; value: string }[]> = {
    Java: [{ label: '1.21', value: 'pc/1.21' }, { label: '1.20.1', value: 'pc/1.20.1' }, { label: '1.12.2', value: 'pc/1.12.2' }],
    Bedrock: [{ label: '1.21.0', value: 'bedrock/1.21.0' }, { label: '1.20.0', value: 'bedrock/1.20.0' }],
    Education: [{ label: '1.21.0', value: 'bedrock/1.21.0' }],
    NetEase: [{ label: '1.12.2', value: 'pc/1.12.2' }],
};

const COMMAND_DATA = [
    { name: 'tp', desc: '传送实体。', cat: '基础', syntax: '/tp <目标> <坐标>' },
    { name: 'give', desc: '给予物品。', cat: '物品', syntax: '/give <玩家> <物品> [数量]' },
    { name: 'gamemode', desc: '切换模式。', cat: '基础', syntax: '/gamemode <模式> [玩家]' },
    { name: 'execute', desc: '在指定条件下执行指令。', cat: '技术', syntax: '/execute ... run <指令>' },
    { name: 'ability', desc: '设置玩家能力。', cat: '教育', syntax: '/ability <玩家> <能力> <值>' },
    { name: 'fill', desc: '填充方块。', cat: '建筑', syntax: '/fill <起点> <终点> <方块>' },
    { name: 'summon', desc: '召唤实体。', cat: '基础', syntax: '/summon <实体> [坐标]' }
];

const ID_CATEGORY_MAP: Record<string, string> = {
    '物品/方块': 'items.json',
    '实体/生物': 'entities.json',
    '状态效果': 'effects.json',
    '生物群系': 'biomes.json'
};

// --- 应用状态 ---
const state = {
    view: 'wiki' as ViewMode,
    edition: 'Java' as Edition,
    category: '全部',
    idCategory: '物品/方块',
    versionValue: VERSIONS['Java'][0].value,
    searchQuery: '',
    idData: [] as any[],
    loading: false,
    generating: false
};

// --- 工具函数 ---
const $ = (id: string) => document.getElementById(id);

// --- 初始化入口 ---
function init() {
    renderView();
    renderControls();
    attachGlobalEvents();
}

// --- 事件委托：解决按钮点击不响应的万能药 ---
function attachGlobalEvents() {
    // 监听整个 body 上的点击，通过 data- 属性区分
    document.body.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;

        const type = btn.getAttribute('data-type');
        const value = btn.getAttribute('data-value');

        if (type === 'nav') {
            state.view = value as ViewMode;
            if (state.view === 'ids') fetchIDData();
            renderAll();
        } else if (type === 'platform') {
            state.edition = value as Edition;
            state.versionValue = VERSIONS[state.edition][0].value;
            if (state.view === 'ids') fetchIDData();
            renderAll();
        } else if (type === 'cat-wiki') {
            state.category = value!;
            renderAll();
        } else if (type === 'cat-id') {
            state.idCategory = value!;
            fetchIDData();
            renderAll();
        }
    });

    // 搜索框
    $('search-bar')?.addEventListener('input', (e) => {
        state.searchQuery = (e.target as HTMLInputElement).value;
        renderView();
    });

    // AI 提问
    $('ask-ai-btn')?.addEventListener('click', handleAI);
}

// --- 全量刷新 UI ---
function renderAll() {
    renderControls();
    renderView();
}

// --- 渲染侧边栏动态控件 ---
function renderControls() {
    const container = $('dynamic-controls-container');
    const navGroup = $('nav-group');
    const platformGroup = $('platform-group');
    if (!container || !navGroup || !platformGroup) return;

    // 更新导航高亮
    navGroup.querySelectorAll('button').forEach(b => 
        b.classList.toggle('active-status', b.getAttribute('data-value') === state.view));

    // 更新平台高亮
    platformGroup.querySelectorAll('button').forEach(b => 
        b.classList.toggle('active-status', b.getAttribute('data-value') === state.edition));

    container.innerHTML = '';

    if (state.view === 'wiki') {
        const label = document.createElement('label');
        label.className = 'text-[10px] text-gray-500 block mb-2 mt-4 uppercase font-black tracking-[0.2em]';
        label.textContent = '指令分类';
        container.appendChild(label);

        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-2';
        ['全部', '基础', '物品', '技术', '建筑', '教育'].forEach(c => {
            const btn = document.createElement('button');
            btn.className = `mc-button ${state.category === c ? 'active-status' : ''}`;
            btn.setAttribute('data-type', 'cat-wiki');
            btn.setAttribute('data-value', c);
            btn.textContent = c;
            grid.appendChild(btn);
        });
        container.appendChild(grid);
    } else {
        const vLabel = document.createElement('label');
        vLabel.className = 'text-[10px] text-gray-500 block mb-2 mt-4 uppercase font-black tracking-[0.2em]';
        vLabel.textContent = '数据库版本';
        container.appendChild(vLabel);

        const select = document.createElement('select');
        select.className = 'w-full bg-black border-2 border-gray-800 p-2 text-white text-xs mb-4 outline-none';
        VERSIONS[state.edition].forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.value;
            opt.textContent = v.label;
            opt.selected = state.versionValue === v.value;
            select.appendChild(opt);
        });
        select.onchange = (e) => {
            state.versionValue = (e.target as HTMLSelectElement).value;
            fetchIDData();
        };
        container.appendChild(select);

        const cLabel = document.createElement('label');
        cLabel.className = 'text-[10px] text-gray-500 block mb-2 uppercase font-black tracking-[0.2em]';
        cLabel.textContent = '库分类';
        container.appendChild(cLabel);

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-1';
        Object.keys(ID_CATEGORY_MAP).forEach(c => {
            const btn = document.createElement('button');
            btn.className = `mc-button ${state.idCategory === c ? 'active-status' : ''}`;
            btn.setAttribute('data-type', 'cat-id');
            btn.setAttribute('data-value', c);
            btn.textContent = c;
            list.appendChild(btn);
        });
        container.appendChild(list);
    }
}

// --- 核心渲染主区域 ---
function renderView() {
    const mount = $('content-mount');
    const title = $('view-title');
    const indicator = $('status-indicator');
    if (!mount || !title) return;

    mount.innerHTML = '';
    indicator?.classList.toggle('hidden', !state.loading);

    if (state.view === 'wiki') {
        title.textContent = `${state.edition} 指令百科`;
        const filtered = COMMAND_DATA.filter(c => {
            const matchesSearch = c.name.includes(state.searchQuery.toLowerCase()) || c.desc.includes(state.searchQuery);
            const matchesCat = state.category === '全部' || c.cat === state.category;
            return matchesSearch && matchesCat;
        });

        if (filtered.length === 0) {
            mount.innerHTML = `<div class="mc-panel p-16 text-center opacity-40 mc-font text-2xl">无匹配指令</div>`;
        } else {
            filtered.forEach(c => {
                const card = document.createElement('div');
                card.className = 'command-card p-5 rounded-lg border-l-4 border-l-green-600 group';
                card.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] px-1 bg-green-900/50 text-green-400 border border-green-800 font-bold">${c.cat}</span>
                            <h4 class="text-xl font-bold text-white">/${c.name}</h4>
                        </div>
                        <button class="text-[10px] text-gray-600 hover:text-white" onclick="navigator.clipboard.writeText('${c.syntax}')">复制语法</button>
                    </div>
                    <p class="text-gray-400 text-sm mb-3">${c.desc}</p>
                    <div class="bg-black/80 p-3 font-mono text-yellow-500 text-xs border border-gray-900 rounded">${c.syntax}</div>
                `;
                mount.appendChild(card);
            });
        }
    } else {
        title.textContent = `${state.idCategory} - ${state.edition}`;
        if (state.loading) {
            mount.innerHTML = `<div class="p-20 text-center animate-pulse mc-font text-xl">正在同步全球数据库...</div>`;
            return;
        }

        const filtered = state.idData.filter(i => 
            i.id.toLowerCase().includes(state.searchQuery.toLowerCase()) || 
            i.name.toLowerCase().includes(state.searchQuery.toLowerCase())
        );

        if (filtered.length === 0) {
            mount.innerHTML = `<div class="mc-panel p-16 text-center opacity-40 mc-font text-2xl">未找到相关 ID</div>`;
        } else {
            const grid = document.createElement('div');
            grid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3';
            filtered.slice(0, 300).forEach(i => {
                const item = document.createElement('div');
                item.className = 'command-card p-3 border-l-4 border-l-blue-600 cursor-pointer hover:bg-blue-900/10';
                item.innerHTML = `
                    <div class="text-[8px] text-gray-600 uppercase mb-1">minecraft:</div>
                    <div class="text-white font-bold text-sm truncate">${i.name}</div>
                    <code class="text-[10px] text-yellow-600 block mt-1">${i.id}</code>
                `;
                item.onclick = () => navigator.clipboard.writeText(i.id);
                grid.appendChild(item);
            });
            mount.appendChild(grid);
        }
    }
}

// --- 数据拉取 ---
async function fetchIDData() {
    state.loading = true;
    renderView();
    
    const file = ID_CATEGORY_MAP[state.idCategory];
    const url = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/${state.versionValue}/${file}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const raw = await res.json();
        state.idData = raw.map((i: any) => ({
            id: i.name,
            name: i.displayName || i.name
        }));
    } catch {
        state.idData = [];
        $('error-display')!.textContent = '无法从源镜像同步 ID 数据库。请检查网络。';
        $('error-display')!.classList.remove('hidden');
    } finally {
        state.loading = false;
        renderView();
    }
}

// --- AI 逻辑 ---
async function handleAI() {
    const input = ($('ai-input') as HTMLTextAreaElement).value.trim();
    if (!input || state.generating) return;

    state.generating = true;
    const btn = $('ask-ai-btn')!;
    const res = $('ai-response')!;
    
    btn.textContent = '大师正在思考...';
    res.classList.remove('hidden');
    res.textContent = '正在撰写详细回复...';

    try {
        // 安全检测 API Key
        let key = '';
        try { key = process.env.API_KEY || ''; } catch {}

        if (!key) {
            res.textContent = 'AI 专家目前无法连接（API 密钥未配置）。请先在 AI Studio 环境下运行。';
            return;
        }

        const ai = new GoogleGenAI({ apiKey: key });
        const result = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `你是一位全版本 Minecraft 指令大师。版本：${state.edition}。用户问题：${input}。请用专业简练的中文回答。`
        });
        res.textContent = result.text || '大师保持了沉默。';
    } catch (e) {
        res.textContent = '召唤专家失败，请稍后重试。';
    } finally {
        state.generating = false;
        btn.textContent = '提交问题';
    }
}

// 启动应用
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}