
import { GoogleGenAI, Chat, Type, GenerateContentResponse } from "@google/genai";
import { Character, ChatMode, N3GrammarTopic, DialoguePage, WordReading, Message, Language } from '../types';

let chatSession: Chat | null = null;

const TIMEOUT_MS = 30000; // Increased to 30s to prevent timeouts during JSON generation

/**
 * Always retrieve the current API key from Vite environment variables.
 * Use a fresh instance if needed to ensure availability.
 */
const getAIClient = () => {
  const key = import.meta.env.VITE_GOOGLE_API_KEY as string;
  if (!key) throw new Error("API Key missing. Please set VITE_GOOGLE_API_KEY in .env.local");
  return new GoogleGenAI({ apiKey: key });
};

const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
};

const getSystemInstruction = (character: Character, mode: ChatMode, goal: string, topic: N3GrammarTopic, lang: Language) => {
  const personaBase = character.systemPrompt;
  
  // Adjust instructions based on user language
  const pedagogicalLang = lang === 'en' ? 'English' : 'Chinese (Simplified)';
  const quizInstruction = mode === ChatMode.STUDY 
    ? `4. Quiz (quiz): Include 1 multiple-choice question (4 options) related to the grammar topic "${topic}". The explanation must be in ${pedagogicalLang}.`
    : `4. Quiz (quiz): Not needed for FREE_TALK. Set quiz field to null.`;

  const context = `
    【IMPORTANT: Research Level】
    Target Level: JLPT N3 Fixed.
    Vocabulary: Use N3 level Kanji and vocabulary mainly.
    Grammar Focus: ${topic}
    Current Mode: ${mode === ChatMode.STUDY ? 'STUDY Mode' : 'FREE_TALK Mode'}
    User Language: ${pedagogicalLang} (Use this language for explanations/feedback)
    
    【Output Format】
    You are a visual novel character. Response must be JSON.
    
    1. Page Config: Max 80 chars per 'text' page. 3-5 pages total.
    2. Furigana: DO NOT include reading in parentheses inside text (e.g. "漢字(かんじ)" is BANNED).
    3. Vocabulary List: Extract N3 level words from the text.
    4. Emotion: Choose ONE keyword exactly: "neutral", "happy", "angry", "sad", "shy", "surprised".
    ${quizInstruction}
  `;

  return `${personaBase}\n${context}`;
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, description: "'action' or 'speech'" },
          text: { type: Type.STRING, description: "Dialogue content" },
        },
        required: ["type", "text"],
      },
    },
    vocabulary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          reading: { type: Type.STRING },
        },
        required: ["word", "reading"],
      },
    },
    emotion: {
      type: Type.STRING,
      description: "One of: 'neutral', 'happy', 'angry', 'sad', 'shy', 'surprised'"
    },
    quiz: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING },
        options: { type: Type.ARRAY, items: { type: Type.STRING } },
        correctIndex: { type: Type.NUMBER },
        explanation: { type: Type.STRING },
      },
      required: ["question", "options", "correctIndex", "explanation"],
    },
  },
  required: ["pages", "vocabulary"],
};

const parseResponse = (text: string): { pages: DialoguePage[], vocabulary: WordReading[], quiz?: any, emotion?: string } => {
    try {
        // Fix: Remove Markdown code blocks if present
        let cleanJson = text.trim();
        if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '');
        } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '');
        }
        
        const parsed = JSON.parse(cleanJson);
        if (!parsed.pages || !Array.isArray(parsed.pages)) {
            parsed.pages = [{ type: 'speech', text: "（静かに頷く）" }];
        }
        return parsed;
    } catch (e) {
        console.error("Failed to parse Gemini JSON response:", e);
        console.log("Raw Text:", text);
        return {
            pages: [{ type: 'speech', text: "..." }],
            vocabulary: [],
            emotion: "neutral"
        };
    }
};

export const translateText = async (text: string, targetLang: Language): Promise<string> => {
    const ai = getAIClient();
    const target = targetLang === 'en' ? 'English' : 'Chinese (Simplified)';
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: `Translate the following Japanese text to ${target}. Only provide the translation text: "${text}"`,
        });
        return response.text?.trim() || "Translation failed.";
    } catch (error) {
        console.error("Translation error:", error);
        return "Error occurred during translation.";
    }
};

export const startChat = async (
    character: Character, 
    mode: ChatMode, 
    goal: string, 
    topic: N3GrammarTopic,
    lang: Language,
    history: Message[] = []
): Promise<{pages: DialoguePage[], vocabulary: WordReading[], emotion?: string}> => {
  const ai = getAIClient();

  chatSession = ai.chats.create({
    model: 'gemini-1.5-flash',
    config: {
      systemInstruction: getSystemInstruction(character, mode, goal, topic, lang),
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    }
  });

  if (history.length > 0) {
      return { pages: [], vocabulary: [] };
  }

  try {
    const response = await withTimeout<GenerateContentResponse>(
        chatSession.sendMessage({ message: "Start the conversation based on the context." }),
        TIMEOUT_MS,
        "Timeout connecting to AI."
    );
    const parsed = parseResponse(response.text || "{}");
    return { 
        pages: parsed.pages || [], 
        vocabulary: parsed.vocabulary || [],
        emotion: parsed.emotion 
    };
  } catch (error: any) {
    return { 
        pages: [{ type: 'speech', text: `Error: ${error.message}` }], 
        vocabulary: [] 
    };
  }
};

export const sendMessage = async (text: string, isQuizRequest: boolean = false): Promise<{ pages: DialoguePage[], vocabulary: WordReading[], quiz?: any, emotion?: string }> => {
  if (!chatSession) {
      throw new Error("Session lost. Please re-enter chat.");
  }

  try {
    const response = await withTimeout<GenerateContentResponse>(
        chatSession.sendMessage({ message: text }),
        TIMEOUT_MS,
        "Server response timeout."
    );
    const parsed = parseResponse(response.text || "{}");
    return { 
        pages: parsed.pages, 
        vocabulary: parsed.vocabulary,
        quiz: parsed.quiz,
        emotion: parsed.emotion
    };
  } catch (error: any) {
    throw new Error(error.message);
  }
};
