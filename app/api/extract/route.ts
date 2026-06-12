import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * リトライ処理
 */
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

/**
 * 時間ゼロ埋め
 */
const pad = (n: number) => String(n).padStart(2, "0");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, imgBase64 } = body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEYが未設定です" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // 🔥 モデルフォールバック（重要）
    const models = [
      "gemini-2.5-flash",
      "gemini-1.5-pro"
    ];

    const promptText = `
あなたは優秀なスケジュールアシスタントです。
以下の入力から予定を抽出し、必ずJSON配列のみを返してください。

【出力フォーマット】
[
  {
    "title": "予定のタイトル",
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "endTime": "HH:MM",
    "isAllDay": false,
    "repeat": "none",
    "notes": "補足"
  }
]

【ルール】
- 予定がない場合は []
- 年は ${new Date().getFullYear()} を基準
- 時刻は24時間表記
- 不明な値は空文字 ""
- isAllDayは時間なしならtrue
- repeatは none / daily / weekly / monthly
`;

    const contents: Array<any> = [
      {
        role: "user",
        parts: [{ text: promptText }]
      }
    ];

    if (text) {
      contents[0].parts.push({
        text: `テキスト:\n${text}`
      });
    }

    if (imgBase64) {
      contents[0].parts.push({
        inlineData: {
          data: imgBase64,
          mimeType: "image/jpeg"
        }
      });
    }

    let lastError: any;

    // 🔥 モデル順に試す（重要）
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
        });

        const result = await retryRequest(() =>
          model.generateContent({
            contents,
            generationConfig: {
              responseMimeType: "application/json",
            },
          })
        );

        const responseText = result.response.text();

        // JSONクリーン処理
        const cleanJson = responseText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();

        let parsed;
        try {
          parsed = JSON.parse(cleanJson);
        } catch {
          return NextResponse.json(
            { error: "JSONパース失敗" },
            { status: 500 }
          );
        }

        if (!Array.isArray(parsed)) parsed = [];

        // endTime補完
        const final = parsed.map((ev: any) => ({
          ...ev,
          endTime:
            ev.endTime || (ev.time ? addMinutes(ev.time, 30) : "")
        }));

        return NextResponse.json(final);
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError;
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: error.message || "サーバーエラー" },
      { status: 500 }
    );
  }
}

/**
 * 時間加算
 */
function addMinutes(timeStr: string, mins: number) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + mins;

  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}
