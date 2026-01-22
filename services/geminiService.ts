import { 
  GoogleGenerativeAI, 
  SchemaType, 
  Schema, 
  ChatSession, 
  GenerateContentResult 
} from "@google/generative-ai";
import { Character, ChatMode, N3GrammarTopic, DialoguePage, WordReading, Message, Language } from '../types';

// 定义超时时间
const TIMEOUT_MS = 15000;

// 定义每个角色拥有的服装代码
const WARDROBE: Record<string, string[]> = {
  'asuka':  ['casual', 'gym', 'swim', 'maid', 'autumn'],
  'hikari': ['casual', 'gym', 'swim', 'yukata', 'autumn'],
  'rei':    ['casual', 'lab', 'gym', 'swim', 'kimono'],
  'ren':    ['casual', 'gym', 'fantasy', 'butler', 'lecturing'],
  'haku':   ['casual', 'apron', 'summer', 'prince']
};

// 全局对话 Session
let chatSession: ChatSession | null = null;

// 1. 获取 AI 实例 (优先使用用户 Key)
const getGenAI = (userApiKey?: string) => {
  // 🔥 修复点：优先读取传入的 userApiKey
  const key = userApiKey || (import.meta.env.VITE_GOOGLE_API_KEY as string);
  
  if (!key) {
    throw new Error("No API Key found. Please provide a key in settings or .env file.");
  }
  return new GoogleGenerativeAI(key);
};

// 2. 超时控制辅助函数
const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
};

// 3. 生成系统提示词
const getSystemInstruction = (character: Character, mode: ChatMode, goal: string, topic: N3GrammarTopic, lang: Language) => {
  const personaBase = character.systemPrompt;
  const pedagogicalLang = lang === 'en' ? 'English' : 'Chinese (Simplified)';
  const availableOutfits = WARDROBE[character.id] ? WARDROBE[character.id].join(', ') : 'none';
  const quizInstruction = mode === ChatMode.STUDY 
    ? `4. Quiz (quiz): Include 1 multiple-choice question (4 options) related to the grammar topic "${topic}". The explanation must be in ${pedagogicalLang}.`
    : `4. Quiz (quiz): Not needed for FREE_TALK. Set quiz field to null.`;

  return `${personaBase}
    【IMPORTANT: Research Level】
    Target Level: JLPT N3 Fixed.
    Vocabulary: Use N3 level Kanji and vocabulary mainly.
    Grammar Focus: ${topic}
    Current Mode: ${mode === ChatMode.STUDY ? 'STUDY Mode' : 'FREE_TALK Mode'}
    User Language: ${pedagogicalLang} (Use this language for explanations/feedback)

    [SCENE & OUTFIT RULES - HIGH PRIORITY]
    1. LOCATION (Field: 'location'):
       You MUST change the 'location' field IMMEDIATELY if the topic touches these keywords:
       - Study/Homework/Exam/Book -> 'library'
       - Rest/Sleep/Home/Visit -> 'room'
       - Eat/Cook/Hungry -> 'kitchen' or 'cafe'
       - Walk/Date/Meet -> 'street' or 'park'
       - Exercise/Sport/Run -> 'gym' or 'park'
       - Swim/Beach/Sea -> 'beach'
       - Class/School/Morning -> 'classroom'
       - Secret/Talk/Wind -> 'rooftop'
       - Pray/Luck/New Year -> 'shrine'
       - Fantasy/Magic/Battle -> 'castle'
       - Science/Experiment -> 'lab'
       - Festival/Fireworks -> 'festival'
       
       *Logic*: If user says "Let's study", respond with location: "library". Do NOT wait.

    2. OUTFIT (Field: 'outfit'):
       Change outfit ONLY if logical context requires it (e.g., swimming -> 'swim').
       - Default: "" (School Uniform)
       - Codes: [ ${availableOutfits} ]
       - TRIGGER: If user commands "Change to casual" or "Wear swimsuit", OBEY immediately.
       - TRIGGER: If location changes to 'beach', set outfit to 'swim'.
       - TRIGGER: If location changes to 'gym', set outfit to 'gym'.

    3. OUTPUT FORMAT:
       Response must be strict JSON.
       1. Page Config: Max 80 chars per 'text' page.
       2. Furigana: DO NOT include reading in parentheses.
       3. Vocabulary List: Extract N3 level words.
       4. Emotion: "neutral", "happy", "angry", "sad", "shy", "surprised".
       5. Location: REQUIRED. Current scene ID.
       6. Outfit: Code for outfit change.
    ${quizInstruction}`;
};

