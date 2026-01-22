import React, { useState, useEffect, useRef } from 'react';
import { GameMode, ChatMode, Character, UserState, N3GrammarTopic, CharacterId, Message, CustomAssets, DialoguePage, WordReading, QuizData, CollectedWord, Language } from './types';
import { CHARACTERS, SCENE_MAP, DEFAULT_SCENE, UI_TEXT } from './constants';
import { startChat, sendMessage, translateText } from './services/geminiService';
import CharacterSprite from './components/CharacterSprite';
import DialogueBox from './components/DialogueBox';

const SAVE_SLOT_PREFIX = 'kobe_study_save_v5_slot_';
const API_KEY_STORAGE_KEY = 'kobe_study_user_api_key';
const MODEL_STORAGE_KEY = 'kobe_study_user_model'; // 🔥 存储模型的 key
const MAX_SLOTS = 6;

// 🤖 可选模型列表
const AVAILABLE_MODELS = [
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (推荐/快速/免费)' },
  { value: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (更聪明/较慢)' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (新版/不稳定)' },
];

const App: React.FC = () => {
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SETUP);
  const [setupStep, setSetupStep] = useState<'MENU' | 'NEW_GAME'>('MENU');

  const [userState, setUserState] = useState<UserState>({
    learningGoal: '',
    grammarTopic: N3GrammarTopic.GENERAL,
    playerName: 'Gakusei',
    collectedWords: [],
    language: 'zh'
  });
  
  const [customAssets, setCustomAssets] = useState<CustomAssets>({
    backgroundImage: null,
    characters: {
      [CharacterId.ASUKA]: null,
      [CharacterId.HIKARI]: null,
      [CharacterId.REI]: null,
      [CharacterId.REN]: null,
      [CharacterId.HAKU]: null,
    }
  });

  const [selectedCharId, setSelectedCharId] = useState<CharacterId | null>(null);
  const [lobbySelectedChar, setLobbySelectedChar] = useState<CharacterId | null>(null);
  const [chatMode, setChatMode] = useState<ChatMode>(ChatMode.FREE_TALK);
  
  const [visibleLobbyChars, setVisibleLobbyChars] = useState<Set<CharacterId>>(new Set());
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatHistories, setChatHistories] = useState<Record<CharacterId, Message[]>>({
    [CharacterId.ASUKA]: [],
    [CharacterId.HIKARI]: [],
    [CharacterId.REI]: [],
    [CharacterId.REN]: [],
    [CharacterId.HAKU]: [],
  });

  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentQuiz, setCurrentQuiz] = useState<QuizData | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [isLastAnswerCorrect, setIsLastAnswerCorrect] = useState<boolean | null>(null);
  const [isDialogueFinished, setIsDialogueFinished] = useState(false);
  
  const [showSystemMenu, setShowSystemMenu] = useState(false);
  const [showHistoryLog, setShowHistoryLog] = useState(false);
  const [showWordbook, setShowWordbook] = useState(false);
  const [saveLoadMode, setSaveLoadMode] = useState<'SAVE' | 'LOAD' | null>(null);
  
  const [activeHistoryTab, setActiveHistoryTab] = useState<CharacterId>(CharacterId.ASUKA);
  const [hasAnySave, setHasAnySave] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, text: string } | null>(null);
  const [translationResult, setTranslationResult] = useState<{ original: string, translation: string } | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  
  const [currentOutfit, setCurrentOutfit] = useState<string>('');
  const [currentScene, setCurrentScene] = useState<string>(DEFAULT_SCENE);

  // 🔥 自定义 API Key 和 Model
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('gemini-1.5-flash');

  const bgUrl = SCENE_MAP[currentScene] || SCENE_MAP[DEFAULT_SCENE];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const T = UI_TEXT[userState.language];

  // 🔥 初始化加载 Key 和 Model
  useEffect(() => {
    checkForSaves();
    const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedKey) setCustomApiKey(storedKey);

    const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (storedModel) setCustomModel(storedModel);
  }, []);

  // 🔥 Key 变更处理
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.trim();
      setCustomApiKey(val);
      if (val) localStorage.setItem(API_KEY_STORAGE_KEY, val);
      else localStorage.removeItem(API_KEY_STORAGE_KEY);
  };

  // 🔥 Model 变更处理
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setCustomModel(val);
      localStorage.setItem(MODEL_STORAGE_KEY, val);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, quizFeedback, currentQuiz]);

  useEffect(() => {
    if (showHistoryLog) {
      historyEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [showHistoryLog]);

  useEffect(() => {
    if (selectedCharId) {
      setActiveHistoryTab(selectedCharId);
    }
  }, [selectedCharId]);

  useEffect(() => {
    if (gameMode === GameMode.LOBBY) {
      setVisibleLobbyChars(new Set());
      const ids = Object.keys(CHARACTERS) as CharacterId[];
      const timers: ReturnType<typeof setTimeout>[] = [];

      ids.forEach((id, index) => {
        const timer = setTimeout(() => {
            setVisibleLobbyChars(prev => {
                const next = new Set(prev);
                next.add(id);
                return next;
            });
        }, index * 1000 + 500);
        timers.push(timer);
      });

      return () => {
          timers.forEach(clearTimeout);
      };
    }
  }, [gameMode]);

  const checkForSaves = () => {
    let found = false;
    for (let i = 0; i < MAX_SLOTS; i++) {
        if (localStorage.getItem(`${SAVE_SLOT_PREFIX}${i}`)) {
            found = true;
            break;
        }
    }
    setHasAnySave(found);
  };

  const saveGameToSlot = (slotIndex: number) => {
    const timestamp = Date.now();
    const saveData = {
        meta: {
            timestamp,
            playerName: userState.playerName,
            topic: userState.grammarTopic,
            charId: selectedCharId,
            previewText: messages.length > 0 ? messages[messages.length - 1].text.substring(0, 30) + '...' : 'No messages'
        },
        data: {
            userState,
            gameMode,
            selectedCharId,
            chatMode,
            messages,
            chatHistories,
            customAssets
        }
    };
    localStorage.setItem(`${SAVE_SLOT_PREFIX}${slotIndex}`, JSON.stringify(saveData));
    checkForSaves();
    setSaveLoadMode(null);
    setShowSystemMenu(false);
    alert(`${T.gameSaved} (Slot ${slotIndex + 1})`);
  };

  const loadGameFromSlot = async (slotIndex: number) => {
    const saved = localStorage.getItem(`${SAVE_SLOT_PREFIX}${slotIndex}`);
    if (!saved) return;

    try {
        const fullData = JSON.parse(saved);
        const data = fullData.data;

        setUserState(prev => ({
            ...prev,
            ...data.userState,
            language: data.userState.language || 'zh'
        }));
        setCustomAssets(data.customAssets);
        setSelectedCharId(data.selectedCharId);
        setChatMode(data.chatMode);
        setMessages(data.messages || []);
        
        setChatHistories({
            [CharacterId.ASUKA]: [],
            [CharacterId.HIKARI]: [],
            [CharacterId.REI]: [],
            [CharacterId.REN]: [],
            [CharacterId.HAKU]: [],
            ...(data.chatHistories || {})
        });
        
        setGameMode(data.gameMode);
        setSaveLoadMode(null);
        setShowSystemMenu(false);
        setSetupStep('MENU');
        
        if (data.gameMode === GameMode.CHAT && data.selectedCharId) {
            setIsLoading(true);
            try {
                await startChat(
                    CHARACTERS[data.selectedCharId as CharacterId], 
                    data.chatMode, 
                    data.userState.learningGoal, 
                    data.userState.grammarTopic,
                    data.userState.language || 'zh',
                    customApiKey, 
                    customModel, // 🔥 传入模型
                    data.messages
                );
                setIsDialogueFinished(true);
            } catch (e) {
                console.error("Session restore failed", e);
            } finally {
                setIsLoading(false);
            }
        }
    } catch (e) {
        console.error("Load failed", e);
        alert("Failed to load save file.");
    }
  };

  const handleSetupComplete = (name: string, goal: string, topic: N3GrammarTopic) => {
    setUserState(prev => ({ ...prev, playerName: name, learningGoal: goal, grammarTopic: topic }));
    setGameMode(GameMode.LOBBY);
  };

  const enterChat = async (charId: CharacterId, mode: ChatMode) => {
    setSelectedCharId(charId);
    setLobbySelectedChar(null);
    setChatMode(mode);
    setGameMode(GameMode.CHAT);
    setMessages([]); 
    setIsLoading(true);
    setQuizFeedback(null);
    setCurrentQuiz(null);
    setIsDialogueFinished(false);
    setCurrentEmotion('neutral');
    setCurrentOutfit(''); 
    setCurrentScene(DEFAULT_SCENE);

    try {
      const result = await startChat(
          CHARACTERS[charId], 
          mode, 
          userState.learningGoal, 
          userState.grammarTopic,
          userState.language,
          customApiKey,
          customModel // 🔥 传入模型
      );
      const greetingMsg: Message = { 
        id: 'init-' + Date.now(), 
        role: 'model', 
        text: result.pages.map(p => p.text).join(' '), 
        pages: result.pages,
        vocabulary: result.vocabulary,
        emotion: result.emotion,
        outfit: result.outfit,
        location: result.location,
        senderName: CHARACTERS[charId].name
      };
      
      setMessages([greetingMsg]);
      setCurrentEmotion(result.emotion || 'neutral');
      if (result.outfit) setCurrentOutfit(result.outfit);
      if (result.location && SCENE_MAP[result.location]) setCurrentScene(result.location);
      
      setChatHistories(prev => ({
        ...prev,
        [charId]: [...prev[charId], greetingMsg]
      }));

    } catch (error: any) {
      setMessages([{ id: 'err', role: 'model', text: `${T.connectionError}: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    if (!selectedCharId || (isLoading && !customPrompt)) return;
    if (!customPrompt && !inputText.trim()) return;

    const isInternalTrigger = !!customPrompt;
    
    if (!isInternalTrigger) {
      const userMsg: Message = { 
          id: Date.now().toString(), 
          role: 'user', 
          text: inputText,
          senderName: userState.playerName 
      };
      
      setMessages(prev => [...prev, userMsg]);
      setChatHistories(prev => ({
          ...prev,
          [selectedCharId]: [...prev[selectedCharId], userMsg]
      }));
    }

    const currentInput = customPrompt || inputText;
    setInputText('');
    setIsLoading(true);
    setQuizFeedback(null);
    setIsDialogueFinished(false);
    setCurrentQuiz(null);

    try {
      const response = await sendMessage(currentInput, false);
      const modelMsg: Message = { 
        id: (Date.now() + 1).toString(), 
        role: 'model', 
        text: response.pages.map(p => p.text).join(' '),
        pages: response.pages,
        vocabulary: response.vocabulary,
        quiz: response.quiz,
        emotion: response.emotion,
        outfit: response.outfit,
        location: response.location,
        senderName: CHARACTERS[selectedCharId].name
      };

      setMessages(prev => [...prev, modelMsg]);
      setCurrentEmotion(response.emotion || 'neutral');
      if (response.outfit !== undefined) setCurrentOutfit(response.outfit);
      if (response.location && SCENE_MAP[response.location]) setCurrentScene(response.location);
      
      setChatHistories(prev => ({
        ...prev,
        [selectedCharId]: [...prev[selectedCharId], modelMsg]
      }));

    } catch (error: any) {
      setMessages(prev => [...prev, { id: 'err', role: 'model', text: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const onDialogueFinished = () => {
    setIsDialogueFinished(true);
    const lastMsg = messages[messages.length - 1];
    if (chatMode === ChatMode.STUDY && lastMsg?.role === 'model' && lastMsg.quiz && lastMsg.quiz.question && lastMsg.quiz.options?.length > 0) {
      setCurrentQuiz(lastMsg.quiz);
    }
  };

  const handleQuizAnswer = (index: number) => {
    if (!currentQuiz) return;
    const isCorrect = index === currentQuiz.correctIndex;
    setIsLastAnswerCorrect(isCorrect);
    const feedbackText = isCorrect 
      ? `✅ ${currentQuiz.explanation}` 
      : `❌ ${currentQuiz.options[currentQuiz.correctIndex]}... ${currentQuiz.explanation}`;
    setQuizFeedback(feedbackText);
    setCurrentQuiz(null); 
  };

  const handleContinueAfterFeedback = () => {
    setQuizFeedback(null);
    const wasCorrect = isLastAnswerCorrect;
    setIsLastAnswerCorrect(null);
    const prompt = wasCorrect ? T.feedbackCorrect : T.feedbackWrong;
    handleSendMessage(prompt);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const selection = window.getSelection()?.toString().trim();
    if (selection) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, text: selection });
    } else {
      setContextMenu(null);
    }
  };

  const handleTranslateSelection = async () => {
    if (!contextMenu) return;
    const text = contextMenu.text;
    setContextMenu(null);
    setIsTranslating(true);
    try {
        const translation = await translateText(text, userState.language, customApiKey, customModel); // 🔥 传入模型
        setTranslationResult({ original: text, translation });
    } finally {
        setIsTranslating(false);
    }
  };

  const handleCollectSelection = async () => {
    if (!contextMenu) return;
    const text = contextMenu.text;
    setContextMenu(null);
    setIsTranslating(true);
    try {
        const translation = await translateText(text, userState.language, customApiKey, customModel); // 🔥 传入模型
        const newWord: CollectedWord = {
            id: Date.now().toString(),
            original: text,
            translation: translation,
            timestamp: Date.now()
        };
        setUserState(prev => ({
            ...prev,
            collectedWords: [newWord, ...prev.collectedWords]
        }));
    } finally {
        setIsTranslating(false);
    }
  };

  const removeCollectedWord = (id: string) => setUserState(prev => ({ ...prev, collectedWords: prev.collectedWords.filter(w => w.id !== id) }));
  
  const handleWordAction = (index: number, action: 'up' | 'down' | 'top') => {
    setUserState(prev => {
      const words = [...prev.collectedWords];
      if (action === 'top') { const [item] = words.splice(index, 1); words.unshift(item); }
      else if (action === 'up' && index > 0) [words[index - 1], words[index]] = [words[index], words[index - 1]];
      else if (action === 'down' && index < words.length - 1) [words[index + 1], words[index]] = [words[index], words[index + 1]];
      return { ...prev, collectedWords: words };
    });
  };

  const getDynamicAvatar = (char: Character): Character => {
    const baseEmotion = currentEmotion || 'neutral';
    const outfitKey = currentOutfit ? `${currentOutfit}_${baseEmotion}` : baseEmotion;
    if (char.emotionMap && char.emotionMap[outfitKey]) return { ...char, avatarUrl: char.emotionMap[outfitKey] };
    const fallbackOutfitKey = currentOutfit ? `${currentOutfit}_neutral` : 'neutral';
    if (currentOutfit && char.emotionMap && char.emotionMap[fallbackOutfitKey]) return { ...char, avatarUrl: char.emotionMap[fallbackOutfitKey] };
    if (char.emotionMap && char.emotionMap[baseEmotion]) return { ...char, avatarUrl: char.emotionMap[baseEmotion] };
    return char;
  };

  const renderBackground = () => (
     <div className="absolute inset-0 w-full h-full z-0 bg-gray-900 select-none overflow-hidden">
         <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 to-black z-0"></div>
         <img 
            key={bgUrl}
            src={customAssets.backgroundImage || bgUrl} 
            alt="Background" 
            loading="eager" decoding="async"
            className="absolute inset-0 w-full h-full object-cover opacity-60 z-10 scale-105 transition-all duration-1000 ease-in-out"
            style={{ animation: 'breathe 20s ease-in-out infinite' }}
        />
         <div className="absolute inset-0 bg-black/30 z-20 pointer-events-none" />
         <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')] opacity-10 pointer-events-none mix-blend-overlay"></div>
     </div>
  );

  const renderSetup = () => {
    return (
        <div className="min-h-screen relative overflow-hidden font-sans select-none flex items-center justify-center">
            {renderBackground()}
            <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-4">
                <div className={`transition-all duration-700 transform ease-in-out ${setupStep === 'MENU' ? 'scale-100 translate-y-0' : 'scale-75 -translate-y-[20vh] opacity-50'}`}>
                     <div className="relative group">
                        <div className="absolute -inset-6 bg-red-600 transform -skew-x-12 blur-sm opacity-80 group-hover:scale-110 transition-transform duration-500"></div>
                        <div className="absolute -inset-2 bg-black transform skew-x-12 opacity-80"></div>
                        <h1 className="relative text-7xl md:text-9xl font-black italic tracking-tighter text-white drop-shadow-[5px_5px_0px_rgba(0,0,0,1)] transform -skew-x-6 select-none" style={{textShadow: '8px 8px 0px #000'}}>
                            KOBE<br/><span className="text-yellow-400">STUDY</span>
                        </h1>
                        <p className="absolute bottom-2 -right-4 bg-white text-black text-xs font-black px-4 py-1 transform skew-x-12 tracking-[0.5em] shadow-[4px_4px_0px_#000]">N3 RESEARCH</p>
                     </div>
                </div>

                {setupStep === 'MENU' && (
                    <div className="mt-20 flex flex-col gap-6 items-center w-full max-w-md animate-in fade-in slide-in-from-bottom-10 duration-500">
                        <div className="flex gap-4 mb-4">
                            <button onClick={() => setUserState(p => ({...p, language: 'zh'}))} className={`px-4 py-2 font-black transform -skew-x-12 border-2 ${userState.language === 'zh' ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-black text-white border-white/30 hover:border-white'}`}>中文</button>
                            <button onClick={() => setUserState(p => ({...p, language: 'en'}))} className={`px-4 py-2 font-black transform -skew-x-12 border-2 ${userState.language === 'en' ? 'bg-yellow-400 text-black border-yellow-400' : 'bg-black text-white border-white/30 hover:border-white'}`}>ENGLISH</button>
                        </div>
                        <button onClick={() => setSaveLoadMode('LOAD')} disabled={!hasAnySave} className="group relative w-full h-24 bg-black border-4 border-white transform -skew-x-12 hover:bg-yellow-400 hover:border-black transition-all duration-300 shadow-[15px_15px_0px_rgba(0,0,0,0.5)] active:translate-y-2 active:shadow-none hover:-translate-y-1 disabled:opacity-30 disabled:hover:bg-black disabled:hover:border-white">
                            <span className="absolute inset-0 flex items-center justify-center transform skew-x-12 text-4xl font-black italic tracking-widest text-white group-hover:text-black transition-colors">{T.continue}</span>
                        </button>
                        <button onClick={() => setSetupStep('NEW_GAME')} className="group relative w-full h-24 bg-red-600 border-4 border-black transform -skew-x-12 hover:bg-black hover:border-red-600 transition-all duration-300 shadow-[15px_15px_0px_rgba(0,0,0,0.5)] active:translate-y-2 active:shadow-none hover:-translate-y-1">
                            <span className="absolute inset-0 flex items-center justify-center transform skew-x-12 text-4xl font-black italic tracking-widest text-white group-hover:text-red-500 transition-colors">{T.newSession}</span>
                        </button>
                    </div>
                )}

                {setupStep === 'NEW_GAME' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in zoom-in-95 duration-300 p-4">
                        <div className="relative w-full max-w-3xl bg-black border-4 border-white transform -skew-x-2 p-10 md:p-14 shadow-[20px_20px_0px_rgba(215,38,56,1)] overflow-y-auto max-h-screen">
                            <button onClick={() => setSetupStep('MENU')} className="absolute -top-8 -left-8 bg-yellow-400 text-black w-16 h-16 flex items-center justify-center font-black text-2xl border-4 border-black hover:bg-white hover:scale-110 transition-all z-50 transform skew-x-2 shadow-xl">✕</button>
                            <h2 className="text-4xl md:text-5xl font-black text-white italic mb-10 border-b-8 border-red-600 pb-4 tracking-tighter uppercase transform skew-x-2 flex items-baseline gap-4"><span className="text-red-600 text-6xl">01</span> {T.registration}</h2>

                            <div className="space-y-8 transform skew-x-2">
                                <div className="group relative">
                                    <label className="absolute -top-4 -left-2 bg-white text-black px-4 py-1 font-black text-sm uppercase transform -skew-x-12 border-2 border-black group-focus-within:bg-red-500 group-focus-within:text-white transition-colors z-20">{T.codeName}</label>
                                    <input type="text" value={userState.playerName} onChange={(e) => setUserState(prev => ({...prev, playerName: e.target.value}))} className="w-full bg-zinc-900 border-4 border-white/20 text-white text-2xl px-6 py-5 font-bold focus:border-yellow-400 focus:bg-zinc-800 outline-none transition-all placeholder-white/10 shadow-inner" placeholder={T.enterName} />
                                </div>
                                <div className="group relative">
                                    <label className="absolute -top-4 -left-2 bg-white text-black px-4 py-1 font-black text-sm uppercase transform -skew-x-12 border-2 border-black group-focus-within:bg-blue-500 group-focus-within:text-white transition-colors z-20">{T.targetGrammar}</label>
                                    <div className="relative">
                                        <select value={userState.grammarTopic} onChange={(e) => setUserState(prev => ({...prev, grammarTopic: e.target.value as N3GrammarTopic}))} className="w-full bg-zinc-900 border-4 border-white/20 text-white text-xl px-6 py-5 font-bold focus:border-yellow-400 focus:bg-zinc-800 outline-none transition-all appearance-none cursor-pointer hover:bg-zinc-800 shadow-inner">
                                            {Object.values(N3GrammarTopic).map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white text-xs">▼</div>
                                    </div>
                                </div>
                                <div className="group relative">
                                    <label className="absolute -top-4 -left-2 bg-white text-black px-4 py-1 font-black text-sm uppercase transform -skew-x-12 border-2 border-black group-focus-within:bg-yellow-400 group-focus-within:text-black transition-colors z-20">{T.missionObj}</label>
                                    <input type="text" value={userState.learningGoal} onChange={(e) => setUserState(prev => ({...prev, learningGoal: e.target.value}))} className="w-full bg-zinc-900 border-4 border-white/20 text-white text-xl px-6 py-5 font-bold focus:border-yellow-400 focus:bg-zinc-800 outline-none transition-all placeholder-white/10 shadow-inner" placeholder={T.enterGoal} />
                                </div>

                                {/* 🔥 Google API Key & Model Settings */}
                                <div className="border-t-2 border-white/10 pt-6 mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="group relative">
                                        <label className="absolute -top-2 -left-2 bg-zinc-800 text-gray-400 px-4 py-1 font-bold text-xs uppercase transform -skew-x-12 border border-gray-600 z-20">API Key (Optional)</label>
                                        <input type="password" value={customApiKey} onChange={handleApiKeyChange} className="w-full bg-black/50 border-2 border-white/10 text-yellow-400 text-sm px-6 py-4 font-mono focus:border-yellow-400 outline-none transition-all placeholder-white/10 shadow-inner" placeholder="AIzaSy..." />
                                    </div>
                                    <div className="group relative">
                                        <label className="absolute -top-2 -left-2 bg-zinc-800 text-gray-400 px-4 py-1 font-bold text-xs uppercase transform -skew-x-12 border border-gray-600 z-20">Model Select</label>
                                        <select value={customModel} onChange={handleModelChange} className="w-full bg-black/50 border-2 border-white/10 text-yellow-400 text-sm px-6 py-4 font-mono focus:border-yellow-400 outline-none transition-all shadow-inner appearance-none cursor-pointer">
                                            {AVAILABLE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </div>
                                    <p className="col-span-full text-[10px] text-gray-500 ml-1">* Use 'Gemini 1.5 Flash' for best free experience.</p>
                                </div>
                            </div>

                            <div className="mt-12 flex justify-end transform skew-x-2">
                                <button onClick={() => handleSetupComplete(userState.playerName, userState.learningGoal, userState.grammarTopic)} disabled={!userState.learningGoal.trim() || !userState.playerName.trim()} className="relative overflow-hidden bg-red-600 hover:bg-white hover:text-red-600 text-white font-black text-2xl py-6 px-16 uppercase tracking-widest transition-all shadow-[10px_10px_0px_#000] border-4 border-transparent hover:border-red-600 disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-1 active:shadow-none group">
                                    <span className="relative z-10">{T.startMission}</span>
                                    <div className="absolute inset-0 bg-white transform translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300 ease-out z-0"></div>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
  };

  const renderLobby = () => (
    <div className="relative w-full h-screen overflow-hidden flex flex-col">
      {renderBackground()}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-40 pointer-events-none">
         <div className="bg-black/80 backdrop-blur text-white px-8 py-4 border-l-4 border-yellow-500 skew-x-12 transform origin-top-left pointer-events-auto shadow-2xl">
             <h2 className="-skew-x-12 text-2xl font-black italic uppercase tracking-tighter">{T.choosePartner}</h2>
             <p className="-skew-x-12 text-yellow-500 text-xs font-bold uppercase tracking-widest">{T.goal}: {userState.learningGoal}</p>
         </div>
         <div className="flex gap-2 pointer-events-auto">
            <button onClick={() => setShowWordbook(true)} className="bg-yellow-600/80 hover:bg-yellow-600 text-gray-900 px-4 py-2 rounded-sm border border-white/20 backdrop-blur text-[10px] font-black uppercase tracking-tighter shadow-xl">{T.wordbook} ({userState.collectedWords.length})</button>
            <button onClick={() => setShowHistoryLog(true)} className="bg-indigo-600/80 hover:bg-indigo-600 text-white px-4 py-2 rounded-sm border border-white/20 backdrop-blur text-[10px] font-black uppercase tracking-tighter shadow-xl">{T.logs}</button>
            <button onClick={() => setShowSystemMenu(true)} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-sm border border-white/20 backdrop-blur text-[10px] font-black uppercase tracking-tighter">{T.system}</button>
         </div>
      </div>

      <div className="flex-1 flex flex-row items-stretch w-full h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory md:snap-none md:overflow-hidden z-20 pt-20 pb-0">
          {(Object.keys(CHARACTERS) as CharacterId[]).map((id, index) => {
              const char = CHARACTERS[id];
              const shouldLoad = visibleLobbyChars.has(id);
              const displayChar = { ...char, avatarUrl: customAssets.characters[id] || (shouldLoad ? char.avatarUrl : '') };
              return (
                  <div key={id} className={`group relative flex-none w-[85vw] snap-center md:flex-1 h-full border-r border-white/5 overflow-hidden cursor-pointer bg-black/40 transition-opacity duration-300`} onClick={() => setLobbySelectedChar(id)}>
                        <div className={`absolute inset-0 opacity-0 md:group-hover:opacity-20 transition-opacity duration-300 ${char.color} bg-gradient-to-t from-black via-transparent to-transparent`}></div>
                        <div className="absolute top-4 right-4 text-[100px] font-black text-white/5 italic leading-none select-none z-0">0{index + 1}</div>
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-[90%] md:h-[95%] flex items-end justify-center origin-bottom">
                            <CharacterSprite character={displayChar} isSpeaking={false} className="w-full h-full object-contain"/>
                        </div>
                        <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-20 pb-10 px-6 flex flex-col items-center md:items-start md:opacity-60 md:group-hover:opacity-100 transition-opacity duration-300">
                             <div className={`h-1 w-12 mb-2 ${char.color}`}></div>
                             <h3 className="text-3xl md:text-4xl font-black text-white italic uppercase tracking-tighter drop-shadow-lg">{userState.language === 'en' ? char.nameEn : char.name}</h3>
                             <p className="text-[10px] text-white/70 uppercase tracking-widest hidden md:block">{userState.language === 'en' ? char.roleEn : char.role}</p>
                        </div>
                  </div>
              )
          })}
      </div>

      {lobbySelectedChar && (
          <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setLobbySelectedChar(null)}>
              <div className="bg-slate-900 border-2 border-white/10 p-10 rounded-sm max-w-lg w-full flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(0,0,0,1)] relative overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className={`absolute top-0 left-0 w-full h-1 ${CHARACTERS[lobbySelectedChar].color}`} />
                  <h2 className={`text-4xl font-black italic tracking-tighter text-white drop-shadow-md`}>{userState.language === 'en' ? CHARACTERS[lobbySelectedChar].nameEn : CHARACTERS[lobbySelectedChar].name}</h2>
                  <p className="text-gray-300 text-center text-sm leading-relaxed px-4">{userState.language === 'en' ? CHARACTERS[lobbySelectedChar].descriptionEn : CHARACTERS[lobbySelectedChar].description}</p>
                  <div className="flex flex-col w-full gap-4 mt-4">
                      <button onClick={() => enterChat(lobbySelectedChar, ChatMode.FREE_TALK)} className="group relative w-full overflow-hidden bg-indigo-700 hover:bg-indigo-600 text-white font-black py-5 rounded-sm text-sm uppercase tracking-[0.3em] transition-all shadow-xl"><span className="relative z-10 flex items-center justify-center gap-3">💬 {T.casualTalk}</span></button>
                      <button onClick={() => enterChat(lobbySelectedChar, ChatMode.STUDY)} className="group relative w-full overflow-hidden bg-red-700 hover:bg-red-600 text-white font-black py-5 rounded-sm text-sm uppercase tracking-[0.3em] transition-all shadow-xl"><span className="relative z-10 flex items-center justify-center gap-3">📚 {T.reviewMode}</span></button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );

  const renderChat = () => {
      const activeChar = getDynamicAvatar(selectedCharId ? CHARACTERS[selectedCharId] : CHARACTERS[CharacterId.ASUKA]);
      const lastModelMsg = [...messages].reverse().find(m => m.role === 'model');

      return (
        <div className="relative w-full h-screen overflow-hidden flex flex-col" onContextMenu={handleContextMenu} onClick={() => { if(contextMenu) setContextMenu(null); }}>
            <div className="absolute top-1 left-1 z-[200] bg-black/70 text-white text-[10px] p-2 rounded font-mono"><div>outfit: {currentOutfit || '(empty)'}</div><div>emotion: {currentEmotion}</div><div>model: {customModel}</div></div>
            {renderBackground()}
            {isTranslating && <div className="absolute top-20 right-6 z-[60] bg-black/80 text-yellow-500 px-4 py-2 rounded border border-yellow-500/50 flex items-center gap-2 animate-pulse"><span className="text-xs font-bold uppercase tracking-widest">{T.generating}</span></div>}
            
            <div className="absolute top-0 left-0 w-full z-50 p-6 flex justify-between items-start">
                <button onClick={() => setGameMode(GameMode.LOBBY)} className="bg-black/80 px-8 py-2 rounded-sm text-white font-black text-xs border border-white/20 tracking-widest hover:bg-red-700 transition-all shadow-2xl">← {T.exit}</button>
                <div className="flex gap-2">
                    <button onClick={() => setShowWordbook(true)} className="bg-yellow-600/80 px-4 py-2 text-gray-900 font-black text-[10px] border border-white/20 hover:border-yellow-400 transition-colors uppercase tracking-[0.2em]">{T.wordbook} ({userState.collectedWords.length})</button>
                    <button onClick={() => setShowHistoryLog(true)} className="bg-indigo-600/80 px-4 py-2 text-white font-black text-[10px] border border-white/20 hover:border-indigo-400 transition-colors uppercase tracking-[0.2em]">{T.logs}</button>
                    <button onClick={() => setShowSystemMenu(true)} className="bg-black/80 px-4 py-2 text-white font-black text-[10px] border border-white/20 hover:border-yellow-500 transition-colors uppercase tracking-[0.2em]">{T.system}</button>
                    <div className="bg-black/80 px-4 py-2 text-white/50 text-[10px] font-mono border-b-2 border-red-500">N3: {userState.playerName.toUpperCase()} | {userState.grammarTopic}</div>
                </div>
            </div>

            <div className="absolute inset-0 z-10 flex items-end justify-center pointer-events-none pb-0">
                 <div className="relative h-[85vh] max-h-[90vh] w-auto aspect-[45/70] flex items-end justify-center pointer-events-auto transition-all duration-500 shadow-2xl">
                    <CharacterSprite character={activeChar} isSpeaking={lastModelMsg?.role === 'model' && !isLoading && !isDialogueFinished} className={`w-full h-full object-contain tachie-anim-breathe transition-all duration-300`} />
                </div>
            </div>

            {currentQuiz && (
                   <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                       <div className="w-full max-w-2xl bg-white p-8 rounded-sm shadow-2xl border-l-[12px] border-red-600 transform -skew-x-1 flex flex-col max-h-[90vh]">
                           <div className="flex justify-between items-start mb-4"><h3 className="text-sm font-black text-red-600 uppercase tracking-tighter">{T.quizHeader}: {userState.grammarTopic}</h3><button onClick={() => setCurrentQuiz(null)} className="text-gray-400 hover:text-red-600 text-xs font-black uppercase">{T.close} [X]</button></div>
                           <div className="overflow-y-auto pr-2"><p className="text-2xl text-gray-900 mb-8 font-black leading-tight">{currentQuiz.question}</p><div className="grid grid-cols-1 gap-3 mb-4">{currentQuiz.options?.map((opt: string, idx: number) => (<button key={idx} onClick={() => handleQuizAnswer(idx)} className="bg-gray-100 hover:bg-red-50 text-gray-900 font-bold py-4 px-6 rounded-sm transition-all border-l-4 border-transparent hover:border-red-600 text-left"><span className="text-red-600 mr-4 italic font-black">{["A", "B", "C", "D"][idx]}.</span> {opt}</button>))}</div></div>
                       </div>
                   </div>
            )}

            <div className="absolute bottom-0 w-full min-h-[350px] bg-gradient-to-t from-black via-black/80 to-transparent z-40 pb-12 px-6 flex flex-col items-center justify-end">
                {quizFeedback && (
                    <div className="mb-6 bg-slate-900/95 backdrop-blur-xl text-white px-8 py-6 rounded-sm shadow-2xl font-bold text-sm border-l-8 border-yellow-500 max-w-2xl z-[110] border-2 border-white/10">
                        <div className="flex items-start gap-4"><span className="text-4xl">💡</span><div className="flex-1"><p className="leading-relaxed whitespace-pre-wrap">{quizFeedback}</p></div></div>
                        <button onClick={handleContinueAfterFeedback} className="mt-6 w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-gray-900 font-black uppercase tracking-[0.3em] transition-all rounded-sm shadow-lg">{T.gotIt}</button>
                    </div>
                )}

                {gameMode === GameMode.CHAT && (
                  <div className="absolute top-20 right-4 z-50 flex flex-col gap-2 bg-black/40 p-2 rounded-lg backdrop-blur-sm border border-white/10">
                    <span className="text-[10px] text-white/50 uppercase font-bold text-center">Costume</span>
                    <button onClick={() => setCurrentOutfit('')} className={`px-3 py-1 text-xs rounded border transition-all ${currentOutfit === '' ? 'bg-white text-black border-white' : 'text-white border-white/20 hover:bg-white/10'}`}>校服</button>
                    <button onClick={() => setCurrentOutfit('casual')} className={`px-3 py-1 text-xs rounded border transition-all ${currentOutfit === 'casual' ? 'bg-pink-500 text-white border-pink-500' : 'text-white border-white/20 hover:bg-white/10'}`}>私服</button>
                    <button onClick={() => setCurrentOutfit('swim')} className={`px-3 py-1 text-xs rounded border transition-all ${currentOutfit === 'swim' ? 'bg-blue-500 text-white border-blue-500' : 'text-white border-white/20 hover:bg-white/10'}`}>泳装</button>
                    <button onClick={() => setCurrentOutfit('gym')} className={`px-3 py-1 text-xs rounded border transition-all ${currentOutfit === 'gym' ? 'bg-red-500 text-white border-red-500' : 'text-white border-white/20 hover:bg-white/10'}`}>运动</button>
                    <button onClick={() => setCurrentOutfit(selectedCharId === 'haku' ? 'prince' : selectedCharId === 'ren' ? 'fantasy' : selectedCharId === 'asuka' ? 'maid' : selectedCharId === 'hikari' ? 'yukata' : selectedCharId === 'rei' ? 'kimono' : 'special')} className={`px-3 py-1 text-xs rounded border transition-all ${['prince','fantasy','maid','yukata','kimono'].includes(currentOutfit) ? 'bg-purple-500 text-white border-purple-500' : 'text-white border-white/20 hover:bg-white/10'}`}>特殊</button>
                  </div>
                )}

                {!isLoading && lastModelMsg?.pages && !isDialogueFinished && !currentQuiz && (
                    <DialogueBox key={lastModelMsg.id} character={activeChar} pages={lastModelMsg.pages} vocabulary={lastModelMsg.vocabulary || []} onFinish={onDialogueFinished} />
                )}
                
                {isLoading && (
                    <div className="w-full max-w-4xl bg-slate-900/90 backdrop-blur-md border-2 border-indigo-500/50 p-10 min-h-[160px] animate-pulse flex flex-col items-center justify-center mb-6 shadow-[0_0_30px_rgba(99,102,241,0.3)]"><div className="text-indigo-400 font-black tracking-[0.8em] text-xl mb-2">{T.generating}</div></div>
                )}

                {(isDialogueFinished || isLoading) && !currentQuiz && !quizFeedback && (
                    <div className={`w-full max-w-4xl flex gap-3 transition-all duration-700 ${isDialogueFinished ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                        <div className="relative flex-1">
                            <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="N3..." disabled={isLoading} className="w-full bg-slate-900/90 border-2 border-white/20 rounded-full px-8 py-5 text-white font-medium focus:outline-none focus:border-yellow-500 transition-all backdrop-blur-md text-lg shadow-inner" />
                            <div className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] text-white/30 font-black uppercase tracking-widest hidden md:block">{T.enterToSend}</div>
                        </div>
                        <button onClick={() => handleSendMessage()} disabled={isLoading || !inputText.trim()} className="bg-yellow-600 hover:bg-yellow-500 px-10 py-5 text-gray-900 font-black uppercase tracking-widest transition-all shadow-xl rounded-full disabled:opacity-20 flex items-center gap-2">{T.send}</button>
                    </div>
                )}
            </div>

            {contextMenu && (
                <div className="fixed z-[300] bg-slate-900 border-2 border-yellow-500 shadow-2xl p-2 min-w-[150px] transform -skew-x-2 animate-in fade-in zoom-in-95 duration-100" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    <button onClick={handleTranslateSelection} className="w-full text-left px-4 py-2 text-white font-black uppercase text-xs hover:bg-yellow-500 hover:text-black transition-colors border-b border-white/10">{T.translateBtn}</button>
                    <button onClick={handleCollectSelection} className="w-full text-left px-4 py-2 text-white font-black uppercase text-xs hover:bg-indigo-600 transition-colors">{T.collectBtn}</button>
                </div>
            )}

            {translationResult && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setTranslationResult(null)}>
                    <div className="w-full max-w-lg bg-slate-900 border-2 border-yellow-500 p-8 shadow-2xl transform skew-x-1" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6"><h4 className="text-yellow-500 font-black uppercase tracking-[0.3em] text-xs">{T.analysisResult}</h4><button onClick={() => setTranslationResult(null)} className="text-white/40 hover:text-white transition-colors">✕</button></div>
                        <div className="space-y-6">
                            <div><p className="text-white/50 text-[10px] uppercase font-bold mb-1 tracking-widest">Japanese</p><p className="text-white text-xl font-bold leading-relaxed">{translationResult.original}</p></div>
                            <div className="h-px bg-white/10 w-full" />
                            <div><p className="text-yellow-500/50 text-[10px] uppercase font-bold mb-1 tracking-widest">{T.meaning}</p><p className="text-yellow-400 text-2xl font-black leading-tight">{translationResult.translation}</p></div>
                        </div>
                        <button onClick={() => setTranslationResult(null)} className="mt-10 w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-4 uppercase tracking-[0.4em] transition-all shadow-lg">{T.gotIt}</button>
                    </div>
                </div>
            )}
        </div>
      );
  };

  const renderSaveLoadScreen = () => {
    if (!saveLoadMode) return null;
    const slots = Array.from({ length: MAX_SLOTS }).map((_, i) => { const raw = localStorage.getItem(`${SAVE_SLOT_PREFIX}${i}`); return { index: i, data: raw ? JSON.parse(raw) : null }; });
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="w-full max-w-5xl h-[85vh] flex flex-col p-8">
                <div className="flex items-center justify-between mb-8 border-b-4 border-red-600 pb-4"><h2 className="text-5xl font-black text-white italic tracking-tighter uppercase transform -skew-x-6">{saveLoadMode === 'SAVE' ? 'Save Data' : 'Load Data'}</h2><button onClick={() => setSaveLoadMode(null)} className="bg-white text-black font-black px-6 py-2 uppercase hover:bg-red-600 hover:text-white transition-colors transform -skew-x-12">Close</button></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pb-10">
                    {slots.map((slot) => (
                        <div key={slot.index} onClick={() => { if (saveLoadMode === 'SAVE') saveGameToSlot(slot.index); else if (slot.data) loadGameFromSlot(slot.index); }} className={`relative h-48 border-4 transform transition-all duration-200 cursor-pointer overflow-hidden group ${!slot.data ? 'border-white/20 bg-white/5 hover:border-white/50' : 'border-white bg-zinc-900 hover:border-yellow-400 hover:translate-y-1 hover:shadow-xl'}`}>
                            <div className="absolute -right-4 -bottom-8 text-9xl font-black text-white/5 italic select-none pointer-events-none">{slot.index + 1}</div>
                            <div className="p-6 h-full flex flex-col justify-between relative z-10">
                                {slot.data ? (<><div className="flex justify-between items-start"><div><div className="text-xs font-bold text-yellow-500 uppercase tracking-widest mb-1">File {slot.index + 1}</div><div className="text-2xl font-black text-white uppercase italic">{slot.data.meta.playerName}</div></div><div className="text-right"><div className="text-[10px] text-white/50 font-mono">{new Date(slot.data.meta.timestamp).toLocaleDateString()}</div><div className="text-[10px] text-white/50 font-mono">{new Date(slot.data.meta.timestamp).toLocaleTimeString()}</div></div></div><div className="space-y-1"><div className="text-xs text-white/70 font-bold bg-white/10 inline-block px-2 py-1">{slot.data.meta.topic}</div><div className="text-[10px] text-white/40 italic truncate">"{slot.data.meta.previewText}"</div></div></>) : (<div className="h-full flex items-center justify-center flex-col text-white/20"><span className="text-4xl mb-2">∅</span><span className="font-black uppercase tracking-widest text-sm">No Data</span></div>)}
                            </div>
                            <div className={`absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  const renderSystemMenu = () => (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-lg" onClick={() => setShowSystemMenu(false)}>
          <div className="w-full max-w-md bg-zinc-900 border-2 border-white/10 p-10 shadow-[0_0_50px_rgba(0,0,0,0.8)] transform -skew-x-2" onClick={e => e.stopPropagation()}>
              <h2 className="text-3xl font-black text-white italic tracking-tighter mb-8 border-b-4 border-red-600 pb-2 uppercase">{T.system}</h2>
              <div className="flex flex-col gap-6">
                  <button onClick={() => { setSaveLoadMode('SAVE'); }} className="group flex items-center justify-between bg-white/5 hover:bg-white/10 p-6 border border-white/10 transition-all"><span className="text-white font-black tracking-widest uppercase">{T.saveData}</span><span className="text-yellow-500 text-xs font-mono group-hover:translate-x-1 transition-transform">{'>>>'}</span></button>
                  <button onClick={() => { setSaveLoadMode('LOAD'); }} disabled={!hasAnySave} className="group flex items-center justify-between bg-white/5 hover:bg-white/10 p-6 border border-white/10 transition-all disabled:opacity-20"><span className="text-white font-black tracking-widest uppercase">{T.loadData}</span><span className="text-yellow-500 text-xs font-mono group-hover:translate-x-1 transition-transform">{'>>>'}</span></button>
                  <button onClick={() => setShowSystemMenu(false)} className="mt-4 text-center text-white/40 hover:text-white font-black uppercase text-[10px] tracking-[0.5em] transition-colors">{T.cancel}</button>
              </div>
          </div>
      </div>
  );

  const renderWordbook = () => (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl" onClick={() => setShowWordbook(false)}>
        <div className="w-full max-w-4xl h-[80vh] bg-zinc-900 border-2 border-yellow-500/50 shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-8 py-4"><h2 className="text-yellow-500 font-black uppercase tracking-[0.4em] italic">{T.wordbook}</h2><div className="flex gap-4"><button onClick={() => { if(confirm(T.confirmClear)) { setUserState(prev => ({ ...prev, collectedWords: [] })); }}} className="text-white/20 hover:text-red-500 font-black text-xs uppercase tracking-widest">{T.clearAll}</button><button onClick={() => setShowWordbook(false)} className="text-white/30 hover:text-red-500 font-black">✕</button></div></div>
            <div className="flex-1 overflow-y-auto p-8 space-y-4 bg-slate-900/50 scrollbar-hide">
                {userState.collectedWords.length === 0 ? (<div className="h-full flex flex-col items-center justify-center text-white/20 italic font-medium"><span className="text-6xl mb-4">📓</span><p>{T.emptyWordbook}</p><p className="text-[10px] mt-2 uppercase tracking-widest">{T.emptyWordbookSub}</p></div>) : (userState.collectedWords.map((word, index) => (<div key={word.id} className="group relative bg-white/5 border border-white/10 p-6 rounded-sm hover:border-yellow-500/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"><div className="flex-1"><p className="text-white text-xl font-bold mb-1">{word.original}</p><p className="text-yellow-400 font-medium">{word.translation}</p></div><div className="flex items-center gap-4"><div className="flex flex-col gap-1 mr-4 opacity-30 group-hover:opacity-100 transition-opacity"><button onClick={() => handleWordAction(index, 'top')} className="text-white/50 hover:text-yellow-400 text-xs" title="Pin to top" disabled={index === 0}>🔝</button><div className="flex gap-1"><button onClick={() => handleWordAction(index, 'up')} className="text-white/50 hover:text-white text-xs" title="Move Up" disabled={index === 0}>⬆</button><button onClick={() => handleWordAction(index, 'down')} className="text-white/50 hover:text-white text-xs" title="Move Down" disabled={index === userState.collectedWords.length - 1}>⬇</button></div></div><span className="text-[10px] text-white/20 font-mono">{new Date(word.timestamp).toLocaleDateString()}</span><button onClick={() => removeCollectedWord(word.id)} className="text-white/20 hover:text-red-500 transition-colors p-2" title="Remove from wordbook"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></div></div>)))}
            </div>
        </div>
    </div>
  );

  const renderHistoryLog = () => (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl" onClick={() => setShowHistoryLog(false)}>
        <div className="w-full max-w-5xl h-[85vh] bg-zinc-900 border-2 border-indigo-500/50 shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-6 py-4"><h2 className="text-indigo-400 font-black uppercase tracking-[0.4em] italic">{T.logs}</h2><button onClick={() => setShowHistoryLog(false)} className="text-white/30 hover:text-red-500 font-black">✕</button></div>
            <div className="flex flex-1 overflow-hidden">
                <div className="w-16 md:w-64 bg-black/20 border-r border-white/5 flex flex-col overflow-y-auto">{(Object.keys(CHARACTERS) as CharacterId[]).map(id => (<button key={id} onClick={() => setActiveHistoryTab(id)} className={`p-4 flex items-center gap-3 transition-all border-l-4 ${activeHistoryTab === id ? `bg-white/5 ${CHARACTERS[id].color.replace('bg-', 'border-')}` : 'border-transparent opacity-50 hover:opacity-100'}`}><div className={`w-8 h-8 rounded-full overflow-hidden border border-white/20 shrink-0`}>{CHARACTERS[id].avatarUrl ? (<img src={CHARACTERS[id].avatarUrl} className="w-full h-full object-cover" alt="" />) : (<div className={`w-full h-full ${CHARACTERS[id].color}`}></div>)}</div><span className="hidden md:block font-bold text-white text-sm uppercase tracking-wider truncate">{userState.language === 'en' ? CHARACTERS[id].nameEn : CHARACTERS[id].name}</span></button>))}</div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-900/50">
                    {chatHistories[activeHistoryTab].length === 0 ? (<div className="h-full flex items-center justify-center text-white/20 italic font-medium">No history found.</div>) : (chatHistories[activeHistoryTab].map((msg) => (<div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}><div className="text-[10px] uppercase tracking-widest text-white/30 mb-1 px-1">{msg.senderName || (msg.role === 'user' ? 'You' : CHARACTERS[activeHistoryTab].name)}</div><div className={`max-w-[80%] p-4 rounded-sm text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-white/10 text-white border border-white/5' : 'bg-indigo-900/20 text-indigo-100 border border-indigo-500/30'}`}>{msg.text}</div></div>)))}
                    <div ref={historyEndRef} />
                </div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="antialiased font-sans text-gray-900 selection:bg-yellow-500 selection:text-black w-full h-screen overflow-hidden bg-black">
        {gameMode === GameMode.SETUP && renderSetup()}
        {gameMode === GameMode.LOBBY && renderLobby()}
        {gameMode === GameMode.CHAT && renderChat()}
        {showSystemMenu && renderSystemMenu()}
        {showHistoryLog && renderHistoryLog()}
        {showWordbook && renderWordbook()}
        {saveLoadMode && renderSaveLoadScreen()}
    </div>
  );
};

export default App;

const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes tachie-breathe {
    0% { transform: scale(1) translateY(0); }
    50% { transform: scale(1.02) translateY(-3px); } 
    100% { transform: scale(1) translateY(0); }
  }
  @keyframes tachie-speak {
    0% { transform: translateY(0); }
    15% { transform: translateY(-4px); }
    30% { transform: translateY(0); }
    45% { transform: translateY(-2px); }
    100% { transform: translateY(0); }
  }
  .tachie-anim-breathe {
    animation: tachie-breathe 5s ease-in-out infinite;
    transform-origin: bottom center;
    will-change: transform;
  }
  .tachie-anim-speak {
    animation: tachie-speak 0.4s ease-out;
    transform-origin: bottom center;
  }
`;
document.head.appendChild(styleSheet);