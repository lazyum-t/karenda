import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";
async function retryRequest(
  fn: () => Promise<any>,
  retries = 3
) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
// 時間のゼロ埋め用ヘルパー関数
const pad = (n: number) => String(n).padStart(2, "0");

export async function POST(request: Request) {
  try {
    // フロントエンドから送られてくる text と imgBase64 を受け取る
    const body = await request.json();
    const { text, imgBase64 } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    console.log("GEMINI_API_KEY =", process.env.GEMINI_API_KEY);
    if (!apiKey) {
      return NextResponse.json({ error: "APIキーが設定されていません。サーバー側の環境変数を確認してください。" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // 安定して高速な flash モデルを使用
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // AIに「どのような形式で返してほしいか」を指示するシステムプロンプト
    const promptText = `
あなたは優秀なスケジュールアシスタントです。
以下の入力（テキストまたは画像）から予定を抽出し、必ず指定されたJSON配列フォーマットのみを出力してください。
余計なテキストやマークダウンブロックは一切含めないでください。

【出力フォーマット】
[
  {
    "title": "予定のタイトル（例：会議、ランチ、受診）",
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "endTime": "HH:MM",
    "isAllDay": false,
    "repeat": "none",
    "notes": "補足情報やメモ"
  }
]

【ルール】
- 予定が見つからない場合は空の配列 [] を返してください。
- "date" は必須です。年が不明な場合は ${new Date().getFullYear()} 年を想定してください。
- "time" と "endTime" は 24時間表記 (HH:MM) にしてください。わからない場合は空文字 "" にしてください。
- "isAllDay" は、時間が明確に指定されていない場合は true、指定されている場合は false にしてください。
- "repeat" は、"none", "daily", "weekly", "monthly" のいずれかにしてください。
- "endTime" が不明で "time" のみ存在する場合は空文字 "" で構いません。
`;

    // AIに送信するコンテンツの組み立て
    const contents: any[] = [{ role: "user", parts: [{ text: promptText }] }];

    if (text) {
      contents[0].parts.push({ text: `以下のテキストから予定を抽出してください:\n\n${text}` });
    }

    if (imgBase64) {
      contents[0].parts.push({
        inlineData: {
          data: imgBase64,
          mimeType: "image/jpeg" // フロントエンド側でJPEGに変換して送っているため
        }
      });
    }

    // JSON形式で出力を強制する
    const result = await model.generateContent({
      contents,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const responseText = result.response.text();
    
    // AIが万が一マークダウン記法(```json ... ```)を含めてしまった場合の除去処理
    const cleanJson = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    
    let parsedEvents;
    try {
      parsedEvents = JSON.parse(cleanJson);
    } catch (e) {
      console.error("JSON Parse Error:", e);
      return NextResponse.json({ error: "AIのレスポンスを解析できませんでした。" }, { status: 500 });
    }

    if (!Array.isArray(parsedEvents)) {
      parsedEvents = [];
    }

    // 終了時間が未指定の場合、開始時間から30分後を自動設定するヘルパー
    const addMinutes = (timeStr: string, mins: number) => {
      if(!timeStr) return "";
      const [h, m] = timeStr.split(":").map(Number);
      const total = h * 60 + m + mins;
      return `${pad(Math.floor(total/60) % 24)}:${pad(total % 60)}`;
    };

    const finalEvents = parsedEvents.map((ev: any) => ({
      ...ev,
      endTime: ev.endTime || (ev.time ? addMinutes(ev.time, 30) : ""),
    }));

    // フロントエンドにJSON配列を返す
    return NextResponse.json(finalEvents);

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message || "サーバー内部エラー" }, { status: 500 });
  }
}