// 4. 定义返回数据的格式
const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    pages: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING },
          text: { type: SchemaType.STRING },
        },
        required: ["type", "text"],
      },
    },
    vocabulary: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          word: { type: SchemaType.STRING },
          reading: { type: SchemaType.STRING },
        },
        required: ["word", "reading"],
      },
    },
    emotion: { type: SchemaType.STRING },
    location: { type: SchemaType.STRING },
    outfit: { type: SchemaType.STRING },
    quiz: {
      type: SchemaType.OBJECT,
      properties: {
        question: { type: SchemaType.STRING },
        options: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        correctIndex: { type: SchemaType.NUMBER },
        explanation: { type: SchemaType.STRING },
      },
      required: ["question", "options", "correctIndex", "explanation"],
    },
  },
  required: ["pages", "vocabulary", "location"],
};

// 5. 解析 AI 返回的 JSON
const parseResponse = (text: string) => {
    try {
        let cleanJson = text.trim();
        if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '');
        } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '');
        }
        const parsed = JSON.parse(cleanJson);
        return parsed;
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return { pages: [{ type: 'speech', text: "..." }], vocabulary: [], emotion: "neutral" };
    }
};

// 6. 翻译功能 (接收 apiKey 参数)
export const translateText = async (text: string, targetLang: Language, apiKey?: string): Promise<string> => {
    const genAI = getGenAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const target = targetLang === 'en' ? 'English' : 'Chinese (Simplified)';
    try {
        const result = await model.generateContent(
            `Translate the following Japanese text to ${target}. Only provide the translation text: "${text}"`
        );
        return result.response.text().trim() || "Translation failed.";
    } catch (error) {
        console.error("Translation error:", error);
        return "Error occurred during translation.";
    }
};

// 7. 开始对话 (接收 apiKey 参数)
export const startChat = async (
    character: Character, 
    mode: ChatMode, 
    goal: string, 
    topic: N3GrammarTopic,
    lang: Language,
    apiKey?: string, // 🔥 必须加上这个参数，否则 key 会被当成 history！
    history: Message[] = []
) => {
  const genAI = getGenAI(apiKey);
  
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    systemInstruction: getSystemInstruction(character, mode, goal, topic, lang),
    generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
    }
  });

  // 创建新会话
  chatSession = model.startChat({ history: [] });

  // ⚠️ 关键逻辑：如果传入的 history 是字符串（参数错位），或者真的是数组但为空
  // 我们只在有真正的历史消息时才跳过开场白
  if (Array.isArray(history) && history.length > 0) {
      return { pages: [], vocabulary: [] };
  }

  try {
    const result = await withTimeout<GenerateContentResult>(
        chatSession.sendMessage("Start the conversation based on the context. Set initial location."),
        TIMEOUT_MS,
        "Timeout connecting to AI."
    );
    
    const parsed = parseResponse(result.response.text());
    return { 
        pages: parsed.pages || [], 
        vocabulary: parsed.vocabulary || [],
        emotion: parsed.emotion,
        outfit: parsed.outfit,
        location: parsed.location
    };
  } catch (error: any) {
    return { pages: [{ type: 'speech', text: `Error: ${error.message}` }], vocabulary: [] };
  }
};

// 8. 发送消息
export const sendMessage = async (text: string, isQuizRequest: boolean = false) => {
  if (!chatSession) {
      throw new Error("Session lost. Please re-enter chat.");
  }

  try {
    const result = await withTimeout<GenerateContentResult>(
        chatSession.sendMessage(text),
        TIMEOUT_MS,
        "Server response timeout."
    );
    const parsed = parseResponse(result.response.text());
    
    return { 
        pages: parsed.pages, 
        vocabulary: parsed.vocabulary, 
        quiz: parsed.quiz,
        emotion: parsed.emotion,
        outfit: parsed.outfit,
        location: parsed.location
    };
  } catch (error: any) {
    throw new Error(error.message);
  }
};